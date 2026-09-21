import "server-only";
import type { JobErrorCode } from "@/lib/job-status";
import type { ServerDeps } from "@/server/deps";
import { AppError } from "@/server/errors/app-error";
import { mapProviderStatus } from "@/server/providers/magic-hour-mapping";
import { CLOUDINARY_FOLDERS, type StoredVideo } from "@/server/providers/types";
import type { Job } from "@/server/repositories/jobs";

// A finalizing job whose claim is older than this is presumed crashed and is reclaimable.
export const STALE_CLAIM_MS = 5 * 60 * 1000;

export const FINALIZE_COPY_BUDGET_MS = 40_000;

export type FinalizeOutcome =
  | { kind: "completed"; job: Job }
  | { kind: "already-complete" }
  | { kind: "already-terminal" }
  | { kind: "claim-held" }
  | { kind: "failed"; errorCode: string }
  | { kind: "transient" };

export type FinalizeDeps = Pick<ServerDeps, "config" | "jobs" | "cloudinary" | "magicHour">;

export function failureMessage(code: JobErrorCode, providerMessage: string | undefined): string {
  if (providerMessage) return providerMessage;
  switch (code) {
    case "MAGIC_HOUR_JOB_FAILED":
      return "Magic Hour reported the transform failed.";
    case "MAGIC_HOUR_JOB_CANCELED":
      return "Magic Hour reported the transform was canceled.";
    default:
      return "The transform could not be completed.";
  }
}

// Every early return here has already released the claim; only the Cloudinary call catches its own
// throw, every other one escapes to finalizeJob's catch.
async function storeResult(claimed: Job, deps: FinalizeDeps, at: Date): Promise<FinalizeOutcome> {
  const jobId = claimed.id;

  // The create call's answer never reached this job; wait for a later delivery to retry.
  if (!claimed.magicHourId) {
    await deps.jobs.releaseClaim(jobId);
    return { kind: "transient" };
  }

  const details = await deps.magicHour.getJobDetails(claimed.magicHourId);
  const mapped = mapProviderStatus(details.status);

  if (mapped.kind === "failed") {
    const failed = await deps.jobs.markFailed(jobId, {
      errorCode: mapped.errorCode,
      errorMessage: failureMessage(mapped.errorCode, details.error?.message),
      ...(details.error ? { magicHourError: details.error } : {}),
    });
    // null only means the job already completed, and that stored result must not be eclipsed by a
    // late failure.
    return failed ? { kind: "failed", errorCode: mapped.errorCode } : { kind: "already-complete" };
  }

  if (mapped.kind === "progress" || mapped.kind === "ignored") {
    // The completed webhook beat Magic Hour's own record to us.
    await deps.jobs.releaseClaim(jobId);
    return { kind: "transient" };
  }

  const url = details.downloads[0]?.url;
  if (!url) {
    // The download URL may simply not be published yet; Magic Hour redelivers.
    await deps.jobs.releaseClaim(jobId);
    return { kind: "transient" };
  }

  let video: StoredVideo;
  try {
    video = await deps.cloudinary.copyVideoFromUrl(url, {
      deadline: at.getTime() + FINALIZE_COPY_BUDGET_MS,
      folder: CLOUDINARY_FOLDERS.results,
      // A render already paid for: a sanity failure must release the claim for a redelivery rather
      // than fail the job.
      treatSanityFailureAsRetryable: true,
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.retryable) {
      await deps.jobs.releaseClaim(jobId);
      return { kind: "transient" };
    }
    const failed = await deps.jobs.markFailed(jobId, {
      errorCode: error.code,
      errorMessage: error.message,
    });
    return failed ? { kind: "failed", errorCode: error.code } : { kind: "already-complete" };
  }

  const completed = await deps.jobs.markComplete(jobId, {
    output: { cloudinaryPublicId: video.publicId, cloudinaryUrl: video.secureUrl },
    creditsCharged: details.creditsCharged ?? undefined,
  });
  if (!completed) throw new Error(`job ${jobId} vanished during finalize`);
  return { kind: "completed", job: completed };
}

export async function finalizeJob(
  jobId: string,
  deps: FinalizeDeps,
  now: () => Date = () => new Date(),
): Promise<FinalizeOutcome> {
  const at = now();
  const claimed = await deps.jobs.claimForFinalize(
    jobId,
    at,
    new Date(at.getTime() - STALE_CLAIM_MS),
  );
  if (!claimed) {
    // claimForFinalize refused: the job is either terminal (so redelivery must stop) or freshly
    // claimed by someone else (so a later retry is worth it).
    const current = await deps.jobs.findByIdUnscoped(jobId);
    if (current?.status === "complete") return { kind: "already-complete" };
    if (current?.status === "failed") return { kind: "already-terminal" };
    return { kind: "claim-held" };
  }

  try {
    return await storeResult(claimed, deps, at);
  } catch (error) {
    // Any escape from storeResult must not leave the claim held until STALE_CLAIM_MS elapses.
    await deps.jobs.releaseClaim(jobId);
    throw error;
  }
}
