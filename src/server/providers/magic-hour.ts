import "server-only";
import { Client } from "magic-hour";
import type { ErrorCode } from "@/lib/error-codes";
import type { TransformParams } from "@/lib/transform-contract";
import { AppError } from "@/server/errors/app-error";
import { buildJobName, type ProviderStatus } from "./magic-hour-mapping";
import { verifyWebhookSignature } from "./magic-hour-signature";
import type {
  CreateJobInput,
  MagicHourAdapter,
  MagicHourDownload,
  MagicHourJobDetails,
  VerifyWebhookArgs,
  VerifyWebhookResult,
} from "./types";

const CREATE_TIMEOUT_MS = 20_000;
const GET_TIMEOUT_MS = 10_000;

type MagicHourCreateBody = {
  assets: { videoSource: "file"; videoFilePath: string };
  startSeconds: number;
  endSeconds: number;
  fpsResolution: TransformParams["fpsResolution"];
  name: string;
  style: {
    artStyle: TransformParams["artStyle"];
    promptType: TransformParams["promptType"];
    prompt?: string;
    model: TransformParams["model"];
    version: TransformParams["version"];
  };
};

export type MagicHourCreate = (
  body: MagicHourCreateBody,
) => Promise<{ id: string; creditsCharged?: number | null }>;

type MagicHourGetResponse = {
  id: string;
  // Widened to string: the SDK's own type is the same closed union as
  // ProviderStatus, but hand-written test fixtures infer a plain string.
  status: string;
  name?: string | null;
  downloads?: MagicHourDownload[];
  creditsCharged?: number | null;
  error?: { code: string; message: string } | null;
};

export type MagicHourGet = (id: string) => Promise<MagicHourGetResponse>;

type MagicHourCredentials = { apiKey: string; webhookSecret: string };

type Runtime = { create?: MagicHourCreate; get?: MagicHourGet };

function defaultRuntime(apiKey: string): { create: MagicHourCreate; get: MagicHourGet } {
  const client = new Client({ token: apiKey });
  return {
    create: (body) => client.v1.videoToVideo.create(body, { timeout: CREATE_TIMEOUT_MS }),
    get: (id) => client.v1.videoProjects.get({ id }, { timeout: GET_TIMEOUT_MS }),
  };
}

export function createMagicHourAdapter(
  { apiKey, webhookSecret }: MagicHourCredentials,
  runtime: Runtime = {},
): MagicHourAdapter {
  const defaults = defaultRuntime(apiKey);
  const create = runtime.create ?? defaults.create;
  const get = runtime.get ?? defaults.get;

  return {
    async createJob({ jobId, videoUrl, params }: CreateJobInput) {
      const includePrompt = params.promptType !== "default" && !!params.prompt;
      const body: MagicHourCreateBody = {
        assets: { videoSource: "file", videoFilePath: videoUrl },
        startSeconds: params.startSeconds,
        endSeconds: params.endSeconds,
        fpsResolution: params.fpsResolution,
        name: buildJobName(jobId, params.name),
        style: {
          artStyle: params.artStyle,
          promptType: params.promptType,
          model: params.model,
          version: params.version,
          ...(includePrompt ? { prompt: params.prompt } : {}),
        },
      };
      try {
        const result = await create(body);
        return { magicHourId: result.id };
      } catch (error) {
        throw await toAppError(error);
      }
    },

    async getJobDetails(magicHourId: string): Promise<MagicHourJobDetails> {
      try {
        const result = await get(magicHourId);
        return {
          magicHourId: result.id,
          status: result.status as ProviderStatus,
          name: result.name ?? null,
          downloads: result.downloads ?? [],
          creditsCharged: result.creditsCharged ?? null,
          error: result.error ?? null,
        };
      } catch (error) {
        throw await toAppError(error);
      }
    },

    verifyWebhook(args: VerifyWebhookArgs): VerifyWebhookResult {
      return verifyWebhookSignature({
        rawBody: args.rawBody,
        signature: args.signature,
        timestamp: args.timestamp,
        secret: webhookSecret,
        nowSeconds: args.nowSeconds ?? Math.floor(Date.now() / 1000),
      });
    },
  };
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.response === "object" && record.response !== null) {
    const status = (record.response as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function hasCode(error: unknown, codes: string[]): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return codes.includes(String((error as { code: unknown }).code));
}

// "Definite" means Magic Hour did not take the job, so it is safe to mark the
// job failed. "Uncertain" means the job may be running, so it must stay
// submitting and be reconciled later. Getting this backwards either strands a
// live job or bills the user twice.
function classify(error: unknown): { code: ErrorCode; definite: boolean } {
  const status = httpStatus(error);
  if (status === 402) return { code: "MAGIC_HOUR_INSUFFICIENT_CREDITS", definite: true };
  if (status === 422) return { code: "MAGIC_HOUR_INVALID_PARAMS", definite: true };
  if (status === 401 || status === 403) {
    return { code: "MAGIC_HOUR_MISCONFIGURED", definite: true };
  }
  // The connection was refused or the host did not resolve: nothing was sent.
  const refused = hasCode(error, ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);
  return { code: "MAGIC_HOUR_REQUEST_FAILED", definite: refused };
}

// The SDK throws with the provider's HTTP response still unread, so the one
// sentence that says *which* setting was refused ("V3 models are not available
// yet.") is discarded unless it is consumed here. The status has already been
// classified, so a body that cannot be read costs nothing.
async function readProviderError(
  error: unknown,
): Promise<{ code: string; message: string } | undefined> {
  if (typeof error !== "object" || error === null) return undefined;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return undefined;
  const text = (response as { text?: unknown }).text;
  if (typeof text !== "function") return undefined;
  try {
    const body: unknown = JSON.parse(await (text as () => Promise<string>).call(response));
    if (typeof body !== "object" || body === null) return undefined;
    const { code, message } = body as { code?: unknown; message?: unknown };
    if (typeof message !== "string" || message.length === 0) return undefined;
    return { code: typeof code === "string" ? code : "unknown", message };
  } catch {
    return undefined;
  }
}

async function toAppError(error: unknown): Promise<AppError> {
  const { code, definite } = classify(error);
  const providerError = await readProviderError(error);
  return new AppError(code, {
    details: { definite },
    cause: error,
    ...(providerError ? { providerError } : {}),
  });
}
