export type ActiveCounts = {
  processing: number;
  finalizing: number;
  timedOut: number;
  superseded: number;
};

// How often the history endpoint is polled while `ageMs` (time since work last
// became live) grows: fast while young, backing off as it runs longer, and
// stopping outright once nothing needs checking. A live endpoint polled forever
// is a battery and quota drain on an idle tab, so `null` must mean "stop".
export function nextDelayMs(active: ActiveCounts, ageMs: number): number | null {
  const live = active.processing + active.finalizing;
  if (live > 0) {
    if (ageMs < 30_000) return 3_000;
    if (ageMs < 120_000) return 10_000;
    return 30_000;
  }
  if (active.timedOut + active.superseded > 0) return 30_000;
  return null;
}
