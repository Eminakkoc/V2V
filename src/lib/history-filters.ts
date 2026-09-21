import type { JobStatus } from "./job-status";

// The five buckets minus "All", which is the absence of a filter; the judgement calls are abandoned
// reading as Failed and finalizing as In progress.
export const STATUS_BUCKETS = ["in-progress", "taking-longer", "complete", "failed"] as const;

export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export const BUCKET_STATUSES: Record<StatusBucket, readonly JobStatus[]> = {
  "in-progress": ["processing", "finalizing"],
  "taking-longer": ["timed_out"],
  complete: ["complete"],
  // superseded belongs to no bucket: those rows are previous attempts, promoted by the
  // include-previous toggle rather than by a filter.
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
