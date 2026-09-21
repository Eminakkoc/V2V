import "server-only";
import type { JobView } from "@/lib/transform-contract";
import type { Job } from "@/server/repositories/jobs";

// The browser-facing projection: internal bookkeeping is withheld, two fields of which identify the
// provider record.
export function toJobView(job: Job): JobView {
  return {
    id: job.id,
    sourceId: job.sourceId,
    status: job.status,
    phase: job.phase,
    params: job.params,
    createdAt: job.createdAt.toISOString(),
    deadlineAt: job.deadlineAt.toISOString(),
    ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
    ...(job.output ? { output: job.output } : {}),
    ...(job.creditsCharged !== undefined ? { creditsCharged: job.creditsCharged } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    ...(job.retryOfJobId ? { retryOfJobId: job.retryOfJobId } : {}),
    ...(job.supersededByJobId ? { supersededByJobId: job.supersededByJobId } : {}),
  };
}
