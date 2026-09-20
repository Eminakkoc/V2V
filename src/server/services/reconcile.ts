import "server-only";
import { mapProviderStatus } from "@/server/providers/magic-hour-mapping";
import type { MagicHourJobDetails } from "@/server/providers/types";
import type { Job } from "@/server/repositories/jobs";
import { failureMessage, finalizeJob, STALE_CLAIM_MS, type FinalizeDeps } from "./finalize";

// How many of a caller's unfinished jobs one History request pays to check.
export const RECONCILE_LIMIT = 5;
// The wait this function allows any single provider call, independent of the
// SDK's own internal timeout -- the adapter exposes no abort signal, so this
// is the only timeout this module can actually trust.
export const PROVIDER_CALL_TIMEOUT_MS = 10_000;
// The wall-clock budget for the whole batch of RECONCILE_LIMIT jobs.
export const BATCH_BUDGET_MS = 45_000;

// selectForReconcile's own re-check cadence for the statuses reconciliation
// still touches, passed in here rather than lived in the repository so the
// service owns the policy and the repository stays a pure selector.
const RECENT_MS = 60_000;
const HOURLY_MS = 60 * 60_000;
const REDELIVERY_MS = 24 * 60 * 60_000;

const ABANDONED_MESSAGE = "We stopped checking this job.";

export type ReconcileDeps = FinalizeDeps;

// The race this sentinel signals abandons only the *wait* for a provider
// call, never the call itself: the adapter exposes no abort signal, so a
// call that loses this race is still running underneath and may still
// resolve later. Every branch that can throw this must therefore have
// written nothing yet -- the read has to win before any write is reached,
// not have its write skipped afterwards -- which is exactly what letting
// this propagate out of reconcileOne with no write in between guarantees.
class BudgetExpired extends Error {
  constructor() {
    super("provider call exceeded its budget");
    this.name = "BudgetExpired";
  }
}

// Races `promise` against the smaller of `perCallMs` and whatever remains of
// the batch's own deadline. The timer is always cleared on settle so a
// pending timer can never keep the process alive past the real result; and
// `promise` itself is never abandoned uncaught -- losing the race still
// leaves a handler attached (or, once the budget is already gone, an inert
// .catch) so its eventual settlement can never surface as an unhandled
// rejection.
function withBudget<T>(
  promise: Promise<T>,
  perCallMs: number,
  deadline: number,
  now: () => Date,
): Promise<T> {
  const remaining = deadline - now().getTime();
  const budget = Math.min(perCallMs, remaining);
  if (budget <= 0) {
    promise.catch(() => {});
    return Promise.reject(new BudgetExpired());
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BudgetExpired()), budget);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function reconcileOne(
  job: Job,
  deps: ReconcileDeps,
  now: () => Date,
  deadline: number,
  graceMs: number,
): Promise<void> {
  // Rule (b): a crashed-mid-finalize job. The grace boundary is checked
  // before finalizeJob runs, not after -- a job already past its deadline
  // plus grace is abandoned outright rather than finalized, even though a
  // late result would still be saved if one turned up (finalizeJob still
  // claims abandoned/timed_out/superseded jobs).
  if (job.status === "finalizing") {
    if (now().getTime() > job.deadlineAt.getTime() + graceMs) {
      await deps.jobs.markAbandoned(job.id, "JOB_ABANDONED", ABANDONED_MESSAGE);
      return;
    }
    await finalizeJob(job.id, deps, now);
    return;
  }

  // Rules (a) and (c): selectForReconcile only ever returns these statuses
  // with a magicHourId already attached.
  let details: MagicHourJobDetails;
  try {
    details = await withBudget(
      deps.magicHour.getJobDetails(job.magicHourId!),
      PROVIDER_CALL_TIMEOUT_MS,
      deadline,
      now,
    );
  } catch (error) {
    if (error instanceof BudgetExpired) {
      // Nothing was claimed on this path and nothing has been written --
      // the stale-claim/recent-check window reclaims this job on a later
      // visit, by which point the straggling call has settled or died.
      console.warn(`[reconcile] job ${job.id} exceeded its check budget; left untouched`);
      return;
    }
    throw error;
  }

  const mapped = mapProviderStatus(details.status);

  switch (mapped.kind) {
    case "ignored":
      // draft: nothing to report beyond the selection-time stamp.
      return;

    case "complete":
      await finalizeJob(job.id, deps, now);
      return;

    case "failed":
      // The deadline/grace boundary only governs the progress arms below --
      // a confirmed provider failure or cancellation is terminal regardless
      // of where "now" sits relative to the deadline.
      await deps.jobs.markFailedFromCheck(job.id, {
        errorCode: mapped.errorCode,
        errorMessage: failureMessage(mapped.errorCode, details.error?.message),
        ...(details.error ? { magicHourError: details.error } : {}),
      });
      return;

    case "progress": {
      // The provider status decides only the phase; the deadline and grace
      // alone decide the status. setPhase's own status: "processing" guard
      // makes this call a correct no-op on a job the boundary below (or an
      // earlier pass) has already moved off "processing".
      await deps.jobs.setPhase(job.id, mapped.phase);
      const past = now().getTime();
      if (past > job.deadlineAt.getTime() + graceMs) {
        await deps.jobs.markAbandoned(job.id, "JOB_ABANDONED", ABANDONED_MESSAGE);
      } else if (past > job.deadlineAt.getTime()) {
        await deps.jobs.markTimedOut(job.id);
      }
      return;
    }
  }
}

// Asks the provider about up to RECONCILE_LIMIT of userId's unfinished jobs
// and moves each to the right state. Never rejects on a single job's
// failure: one throwing must not cost the other four their check.
export async function reconcileUserJobs(
  userId: string,
  deps: ReconcileDeps,
  now: () => Date = () => new Date(),
): Promise<void> {
  const startedAt = now();
  const graceMs = deps.config.jobGraceMinutes * 60_000;
  const selected = await deps.jobs.selectForReconcile(
    userId,
    startedAt,
    {
      recentMs: RECENT_MS,
      staleClaimMs: STALE_CLAIM_MS,
      hourlyMs: HOURLY_MS,
      redeliveryMs: REDELIVERY_MS,
    },
    RECONCILE_LIMIT,
  );
  const deadline = startedAt.getTime() + BATCH_BUDGET_MS;

  const results = await Promise.allSettled(
    selected.map((job) => reconcileOne(job, deps, now, deadline, graceMs)),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      console.warn(`[reconcile] job ${selected[index]?.id} failed:`, result.reason);
    }
  }
}

// Fire-and-forget wrapper for an after() callback. after() callbacks are not
// wrapped by withErrorHandling, so an escape here would surface as an
// unhandled rejection on the route's own invocation -- this must never
// reject, only log.
export function scheduleReconciliation(
  userId: string,
  deps: ReconcileDeps,
  now?: () => Date,
): Promise<void> {
  return reconcileUserJobs(userId, deps, now).catch((error: unknown) => {
    console.warn("[reconcile] pass failed:", error);
  });
}
