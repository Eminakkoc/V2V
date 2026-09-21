import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";
import { historyJobsResponseSchema, type HistoryJobView } from "@/lib/history-contract";
import type { StatusFilter } from "@/lib/history-filters";
import { mergeRefreshed } from "@/lib/history-merge";
import { CHANGEABLE_STATUSES, type JobStatus } from "@/lib/job-status";
import { nextRefreshDelayMs } from "@/lib/history-refresh-schedule";
import { isOnline, isOnlineOnServer, subscribeOnlineStatus } from "@/lib/online-status";

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function isVisible() {
  return document.visibilityState !== "hidden";
}

// Server render has no `document`; assume visible so the first client render
// doesn't briefly pause before the visibility snapshot can be read for real.
function isVisibleOnServer() {
  return true;
}

// Mirrors the private LIVE set in history-refresh-schedule.ts. Duplicated
// rather than imported -- that module exports only the finished
// nextRefreshDelayMs result, and this hook separately needs to know whether
// anything is live in order to track how long the live streak has run for
// that function's own ageMs argument.
const LIVE_STATUSES: readonly JobStatus[] = ["processing", "finalizing"];

// A failure means we don't know whether anything changed, and "unknown" must
// not be treated as "nothing changeable" -- retry at a fixed, conservative
// cadence instead of stopping. But a genuinely dead endpoint shouldn't poll
// forever either, so retries are bounded. Mirrors use-job-polling.ts.
const RETRY_DELAY_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 5;

// historyQuerySchema (src/lib/history-contract.ts) caps `ids` at 50 entries.
// Bounding the follow-up here keeps a pathological number of jobs leaving in
// one tick from building a request the server would reject outright.
const MAX_IDS_PER_REQUEST = 50;

// Stable reference so an unset `additional` never appears to "change" from
// one render to the next and re-run the fold effect below for no reason.
const NO_ADDITIONAL_ROWS: readonly HistoryJobView[] = [];

export type UseHistoryRefreshOptions = {
  initial: readonly HistoryJobView[];
  // Rows loaded after mount by `load more`, growing as more pages come in.
  // Distinct from `initial`: the changeable-id baseline below is seeded
  // from `initial` alone, once, at mount; each of these is folded into this
  // hook's own tracked list -- and seeds its own baseline entry -- only once
  // it actually arrives (see the fold effect below for why this is not
  // optional). `initial` never changes across a mount; this can.
  additional?: readonly HistoryJobView[];
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  filter: StatusFilter;
  style?: string;
  includePrevious: boolean;
  hasMore: boolean;
};

