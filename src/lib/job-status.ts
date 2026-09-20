// `timed_out` and `abandoned` are read this cycle but never written: the
// reconciliation pass that produces them is deferred to a later feature, and the
// webhook is the only completion path shipped here. The readers -- countActive's
// bounded active window, labelFor's status arms and the retry dialog's
// RETRYABLE_STATUSES -- are written to accept them the moment they become
// producible. They are dormant by construction, not dead code: do not delete
// them, and do not read their branches as tested-and-working.
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

// The statuses reconciliation can still act on. Lives here, not in the
// server-only jobs repository, because the History refresh hook
// (src/hooks/use-history-refresh.ts) needs the same set client-side to seed
// its baseline of what the account currently considers changeable -- a
// second, hand-copied list would let the refresh set and the reconciliation
// set drift apart. src/server/repositories/jobs.ts re-exports this rather
// than defining its own.
export const CHANGEABLE_STATUSES: readonly JobStatus[] = [
  "processing",
  "finalizing",
  "timed_out",
  "superseded",
  "abandoned",
];

export const JOB_PHASES = ["submitting", "queued", "rendering"] as const;

export type JobPhase = (typeof JOB_PHASES)[number];

// Same dormancy as the statuses above: `JOB_ABANDONED` and
// `SUBMISSION_UNCONFIRMED` are only ever set by the deferred reconciliation
// pass, so nothing in this cycle writes them.
export const JOB_ERROR_CODES = [
  "MAGIC_HOUR_JOB_FAILED",
  "MAGIC_HOUR_JOB_CANCELED",
  "JOB_ABANDONED",
  "SUBMISSION_UNCONFIRMED",
  "WEBHOOK_TIMEOUT",
] as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];
