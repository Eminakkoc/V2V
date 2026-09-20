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

export const JOB_PHASES = ["submitting", "queued", "rendering"] as const;

export type JobPhase = (typeof JOB_PHASES)[number];

export const JOB_ERROR_CODES = [
  "MAGIC_HOUR_JOB_FAILED",
  "MAGIC_HOUR_JOB_CANCELED",
  "JOB_ABANDONED",
  "SUBMISSION_UNCONFIRMED",
] as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];
