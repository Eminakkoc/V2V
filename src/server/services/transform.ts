import "server-only";
import type { AppConfig } from "@/config/env";
import type { TransformRequest, TransformResponse } from "@/lib/transform-contract";
import type { ServerDeps } from "@/server/deps";
import { AppError, errorMessage } from "@/server/errors/app-error";
import type { Job } from "@/server/repositories/jobs";
import { toJobView } from "@/server/services/job-view";

export function deadlineFor(clipSeconds: number, config: AppConfig, now: Date): Date {
  const { baseMinutes, secondsPerClipSecond, maxMinutes } = config.jobDeadline;
  const seconds = Math.min(baseMinutes * 60 + clipSeconds * secondsPerClipSecond, maxMinutes * 60);
  return new Date(now.getTime() + seconds * 1000);
}

type TransformDeps = Pick<ServerDeps, "config" | "sources" | "jobs" | "magicHour">;

// The Mongo driver surfaces a unique-index violation as a MongoServerError
// with this numeric code; matching on it specifically (not "any insert
// error") keeps a genuine DATABASE_UNAVAILABLE or bad-write error from being
// mistaken for a duplicate submission.
function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as { code: unknown }).code === 11000;
}

export async function startTransform(
  body: TransformRequest,
  userId: string,
  deps: TransformDeps,
  now: () => Date = () => new Date(),
): Promise<TransformResponse> {
  // Idempotency check first, before the source load: a double submit then
  // costs one database read instead of a full pipeline.
  const existing = await deps.jobs.findByIdempotencyKey(userId, body.idempotencyKey);
  if (existing) return { job: toJobView(existing) };

  // findById is owner-scoped: this both loads the source and enforces that
  // the caller owns it.
  const source = await deps.sources.findById(userId, body.sourceId);
  if (!source) throw new AppError("SOURCE_NOT_FOUND");

  const { startSeconds, endSeconds } = body.params;
  const clipSeconds = endSeconds - startSeconds;
  // The 0.05 is a deliberate epsilon, not slack: Cloudinary rounds the duration
  // it reports, so an end exactly at the source's real end can arrive a hair
  // past the stored value. On a 12.5s source, 12.55 is accepted and 12.56 is not.
  if (clipSeconds > deps.config.maxClipSeconds || endSeconds > source.duration + 0.05) {
    throw new AppError("CLIP_TOO_LONG");
  }

  let retryOf: Job | null = null;
  if (body.retryOfJobId) {
    // Deliberately not owner-scoped: retrying another user's job is an
    // accepted product decision here. The owner check above, on the source,
    // still refuses a cross-user retry at the source.
    retryOf = await deps.jobs.findByIdUnscoped(body.retryOfJobId);
  }

  // The job row must exist before the provider call: if Magic Hour's answer
  // is lost, a record already exists to reconcile against.
  let job: Job;
  try {
    job = await deps.jobs.insert(userId, {
      sourceId: source.id,
      params: body.params,
      idempotencyKey: body.idempotencyKey,
      status: "processing",
      phase: "submitting",
      deadlineAt: deadlineFor(clipSeconds, deps.config, now()),
      ...(body.retryOfJobId ? { retryOfJobId: body.retryOfJobId } : {}),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // Two requests raced past the idempotency check above and both reached
    // insert; the unique {userId, idempotencyKey} index rejected the loser.
    // Re-read and return the winner's job so the same idempotencyKey still
    // yields one job under genuine concurrency, not only when requests
    // happen to be sequential.
    const winner = await deps.jobs.findByIdempotencyKey(userId, body.idempotencyKey);
    if (!winner) throw error;
    return { job: toJobView(winner) };
  }

  if (retryOf) await deps.jobs.markSuperseded(retryOf.id, job.id);

  let magicHourId: string;
  try {
    ({ magicHourId } = await deps.magicHour.createJob({
      jobId: job.id,
      videoUrl: source.cloudinaryUrl,
      params: body.params,
    }));
  } catch (error) {
    if (error instanceof AppError && error.details?.definite === true) {
      // The provider did not take the job: mark it failed so it shows in
      // History, and rethrow so the caller sees the error too. (markFailed
      // can return null when the job is already complete, which cannot
      // happen here on a just-inserted job — the return value is unused.)
      await deps.jobs.markFailed(job.id, {
        errorCode: error.code,
        errorMessage: error.message,
        // The provider's own reason, kept beside the generic client message
        // exactly as the webhook and reconcile paths keep theirs.
        ...(error.providerError ? { magicHourError: error.providerError } : {}),
      });
      throw error;
    }
    // Uncertain outcome (timeout, dropped connection, 5xx) — and, deliberately,
    // any error that is not an AppError at all: when we cannot tell whether
    // the provider took the job, the safe default is to assume it might have,
    // so the job stays processing/submitting for later reconciliation rather
    // than being marked failed on a guess. The caller still gets a 202.
    await deps.jobs.setLastError(job.id, errorMessage(error));
    return { job: toJobView(job) };
  }

  // The provider accepted the job — it is live (and billing) now. Recording
  // its id and phase here is best-effort: a lost magicHourId is recoverable
  // by design (the provider job name embeds v2v:<jobId>, and the webhook's
  // name-fallback attach recovers exactly this case), so a failure in this
  // step must not be treated as a failed submission. The job really was
  // accepted, and that is the only honest thing to report.
  try {
    const attached = await deps.jobs.attachMagicHourId(job.id, magicHourId);
    const queued = await deps.jobs.setPhase(job.id, "queued");
    return { job: toJobView(queued ?? attached ?? job) };
  } catch {
    return { job: toJobView(job) };
  }
}
