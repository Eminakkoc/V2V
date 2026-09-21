export type ActiveCounts = {
  processing: number;
  finalizing: number;
  timedOut: number;
  superseded: number;
};

// Fast while work is young, backing off as it runs longer, and `null` to stop outright -- a live
// endpoint polled forever drains battery and quota on an idle tab.
export function nextDelayMs(active: ActiveCounts, ageMs: number): number | null {
  const live = active.processing + active.finalizing;
  if (live > 0) {
    if (ageMs < 30_000) return 3_000;
    if (ageMs < 120_000) return 10_000;
    return 30_000;
  }
  // countActive stops counting a timed_out/superseded job past its deadline plus grace, so this
  // branch does eventually see 0 and fall through to null.
  if (active.timedOut + active.superseded > 0) return 30_000;
  return null;
}
