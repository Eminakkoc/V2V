import type { JobStatus } from "./job-status";

// The five F18 buckets minus "All", which is the absence of any filter rather
// than a value. The mapping is recorded in architecture.md section 7; the two
// judgement calls are abandoned reading as Failed (the job produced nothing)
// and finalizing reading as In progress (the result is still being stored).
export const STATUS_BUCKETS = ["in-progress", "taking-longer", "complete", "failed"] as const;

export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export const BUCKET_STATUSES: Record<StatusBucket, readonly JobStatus[]> = {
  "in-progress": ["processing", "finalizing"],
  "taking-longer": ["timed_out"],
  complete: ["complete"],
  // superseded belongs to no bucket: those rows are previous attempts, nested
  // under their latest job, and the include-previous toggle -- not the filter --
  // is what promotes them to top-level cards.
  failed: ["failed", "abandoned"],
};

export const BUCKET_LABELS: Record<StatusBucket, string> = {
  "in-progress": "In progress",
  "taking-longer": "Taking longer",
  complete: "Complete",
  failed: "Failed",
};

export type StatusFilter = { status?: JobStatus; statusBucket?: StatusBucket };

export function resolveStatuses(input: StatusFilter): JobStatus[] | undefined {
  if (input.statusBucket) return [...BUCKET_STATUSES[input.statusBucket]];
  if (input.status) return [input.status];
  return undefined;
}

export function matchesFilter(status: JobStatus, input: StatusFilter): boolean {
  const statuses = resolveStatuses(input);
  return statuses === undefined || statuses.includes(status);
}
