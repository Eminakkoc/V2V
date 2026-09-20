import "server-only";
import type { JobErrorCode } from "@/lib/job-status";
import type { ServerDeps } from "@/server/deps";
import { AppError } from "@/server/errors/app-error";
import { mapProviderStatus } from "@/server/providers/magic-hour-mapping";
import type { StoredVideo } from "@/server/providers/types";
import type { Job } from "@/server/repositories/jobs";

// A finalizing job whose claim is older than this is presumed crashed and is
// reclaimable by any subsequent finalizeJob call (including reconciliation).
export const STALE_CLAIM_MS = 5 * 60 * 1000;

// The window given to the one Cloudinary copy attempt this call makes.
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

// Everything that happens once a claim is held. Every early return here has
// already released the claim; the one thing it must never do is throw without
// releasing, which is why the Cloudinary call is the only step with its own
// catch — every other throw is left to escape to finalizeJob's own catch.
async function storeResult(claimed: Job, deps: FinalizeDeps, at: Date): Promise<FinalizeOutcome> {
  const jobId = claimed.id;

  // The create call's answer never reached this job. Nothing to reconcile
  // against yet; wait for a future delivery (or reconciliation) to retry.
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
    // null only means the job was already complete (markFailed's guard): a
    // stored result already exists and this late failure must not eclipse it.
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
      // Unlike a user upload, this is a render already paid for. A sanity
      // failure here must not be terminal: release the claim and let a
      // redelivery retry rather than marking a paid job failed.
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
    // claimForFinalize refused: either the job is terminal (never claimable
    // again — Magic Hour must stop redelivering) or someone else holds a
    // fresh claim (genuinely worth a later retry). Only "failed" reaches here
    // as terminal-but-not-complete: every other unclaimable status is either
    // "complete" (handled separately) or still claimable by design.
    const current = await deps.jobs.findByIdUnscoped(jobId);
    if (current?.status === "complete") return { kind: "already-complete" };
    if (current?.status === "failed") return { kind: "already-terminal" };
    return { kind: "claim-held" };
  }

  try {
    return await storeResult(claimed, deps, at);
  } catch (error) {
    // Any escape from storeResult must not leave the claim held, or the job
    // sits looking like someone is working on it until STALE_CLAIM_MS elapses.
    await deps.jobs.releaseClaim(jobId);
    throw error;
  }
}
