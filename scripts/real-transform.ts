// Usage: pnpm transform:real https://<deployment> <sourceId>, with V2V_COOKIE set to a Cookie
// header from a browser that owns the source (overrides: TRANSFORM_START_SECONDS,
// TRANSFORM_END_SECONDS, TRANSFORM_ART_STYLE, TRANSFORM_NAME, TRANSFORM_POLL_MS,
// TRANSFORM_TIMEOUT_MINUTES).
// Posts to /api/transform, polls /api/history until the job is terminal, and prints the wall-clock
// time, clip length and creditsCharged that correct the guessed JOB_DEADLINE_* constants.
import { randomUUID } from "node:crypto";
import { errorBodySchema } from "@/lib/error-codes";
import {
  historyResponseSchema,
  transformParamsSchema,
  transformResponseSchema,
  type JobView,
  type TransformParams,
} from "@/lib/transform-contract";

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TIMEOUT_MINUTES = 20;

const TERMINAL_STATUSES: ReadonlySet<JobView["status"]> = new Set([
  "complete",
  "failed",
  "timed_out",
  "superseded",
  "abandoned",
]);

export type Args = { baseUrl: string; sourceId: string; cookie: string };

export function parseArgs(argv: string[], env: Record<string, string | undefined>): Args {
  const [baseUrlArg, sourceId] = argv;
  if (!baseUrlArg || !sourceId) {
    throw new Error(
      "usage: pnpm transform:real <https://deployment> <sourceId> — both arguments are required.",
    );
  }
  let baseUrl: string;
  try {
    baseUrl = new URL(baseUrlArg).origin;
  } catch {
    throw new Error(`"${baseUrlArg}" is not a valid URL — pass the deployment's https:// origin.`);
  }
  const cookie = env.V2V_COOKIE;
  if (!cookie) {
    throw new Error(
      'V2V_COOKIE is required — set it to the full Cookie header value (e.g. "v2v_uid=<value>") ' +
        "from a browser session that owns this sourceId. Without it, /api/transform and " +
        "/api/history run as a different (or brand new) anonymous user and the source will not " +
        "be found.",
    );
  }
  return { baseUrl, sourceId, cookie };
}

// Reuses the real request schema so an invalid override fails locally with a clear message instead
// of as an opaque 400.
export function buildParams(env: Record<string, string | undefined>): TransformParams {
  const result = transformParamsSchema.safeParse({
    name: env.TRANSFORM_NAME ?? "real-transform smoke test",
    startSeconds: Number(env.TRANSFORM_START_SECONDS ?? 0),
    endSeconds: Number(env.TRANSFORM_END_SECONDS ?? 8),
    fpsResolution: "HALF",
    artStyle: env.TRANSFORM_ART_STYLE ?? "Cyberpunk",
    promptType: "default",
    model: "default",
    version: "default",
  });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
    throw new Error(`transform params are invalid: ${issues}`);
  }
  return result.data;
}

export function statusLabel(job: Pick<JobView, "status" | "phase">): string {
  return job.status === "processing" ? `processing (${job.phase})` : job.status;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function describeError(body: unknown): string {
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) return `${parsed.data.error.code} — ${parsed.data.error.message}`;
  // JSON.stringify(undefined) would print the literal string "undefined", which reads like a real
  // value.
  if (body === undefined) return "(empty or non-JSON response body)";
  return JSON.stringify(body);
}

async function requestJson(url: string, cookie: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, Cookie: cookie } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`could not reach ${url}: ${message}`, { cause });
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${url} failed (${response.status}): ${describeError(body)}`,
    );
  }
  return body;
}

async function postTransform(
  baseUrl: string,
  cookie: string,
  sourceId: string,
  params: TransformParams,
): Promise<JobView> {
  const body = await requestJson(`${baseUrl}/api/transform`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, params, idempotencyKey: randomUUID() }),
  });
  return transformResponseSchema.parse(body).job;
}

// A single page is enough: a freshly created job sorts first under /api/history's default
// createdAt-desc order.
async function findJob(
  baseUrl: string,
  cookie: string,
  jobId: string,
): Promise<JobView | undefined> {
  const body = await requestJson(`${baseUrl}/api/history?limit=50`, cookie);
  return historyResponseSchema.parse(body).items.find((item) => item.id === jobId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilTerminal(
  baseUrl: string,
  cookie: string,
  jobId: string,
  pollMs: number,
  timeoutMs: number,
): Promise<JobView> {
  const start = Date.now();
  let lastLabel: string | undefined;
  for (;;) {
    const job = await findJob(baseUrl, cookie, jobId);
    if (job) {
      const label = statusLabel(job);
      if (label !== lastLabel) {
        console.log(`[${new Date().toISOString()}] ${label}`);
        lastLabel = label;
      }
      if (TERMINAL_STATUSES.has(job.status)) return job;
    } else {
      console.log(`[${new Date().toISOString()}] job not visible yet in /api/history`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out after ${formatElapsed(timeoutMs)} waiting for job ${jobId} to reach a terminal status`,
      );
    }
    await sleep(pollMs);
  }
}

async function main() {
  const { baseUrl, sourceId, cookie } = parseArgs(process.argv.slice(2), process.env);
  const params = buildParams(process.env);
  const pollMs = Number(process.env.TRANSFORM_POLL_MS ?? DEFAULT_POLL_MS);
  const timeoutMs =
    Number(process.env.TRANSFORM_TIMEOUT_MINUTES ?? DEFAULT_TIMEOUT_MINUTES) * 60_000;

  const start = Date.now();
  console.log(`[${new Date().toISOString()}] posting transform for source ${sourceId}`);
  const created = await postTransform(baseUrl, cookie, sourceId, params);
  console.log(`[${new Date().toISOString()}] job ${created.id} accepted, ${statusLabel(created)}`);

  const finalJob = await pollUntilTerminal(baseUrl, cookie, created.id, pollMs, timeoutMs);
  const elapsedMs = Date.now() - start;
  const clipSeconds = finalJob.params.endSeconds - finalJob.params.startSeconds;

  console.log("");
  console.log(`status:          ${finalJob.status}`);
  console.log(`wall-clock time: ${formatElapsed(elapsedMs)}`);
  console.log(`clip length:     ${clipSeconds.toFixed(2)}s`);
  console.log(`creditsCharged:  ${finalJob.creditsCharged ?? "(not reported)"}`);

  if (finalJob.status !== "complete") {
    console.log(`errorCode:       ${finalJob.errorCode ?? "(none)"}`);
    console.log(`errorMessage:    ${finalJob.errorMessage ?? "(none)"}`);
    throw new Error(`job finished with status "${finalJob.status}", not "complete"`);
  }
}

// Guarded so parseArgs/buildParams above can be imported by a test without the script making
// network calls on import.
if (process.argv[1] === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