export type UseHistoryRefreshResult = {
  jobs: HistoryJobView[];
  error: boolean;
  stalled: boolean;
};

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
  const [jobs, setJobs] = useState<HistoryJobView[]>(() => [...initial]);
  const [delay, setDelay] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [stalled, setStalled] = useState(false);

  // The changeable ids observed on the previous successful poll. A job
  // present here but absent from the newest poll just left the changeable
  // set -- i.e. it finished -- which is exactly the trigger for the one-off
  // `ids` follow-up below. Committed only once a tick fully succeeds, so a
  // follow-up that fails is retried next tick rather than forgotten.
  //
  // Seeded from `initial` rather than starting empty: the server-rendered
  // page schedules reconciliation via `after()` on the very request that
  // rendered it, so a job can already have finished -- and already have
  // left the changeable set -- before this hook's first client poll ever
  // runs. Starting from an empty baseline would read that as "nothing left"
  // and never issue the `ids` lookup, leaving the card stale until a reload.
  // The rows the server rendered are exactly what the page currently
  // believes is changeable, so they are the correct starting baseline.
  const previousChangeableIdsRef = useRef<Set<string>>(
    new Set(initial.filter((row) => CHANGEABLE_STATUSES.includes(row.status)).map((row) => row.id)),
  );
  // Every id this hook's own `jobs` state already knows about -- `initial`'s
  // at mount, plus each `additional` row's the moment it is folded in below.
  const knownIdsRef = useRef<Set<string>>(new Set(initial.map((row) => row.id)));

  // Folds a newly-loaded page into this hook's own tracked list. Without
  // this, a row `load more` appends is invisible to `jobs` (the list
  // mergeRefreshed treats as "already loaded"), so the next poll's merge
  // sees it as not-yet-loaded and applies the insertion-window rule instead
  // of replacing it in place -- and a `load more` row, being strictly older
  // than everything already on screen, always sorts after the boundary that
  // rule checks, so it is excluded from live refresh for as long as further
  // pages remain, not merely delayed. Folding also seeds this row's own
  // entry in the changeable-id baseline above, mirroring what the mount-time
  // seed does for `initial`, so a row that leaves the changeable set on the
  // very next poll is still looked up via the `ids` follow-up rather than
  // read as "was never changeable".
  useEffect(() => {
    const unseen = additional.filter((row) => !knownIdsRef.current.has(row.id));
    if (unseen.length === 0) return;
    for (const row of unseen) {
      knownIdsRef.current.add(row.id);
      if (CHANGEABLE_STATUSES.includes(row.status)) previousChangeableIdsRef.current.add(row.id);
    }
    // Appended, never re-sorted: a `load more` page is fetched from the
    // cursor of the last row already on screen, so it is always correctly
    // ordered after everything currently in `jobs` under the active sort.
    setJobs((prev) => [...prev, ...unseen]);
  }, [additional]);

  // When the currently-live streak started, so the schedule can back off the
  // longer it runs. Reset to null the moment nothing is live.
  const activeSinceRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, isVisibleOnServer);
  const online = useSyncExternalStore(subscribeOnlineStatus, isOnline, isOnlineOnServer);

  const onTick = useEffectEvent(() => {
    void (async () => {
      // A visibility resync can race a still-in-flight scheduled tick; abort
      // whatever is still running so only the newest request can ever
      // update state.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const changeable = await apiFetch("/api/history?changeable=true", {
          method: "GET",
          schema: historyJobsResponseSchema,
          signal: controller.signal,
        });

        const currentIds = new Set(changeable.items.map((row) => row.id));
        const leftIds = [...previousChangeableIdsRef.current].filter((id) => !currentIds.has(id));

        let refreshed = changeable.items;
        if (leftIds.length > 0) {
          const final = await apiFetch(
            `/api/history?ids=${leftIds.slice(0, MAX_IDS_PER_REQUEST).join(",")}`,
            { method: "GET", schema: historyJobsResponseSchema, signal: controller.signal },
          );
          refreshed = [...refreshed, ...final.items];
        }
        // Only committed now that both requests this tick have succeeded --
        // see the ref's own comment for why.
        previousChangeableIdsRef.current = currentIds;

        failuresRef.current = 0;
        setError(false);
        setStalled(false);
        setJobs((prev) =>
          mergeRefreshed(prev, refreshed, {
            sort,
            dir,
            filter,
            ...(style !== undefined ? { style } : {}),
            includePrevious,
            hasMore,
          }),
        );

        const live = changeable.items.some((row) => LIVE_STATUSES.includes(row.status));
        if (live) {
          activeSinceRef.current ??= Date.now();
        } else {
          activeSinceRef.current = null;
        }
        const ageMs = activeSinceRef.current === null ? 0 : Date.now() - activeSinceRef.current;
        setDelay(nextRefreshDelayMs(changeable.items, ageMs));
      } catch {
        // Superseded by a newer request -- not a real failure, and that
        // newer request owns the resulting state.
        if (controller.signal.aborted) return;
        failuresRef.current += 1;
        setError(true);
        if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          setStalled(true);
          setDelay(null);
        } else {
          setDelay(RETRY_DELAY_MS);
        }
      }
    })();
  });

  // Syncing with the history endpoint on mount is a sanctioned use of an
  // Effect (react.dev/learn/synchronizing-with-effects).
  useEffect(() => {
    onTick();
  }, []);

  useEffect(() => {
    if (delay === null || !visible || !online) return;
    const id = setInterval(() => onTick(), delay);
    return () => clearInterval(id);
  }, [delay, visible, online]);

  const wasPausedRef = useRef(false);
  useEffect(() => {
    if (!visible || !online) {
      wasPausedRef.current = true;
      return;
    }
    if (!wasPausedRef.current) return;
    wasPausedRef.current = false;
    // Same sanctioned re-sync as the mount effect above, triggered by the tab
    // becoming visible or the browser coming back online instead of by
    // mounting.
    onTick();
  }, [visible, online]);

  return { jobs, error, stalled };
}
