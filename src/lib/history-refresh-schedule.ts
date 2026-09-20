import type { JobStatus } from "./job-status";

const LIVE: readonly JobStatus[] = ["processing", "finalizing"];
const WAITING: readonly JobStatus[] = ["timed_out", "superseded"];

// Deliberately separate from polling-schedule.ts, which the Create page owns.
// That one keys on the `active` counts, and those exclude `abandoned` -- reusing
// it here would stop refreshing while reconciliation rule (c) is still checking
// abandoned jobs hourly, and widening it would change the Create page.
export function nextRefreshDelayMs(
  changeable: readonly { status: JobStatus }[],
  ageMs: number,
): number | null {
  if (changeable.length === 0) return null;
  if (changeable.some((row) => LIVE.includes(row.status))) {
    if (ageMs < 30_000) return 3_000;
    if (ageMs < 120_000) return 10_000;
    return 30_000;
  }
  if (changeable.some((row) => WAITING.includes(row.status))) return 30_000;
  // Only abandoned jobs left, and rule (c) re-checks those at most hourly, so
  // anything faster than this spends requests to learn nothing.
  return 300_000;
}
