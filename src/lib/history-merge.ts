import type { AttemptView, HistoryJobView } from "./history-contract";
import { matchesFilter, type StatusFilter } from "./history-filters";

export type HistorySortKey = [number, number, string];

export type MergeRefreshedOptions = {
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  filter: StatusFilter;
  style?: string;
  includePrevious: boolean;
  hasMore: boolean;
};

// Comparable position for a row under the active sort. Both elements are
// immutable (createdAt never changes; the clip length is fixed once a job is
// created) and neither is status, which is exactly why a row's place in the
// list is always determined even though a refresh just changed its status.
// The id tiebreak keeps the tuple a total order so two rows can never compare
// equal and leave their relative position to sort() to decide arbitrarily.
export function sortKeyOf(row: HistoryJobView, sort: "createdAt" | "duration"): HistorySortKey {
  const createdAtMs = new Date(row.createdAt).getTime();
  if (sort === "duration") {
    // Duplicated from clipSecondsOf in @/server/services/history-cursor rather
    // than imported: that module is server-only, and this one is imported by
    // client components (see AGENTS note on the boundary). Two lines, kept in
    // step with the original's rounding by inspection.
    const clipSeconds = Math.round((row.params.endSeconds - row.params.startSeconds) * 100) / 100;
    return [clipSeconds, createdAtMs, row.id];
  }
  return [createdAtMs, createdAtMs, row.id];
}

function compareKeys(a: HistorySortKey, b: HistorySortKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] < b[2]) return -1;
  if (a[2] > b[2]) return 1;
  return 0;
}

// True when `key` belongs strictly later in the list (further from the top)
// than `boundary`, under the given direction.
function sortsAfter(key: HistorySortKey, boundary: HistorySortKey, dir: "asc" | "desc"): boolean {
  const cmp = compareKeys(key, boundary);
  return dir === "asc" ? cmp > 0 : cmp < 0;
}

// The AttemptView projection of a HistoryJobView: every JobView field it
// carries, minus the two history-only additions.
function toAttemptView(row: HistoryJobView): AttemptView {
  return {
    id: row.id,
    sourceId: row.sourceId,
    status: row.status,
    phase: row.phase,
    params: row.params,
    createdAt: row.createdAt,
    deadlineAt: row.deadlineAt,
    ...(row.completedAt !== undefined ? { completedAt: row.completedAt } : {}),
    ...(row.output !== undefined ? { output: row.output } : {}),
    ...(row.creditsCharged !== undefined ? { creditsCharged: row.creditsCharged } : {}),
    ...(row.errorCode !== undefined ? { errorCode: row.errorCode } : {}),
    ...(row.errorMessage !== undefined ? { errorMessage: row.errorMessage } : {}),
    ...(row.retryOfJobId !== undefined ? { retryOfJobId: row.retryOfJobId } : {}),
    ...(row.supersededByJobId !== undefined ? { supersededByJobId: row.supersededByJobId } : {}),
  };
}

function matchesActiveFilter(row: HistoryJobView, options: MergeRefreshedOptions): boolean {
  if (!matchesFilter(row.status, options.filter)) return false;
  if (options.style !== undefined && row.params.artStyle !== options.style) return false;
  return true;
}

// Folds a batch of freshly-fetched rows (the "changeable" poll) into an
// already-rendered page, in place, without ever duplicating or reordering a
// row a reader is currently looking at.
//
//   - Merge is by id. A row already loaded is replaced, never appended --
//     appending would duplicate a row a later `load more` returns again.
//   - A refreshed `superseded` row (when includePrevious is false) never
//     becomes/stays a top-level card. Instead its entry inside its latest
//     job's `attempts` chain -- if that job is loaded -- is updated in place.
//   - A not-yet-loaded row that matches the active filter is inserted at its
//     sort position, but only if that position falls inside the loaded
//     window (at or before the last loaded row). If it would sort after the
//     last loaded row and more pages remain, it is left for `load more`.
//   - A loaded row whose refreshed status stops matching the active filter
//     stays exactly where it is -- eviction would rearrange the list under a
//     reader mid-read.
//
// Pure: builds a new array, never mutates `loaded`, `refreshed` or their rows.
export function mergeRefreshed(
  loaded: readonly HistoryJobView[],
  refreshed: readonly HistoryJobView[],
  options: MergeRefreshedOptions,
): HistoryJobView[] {
  const byId = new Map(loaded.map((row) => [row.id, row]));
  const boundary = loaded.length > 0 ? sortKeyOf(loaded[loaded.length - 1]!, options.sort) : null;

  let inserted = false;
  const hiddenSuperseded: HistoryJobView[] = [];

  for (const row of refreshed) {
    if (row.status === "superseded" && !options.includePrevious) {
      byId.delete(row.id);
      hiddenSuperseded.push(row);
      continue;
    }

    if (byId.has(row.id)) {
      byId.set(row.id, row);
      continue;
    }

    if (!matchesActiveFilter(row, options)) continue;

    const key = sortKeyOf(row, options.sort);
    const withinLoadedWindow =
      boundary === null || !(sortsAfter(key, boundary, options.dir) && options.hasMore);
    if (!withinLoadedWindow) continue;

    byId.set(row.id, row);
    inserted = true;
  }

  // Second pass: a superseded row's chain owner may only just have been
  // inserted above (its retry can arrive in the same refresh batch), so this
  // has to run after every top-level insertion/replacement is settled.
  for (const row of hiddenSuperseded) {
    const targetId = row.supersededByJobId;
    if (!targetId) continue;
    const target = byId.get(targetId);
    if (!target) continue;
    if (!target.attempts.some((attempt) => attempt.id === row.id)) continue;

    byId.set(targetId, {
      ...target,
      attempts: target.attempts.map((attempt) =>
        attempt.id === row.id ? toAttemptView(row) : attempt,
      ),
    });
  }

  const merged = [...byId.values()];
  if (!inserted) return merged;

  return merged.sort((a, b) => {
    const ak = sortKeyOf(a, options.sort);
    const bk = sortKeyOf(b, options.sort);
    return options.dir === "asc" ? compareKeys(ak, bk) : compareKeys(bk, ak);
  });
}
