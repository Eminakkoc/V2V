import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";
import { historyJobsResponseSchema, type HistoryJobView } from "@/lib/history-contract";
import type { StatusFilter } from "@/lib/history-filters";
import { mergeRefreshed } from "@/lib/history-merge";
import type { JobStatus } from "@/lib/job-status";
import { nextRefreshDelayMs } from "@/lib/history-refresh-schedule";

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

export type UseHistoryRefreshOptions = {
  initial: readonly HistoryJobView[];
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
  const previousChangeableIdsRef = useRef<Set<string>>(new Set());
  // When the currently-live streak started, so the schedule can back off the
  // longer it runs. Reset to null the moment nothing is live.
  const activeSinceRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, isVisibleOnServer);

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
    if (delay === null || !visible) return;
    const id = setInterval(() => onTick(), delay);
    return () => clearInterval(id);
  }, [delay, visible]);

  const wasHiddenRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasHiddenRef.current = true;
      return;
    }
    if (!wasHiddenRef.current) return;
    wasHiddenRef.current = false;
    // Same sanctioned re-sync as the mount effect above, triggered by the tab
    // becoming visible again instead of by mounting.
    onTick();
  }, [visible]);

  return { jobs, error, stalled };
}
