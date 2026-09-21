import "server-only";
import { z } from "zod";
import { parseJobName } from "@/server/providers/magic-hour-mapping";
import type { Job, JobsRepository } from "@/server/repositories/jobs";
import { AppError } from "@/server/errors/app-error";
import { finalizeJob, type FinalizeDeps } from "./finalize";

const payloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  status: z.enum(["draft", "queued", "rendering", "complete", "error", "canceled"]).optional(),
  error: z.object({ code: z.string(), message: z.string() }).nullish(),
});

type Payload = z.infer<typeof payloadSchema>;

// Magic Hour's prose examples show `object` where every per-event schema shows `payload`, so accept
// both.
export const webhookEventSchema = z
  .object({
    type: z.string().min(1),
    payload: payloadSchema.optional(),
    object: payloadSchema.optional(),
  })
  .transform((e) => ({ type: e.type, payload: e.payload ?? e.object }))
  .refine((e): e is { type: string; payload: Payload } => e.payload !== undefined, {
    error: "payload is required",
  });

export type WebhookHeaders = { signature: string | null; timestamp: string | null };
export type WebhookDeps = FinalizeDeps;
export type WebhookResult = { status: number; body: unknown };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// Returns null when nothing can be matched, which the caller turns into a logged 200 -- none of
// these cases become true on redelivery.
async function resolveJob(payload: Payload, jobs: JobsRepository): Promise<Job | null> {
  const byId = await jobs.findByMagicHourId(payload.id);
  if (byId) return byId;

  const jobId = parseJobName(payload.name);
  if (!jobId) return null;

  const candidate = await jobs.findByIdUnscoped(jobId);
  if (!candidate) return null;

  const attached = await jobs.attachMagicHourId(candidate.id, payload.id);
  if (attached) return attached;

  // attachMagicHourId returns null only when the job already carries an id, so the re-read either
  // finds the concurrent winner or correctly finds nothing.
  return jobs.findByMagicHourId(payload.id);
}

const acknowledged: WebhookResult = { status: 200, body: { received: true } };

export async function handleWebhookEvent(
  raw: string,
  headers: WebhookHeaders,
  deps: WebhookDeps,
  now: () => Date = () => new Date(),
): Promise<WebhookResult> {
  // Verification happens before the body is even parsed: an unverified delivery must never be acted
  // on.
  const verification = deps.magicHour.verifyWebhook({
    rawBody: raw,
    signature: headers.signature,
    timestamp: headers.timestamp,
    nowSeconds: Math.floor(now().getTime() / 1000),
  });
  if (!verification.ok) throw new AppError(verification.code);

  const parsed = webhookEventSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    // A malformed body will never parse on redelivery either.
    console.warn("[webhook] body did not parse; acknowledged without action");
    return acknowledged;
  }
  const { type, payload } = parsed.data;

  const job = await resolveJob(payload, deps.jobs);
  if (!job) {
    console.warn(`[webhook] no job matched magicHourId=${payload.id}; acknowledged without action`);
    return acknowledged;
  }

  switch (type) {
    case "video.started":
      await deps.jobs.setPhase(job.id, "rendering");
      return acknowledged;

    case "video.errored":
      // A null return means the job already finalized as complete, and that stored result must not
      // be disturbed.
      await deps.jobs.markFailed(job.id, {
        errorCode: "MAGIC_HOUR_JOB_FAILED",
        errorMessage: payload.error?.message ?? "Magic Hour reported the transform failed.",
        ...(payload.error ? { magicHourError: payload.error } : {}),
      });
      return acknowledged;

    case "video.completed": {
      const outcome = await finalizeJob(job.id, deps, now);
      if (outcome.kind === "claim-held") return { status: 409, body: { status: "claim-held" } };
      if (outcome.kind === "transient") return { status: 500, body: { status: "transient" } };
      return acknowledged;
    }

    default:
      return acknowledged;
  }
}
