import type { AttemptView, HistoryJobView } from "./history-contract";
import { matchesFilter, type StatusFilter } from "./history-filters";
import { jsonEqual } from "./json-equal";

export type HistorySortKey = [number, number, string];

export type MergeRefreshedOptions = {
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  filter: StatusFilter;
  style?: string;
  includePrevious: boolean;
  hasMore: boolean;
};

// Both elements are immutable, so a row's place stays determined even when a refresh changes its
// status; the id tiebreak keeps the tuple a total order.
export function sortKeyOf(row: HistoryJobView, sort: "createdAt" | "duration"): HistorySortKey {
  const createdAtMs = new Date(row.createdAt).getTime();
  if (sort === "duration") {
    // Duplicated from clipSecondsOf rather than imported: that module is server-only, and this one
    // is imported by client components.
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

function sortsAfter(key: HistorySortKey, boundary: HistorySortKey, dir: "asc" | "desc"): boolean {
  const cmp = compareKeys(key, boundary);
  return dir === "asc" ? cmp > 0 : cmp < 0;
}

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

// Folds a batch of freshly-fetched rows into an already-rendered page, purely and by id: a row
// carrying supersededByJobId always updates its entry in its owner's nested attempts (and only
// becomes a top-level card when includePrevious is set), a not-yet-loaded row is inserted only if
// it sorts inside the loaded window, and a loaded row that stops matching the filter stays put
// rather than rearranging the list under a reader.
export function mergeRefreshed(
  loaded: readonly HistoryJobView[],
  refreshed: readonly HistoryJobView[],
  options: MergeRefreshedOptions,
): readonly HistoryJobView[] {
  const byId = new Map(loaded.map((row) => [row.id, row]));
  const boundary = loaded.length > 0 ? sortKeyOf(loaded[loaded.length - 1]!, options.sort) : null;

  let inserted = false;
  // Most polls change nothing, and a merge that rebuilt the list regardless handed every card a new
  // object and re-rendered the page.
  let changed = false;
  const supersededRows: HistoryJobView[] = [];

  for (const row of refreshed) {
    // Keyed on supersededByJobId, not status: the link is written once and never cleared, so a row
    // reconciliation moved off "superseded" still belongs in its owner's chain.
    if (row.supersededByJobId !== undefined) {
      supersededRows.push(row);
      if (!options.includePrevious) {
        if (byId.delete(row.id)) changed = true;
        continue;
      }
    }

    const existing = byId.get(row.id);
    if (existing !== undefined) {
      // The refreshed row is a different object every time; keeping the one already on screen is
      // what lets a memoized card skip the render.
      if (!jsonEqual(existing, row)) {
        byId.set(row.id, row);
        changed = true;
      }
      continue;
    }

    if (!matchesActiveFilter(row, options)) continue;

    const key = sortKeyOf(row, options.sort);
    const withinLoadedWindow =
      boundary === null || !(sortsAfter(key, boundary, options.dir) && options.hasMore);
    if (!withinLoadedWindow) continue;

    byId.set(row.id, row);
    inserted = true;
    changed = true;
  }

  // Second pass, because an owner may only just have been inserted above -- its retry can arrive in
  // the same refresh batch.
  for (const row of supersededRows) {
    const targetId = row.supersededByJobId;
    if (!targetId) continue;
    const target = byId.get(targetId);
    if (!target) continue;
    if (!target.attempts.some((attempt) => attempt.id === row.id)) continue;

    const attempt = toAttemptView(row);
    if (
      target.attempts.some((existing) => existing.id === row.id && jsonEqual(existing, attempt))
    ) {
      continue;
    }
    byId.set(targetId, {
      ...target,
      attempts: target.attempts.map((existing) => (existing.id === row.id ? attempt : existing)),
    });
    changed = true;
  }

  // The identical array, not a copy: React bails out of the update when the next state is the value
  // it already holds.
  if (!changed) return loaded;

  const merged = [...byId.values()];
  if (!inserted) return merged;

  return merged.sort((a, b) => {
    const ak = sortKeyOf(a, options.sort);
    const bk = sortKeyOf(b, options.sort);
    return options.dir === "asc" ? compareKeys(ak, bk) : compareKeys(bk, ak);
  });
}
