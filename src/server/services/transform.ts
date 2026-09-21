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

// Matching the numeric duplicate-key code specifically keeps a genuine database or bad-write error
// from being mistaken for a duplicate submission.
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
  const existing = await deps.jobs.findByIdempotencyKey(userId, body.idempotencyKey);
  if (existing) return { job: toJobView(existing) };

  // findById is owner-scoped, so this both loads the source and enforces that the caller owns it.
  const source = await deps.sources.findById(userId, body.sourceId);
  if (!source) throw new AppError("SOURCE_NOT_FOUND");

  const { startSeconds, endSeconds } = body.params;
  const clipSeconds = endSeconds - startSeconds;
  // The 0.05 is a deliberate epsilon: Cloudinary rounds the duration it reports, so an end exactly
  // at the source's real end can arrive a hair past the stored value.
  if (clipSeconds > deps.config.maxClipSeconds || endSeconds > source.duration + 0.05) {
    throw new AppError("CLIP_TOO_LONG");
  }

  let retryOf: Job | null = null;
  if (body.retryOfJobId) {
    // Deliberately not owner-scoped -- retrying another user's job is accepted here, and the source
    // check above still refuses a cross-user retry.
    retryOf = await deps.jobs.findByIdUnscoped(body.retryOfJobId);
  }

  // The job row must exist before the provider call, so a lost answer still has a record to
  // reconcile against.
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
    // Two requests raced past the idempotency check and the unique index rejected the loser;
    // re-reading the winner keeps one job per idempotencyKey under genuine concurrency.
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
      // The provider did not take the job: mark it failed so it shows in History, and rethrow so
      // the caller sees the error too.
      await deps.jobs.markFailed(job.id, {
        errorCode: error.code,
        errorMessage: error.message,
        ...(error.providerError ? { magicHourError: error.providerError } : {}),
      });
      throw error;
    }
    // Uncertain outcome, and deliberately any non-AppError too: when we cannot tell whether the
    // provider took the job, leave it for reconciliation rather than failing it on a guess.
    await deps.jobs.setLastError(job.id, errorMessage(error));
    return { job: toJobView(job) };
  }

  // Best-effort: a lost magicHourId is recoverable through the webhook's name fallback, so a
  // failure here must not be reported as a failed submission.
  try {
    const attached = await deps.jobs.attachMagicHourId(job.id, magicHourId);
    const queued = await deps.jobs.setPhase(job.id, "queued");
    return { job: toJobView(queued ?? attached ?? job) };
  } catch {
    return { job: toJobView(job) };
  }
}
