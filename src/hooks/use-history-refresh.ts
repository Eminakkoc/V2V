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

// Server render has no `document`; assume visible so the first client render doesn't briefly pause.
function isVisibleOnServer() {
  return true;
}

// Duplicated from history-refresh-schedule.ts, which exports only the finished delay: this hook
// also needs to know whether anything is live, to track how long the streak has run.
const LIVE_STATUSES: readonly JobStatus[] = ["processing", "finalizing"];

// A failure means we don't know whether anything changed, so retry at a fixed cadence rather than
// stopping -- bounded, so a dead endpoint doesn't poll forever.
const RETRY_DELAY_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 5;

// historyQuerySchema caps `ids` at 50 entries, so a pathological tick cannot build a request the
// server would reject outright.
const MAX_IDS_PER_REQUEST = 50;

// Stable reference so an unset `additional` never appears to change and re-run the fold effect
// below.
const NO_ADDITIONAL_ROWS: readonly HistoryJobView[] = [];

export type UseHistoryRefreshOptions = {
  initial: readonly HistoryJobView[];
  // Rows loaded after mount by `load more`; unlike `initial`, each is folded in -- and seeds its
  // own changeable-id baseline entry -- only once it actually arrives.
  additional?: readonly HistoryJobView[];
  sort: "createdAt" | "duration";
  dir: "asc" | "desc";
  filter: StatusFilter;
  style?: string;
  includePrevious: boolean;
  hasMore: boolean;
};

export type UseHistoryRefreshResult = {
  // Readonly so mergeRefreshed can hand back the array it was given when a poll changed nothing,
  // instead of an equal copy React would re-render for.
  jobs: readonly HistoryJobView[];
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
  const [jobs, setJobs] = useState<readonly HistoryJobView[]>(() => [...initial]);
  const [delay, setDelay] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [stalled, setStalled] = useState(false);

  // The changeable ids from the last fully successful poll, seeded from `initial` because the
  // server-rendered page schedules reconciliation on its own request -- an empty baseline would
  // miss a job that finished before the first client poll and never issue the `ids` lookup.
  const previousChangeableIdsRef = useRef<Set<string>>(
    new Set(initial.filter((row) => CHANGEABLE_STATUSES.includes(row.status)).map((row) => row.id)),
  );
  const knownIdsRef = useRef<Set<string>>(new Set(initial.map((row) => row.id)));

  // Folds a newly-loaded page into this hook's own tracked list; without it the next poll treats
  // those rows as not-yet-loaded, and the insertion-window rule keeps them out of live refresh for
  // as long as further pages remain.
  useEffect(() => {
    const unseen = additional.filter((row) => !knownIdsRef.current.has(row.id));
    if (unseen.length === 0) return;
    for (const row of unseen) {
      knownIdsRef.current.add(row.id);
      if (CHANGEABLE_STATUSES.includes(row.status)) previousChangeableIdsRef.current.add(row.id);
    }
    // Appended, never re-sorted: a `load more` page is fetched from the cursor of the last row on
    // screen, so it is already ordered after everything in `jobs`.
    setJobs((prev) => [...prev, ...unseen]);
  }, [additional]);

  // When the currently-live streak started, so the schedule can back off the longer it runs.
  const activeSinceRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, isVisibleOnServer);
  const online = useSyncExternalStore(subscribeOnlineStatus, isOnline, isOnlineOnServer);

  const onTick = useEffectEvent(() => {
    void (async () => {
      // A visibility resync can race a still-in-flight scheduled tick, so only the newest request
      // may update state.
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
        // Superseded by a newer request, which owns the resulting state.
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

  // Kept even though `initial` was rendered moments ago: ?changeable=true is account-wide and
  // unfiltered, so on a filtered view it reports rows the render never mentioned.
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
    onTick();
  }, [visible, online]);

  return { jobs, error, stalled };
}
