import type { JobStatus } from "./job-status";

const LIVE: readonly JobStatus[] = ["processing", "finalizing"];
const WAITING: readonly JobStatus[] = ["timed_out", "superseded"];

// Separate from polling-schedule.ts, which keys on active counts that exclude `abandoned` --
// reusing it would stop refreshing while reconciliation still checks those hourly.
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
  // Only abandoned jobs left, and those are re-checked at most hourly, so anything faster spends
  // requests to learn nothing.
  return 300_000;
}
