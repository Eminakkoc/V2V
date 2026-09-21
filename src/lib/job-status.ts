export const JOB_STATUSES = [
  "processing",
  "finalizing",
  "complete",
  "failed",
  "timed_out",
  "superseded",
  "abandoned",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

// Kept here rather than in the server-only jobs repository because the History refresh hook needs
// the same set client-side; jobs.ts re-exports this one.
export const CHANGEABLE_STATUSES: readonly JobStatus[] = [
  "processing",
  "finalizing",
  "timed_out",
  "superseded",
  "abandoned",
];

export function changeableIdsOf(rows: readonly { id: string; status: JobStatus }[]): string[] {
  return rows.filter((row) => CHANGEABLE_STATUSES.includes(row.status)).map((row) => row.id);
}

export const JOB_PHASES = ["submitting", "queued", "rendering"] as const;

export type JobPhase = (typeof JOB_PHASES)[number];

// `JOB_ABANDONED` and `SUBMISSION_UNCONFIRMED` are written only by reconciliation -- never by the
// webhook path, and never on the request that created the job.
export const JOB_ERROR_CODES = [
  "MAGIC_HOUR_JOB_FAILED",
  "MAGIC_HOUR_JOB_CANCELED",
  "JOB_ABANDONED",
  "SUBMISSION_UNCONFIRMED",
  "WEBHOOK_TIMEOUT",
] as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];
