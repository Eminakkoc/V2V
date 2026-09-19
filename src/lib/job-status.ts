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
