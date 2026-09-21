import "server-only";
import { mapProviderStatus } from "@/server/providers/magic-hour-mapping";
import type { MagicHourJobDetails } from "@/server/providers/types";
import type { Job } from "@/server/repositories/jobs";
import { failureMessage, finalizeJob, STALE_CLAIM_MS, type FinalizeDeps } from "./finalize";

export const RECONCILE_LIMIT = 5;
// The adapter exposes no abort signal, so this is the only provider-call timeout this module can
// actually trust.
export const PROVIDER_CALL_TIMEOUT_MS = 10_000;
export const BATCH_BUDGET_MS = 45_000;

// Passed in rather than kept in the repository, so the service owns the cadence policy and the
// repository stays a pure selector.
const RECENT_MS = 60_000;
const HOURLY_MS = 60 * 60_000;
const REDELIVERY_MS = 24 * 60 * 60_000;

const ABANDONED_MESSAGE = "We stopped checking this job.";
const UNCONFIRMED_MESSAGE = "We never heard back that this job started.";

export type ReconcileDeps = FinalizeDeps;

// Abandons only the *wait* for a provider call, never the call itself, so every branch that can
// throw this must not have written anything yet.
class BudgetExpired extends Error {
  constructor() {
    super("provider call exceeded its budget");
    this.name = "BudgetExpired";
  }
}

// Races `promise` against the smaller of `perCallMs` and the batch's remaining deadline, always
// clearing the timer and always leaving a handler attached so a late settle cannot surface as an
// unhandled rejection.
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
  // Rule (b): the grace boundary is checked before finalizeJob runs, so a job past deadline plus
  // grace is abandoned outright.
  if (job.status === "finalizing") {
    if (now().getTime() > job.deadlineAt.getTime() + graceMs) {
      await deps.jobs.markAbandoned(job.id, "JOB_ABANDONED", ABANDONED_MESSAGE);
      return;
    }
    await finalizeJob(job.id, deps, now);
    return;
  }

  // No provider id means there is nothing to ask about, and no later pass can learn whether the
  // submission ever reached Magic Hour.
  if (!job.magicHourId) {
    if (now().getTime() > job.deadlineAt.getTime() + graceMs) {
      await deps.jobs.markAbandoned(job.id, "SUBMISSION_UNCONFIRMED", UNCONFIRMED_MESSAGE);
    }
    return;
  }

  let details: MagicHourJobDetails;
  try {
    details = await withBudget(
      deps.magicHour.getJobDetails(job.magicHourId),
      PROVIDER_CALL_TIMEOUT_MS,
      deadline,
      now,
    );
  } catch (error) {
    if (error instanceof BudgetExpired) {
      // Nothing was claimed and nothing written, so a later visit reclaims this job once the
      // straggling call has settled.
      console.warn(`[reconcile] job ${job.id} exceeded its check budget; left untouched`);
      return;
    }
    throw error;
  }

  const mapped = mapProviderStatus(details.status);

  switch (mapped.kind) {
    case "ignored":
      return;

    case "complete":
      await finalizeJob(job.id, deps, now);
      return;

    case "failed":
      // A confirmed provider failure is terminal regardless of where "now" sits relative to the
      // deadline.
      await deps.jobs.markFailedFromCheck(job.id, {
        errorCode: mapped.errorCode,
        errorMessage: failureMessage(mapped.errorCode, details.error?.message),
        ...(details.error ? { magicHourError: details.error } : {}),
      });
      return;

    case "progress": {
      // The provider status decides only the phase; the deadline and grace alone decide the status.
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

// Never rejects on a single job's failure: one throwing must not cost the other four their check.
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
      graceMs,
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

// after() callbacks are not wrapped by withErrorHandling, so this must never reject, only log.
export function scheduleReconciliation(
  userId: string,
  deps: ReconcileDeps,
  now?: () => Date,
): Promise<void> {
  return reconcileUserJobs(userId, deps, now).catch((error: unknown) => {
    console.warn("[reconcile] pass failed:", error);
  });
}
