import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import { useJobPolling } from "@/components/job/job-polling-provider";
import type { HistoryJobView } from "@/lib/history-contract";
import type { StatusFilter } from "@/lib/history-filters";
import { mergeRefreshed } from "@/lib/history-merge";
import { changeableIdsOf } from "@/lib/job-status";

// Stable reference so an unset `additional` never appears to change.
const NO_ADDITIONAL_ROWS: readonly HistoryJobView[] = [];

export type UseHistoryRefreshOptions = {
  initial: readonly HistoryJobView[];
  // Rows loaded after mount by `load more`, registered with the poll once they arrive.
  additional?: readonly HistoryJobView[];
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  filter: StatusFilter;
  style?: string;
  includePrevious: boolean;
  hasMore: boolean;
};

export type UseHistoryRefreshResult = {
  // Readonly so mergeRefreshed can hand back the array it was given when nothing changed.
  jobs: readonly HistoryJobView[];
  error: boolean;
  stalled: boolean;
};

// Folds the shared poll's rows into the server-rendered page, and subscribes to it by reading it.
export function useHistoryRefresh({
  initial,
  additional = NO_ADDITIONAL_ROWS,
  sort,
  dir,
  filter,
  style,
  includePrevious,
  hasMore,
}: UseHistoryRefreshOptions): UseHistoryRefreshResult {
  const { jobs: live, trackChangeable, error, stalled } = useJobPolling();
  const registeredIdsRef = useRef<Set<string>>(new Set());

  // Derived, not accumulated: the poll already holds every row it has ever reported.
  const loaded = useMemo(() => {
    const seen = new Set<string>();
    const rows: HistoryJobView[] = [];
    // Appended, never re-sorted: a `load more` page is already ordered after the rows above it.
    for (const row of [...initial, ...additional]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  }, [initial, additional]);

  const { status, statusBucket } = filter;
  const jobs = useMemo(
    () =>
      mergeRefreshed(loaded, live, {
        sort,
        dir,
        filter: { status, statusBucket },
        ...(style !== undefined ? { style } : {}),
        includePrevious,
        hasMore,
      }),
    [loaded, live, sort, dir, status, statusBucket, style, includePrevious, hasMore],
  );

  // Registered even though the server rendered them moments ago: the last tick may predate a change.
  const register = useEffectEvent((rows: readonly HistoryJobView[]) => {
    const unseen = rows.filter((row) => !registeredIdsRef.current.has(row.id));
    if (unseen.length === 0) return;
    for (const row of unseen) registeredIdsRef.current.add(row.id);
    trackChangeable(changeableIdsOf(unseen));
  });

  useEffect(() => {
    register(loaded);
  }, [loaded]);

  return { jobs, error, stalled };
}
