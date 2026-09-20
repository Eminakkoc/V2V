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
  const job = await deps.jobs.insert(userId, {
    sourceId: source.id,
    params: body.params,
    idempotencyKey: body.idempotencyKey,
    status: "processing",
    phase: "submitting",
    deadlineAt: deadlineFor(clipSeconds, deps.config, now()),
    ...(body.retryOfJobId ? { retryOfJobId: body.retryOfJobId } : {}),
  });

  if (retryOf) await deps.jobs.markSuperseded(retryOf.id, job.id);

  try {
    const { magicHourId } = await deps.magicHour.createJob({
      jobId: job.id,
      videoUrl: source.cloudinaryUrl,
      params: body.params,
    });
    const attached = await deps.jobs.attachMagicHourId(job.id, magicHourId);
    const queued = await deps.jobs.setPhase(job.id, "queued");
    return { job: toJobView(queued ?? attached ?? job) };
  } catch (error) {
    if (error instanceof AppError && error.details?.definite === true) {
      // The provider did not take the job: mark it failed so it shows in
      // History, and rethrow so the caller sees the error too. (markFailed
      // can return null when the job is already complete, which cannot
      // happen here on a just-inserted job — the return value is unused.)
      await deps.jobs.markFailed(job.id, {
        errorCode: error.code,
        errorMessage: error.message,
      });
      throw error;
    }
    // Uncertain outcome (timeout, dropped connection, 5xx): the job may
    // still be running at Magic Hour, so it stays processing/submitting and
    // is reconciled later. The caller still gets a 202.
    await deps.jobs.setLastError(job.id, errorMessage(error));
    return { job: toJobView(job) };
  }
}
