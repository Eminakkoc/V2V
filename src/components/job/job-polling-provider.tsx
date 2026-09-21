"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { apiFetch } from "@/lib/api-client";
import { historyJobsResponseSchema, type HistoryJobView } from "@/lib/history-contract";
import { nextRefreshDelayMs } from "@/lib/history-refresh-schedule";
import { jsonEqual } from "@/lib/json-equal";
import { changeableIdsOf, type JobStatus } from "@/lib/job-status";
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

// The schedule exports only the delay, but the streak's age has to be tracked here.
const LIVE_STATUSES: readonly JobStatus[] = ["processing", "finalizing"];

// A failure means we don't know whether work is active, so retry at a fixed cadence rather than
// stopping -- bounded, so a dead endpoint doesn't poll forever.
const RETRY_DELAY_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 5;

// historyQuerySchema caps `ids` at 50, so a pathological tick cannot build a rejected request.
const MAX_IDS_PER_REQUEST = 50;

// Used only once the schedule has stopped; a live schedule's own delay is stricter and wins.
const ARRIVAL_STALE_MS = 30_000;

function newestFirst(a: HistoryJobView, b: HistoryJobView): number {
  const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Accumulated, not replaced: a finished job leaves the changeable list but is still needed.
function foldRows(
  held: readonly HistoryJobView[],
  refreshed: readonly HistoryJobView[],
): readonly HistoryJobView[] {
  const byId = new Map(held.map((row) => [row.id, row]));
  let changed = false;
  for (const row of refreshed) {
    const existing = byId.get(row.id);
    if (existing !== undefined && jsonEqual(existing, row)) continue;
    byId.set(row.id, row);
    changed = true;
  }
  return changed ? [...byId.values()].sort(newestFirst) : held;
}

type JobPollingValue = {
  jobs: readonly HistoryJobView[];
  refresh: () => void;
  insertOptimistic: (job: HistoryJobView) => void;
  // Registers rows a page holds, so a status they leave behind is still looked up.
  trackChangeable: (ids: readonly string[]) => void;
  error: boolean;
  stalled: boolean;
};

type InternalValue = JobPollingValue & { subscribe: () => () => void };

const JobPollingContext = createContext<InternalValue | null>(null);

// The one poll in the app: both pages read these rows, and it runs only while one of them does.
export function JobPollingProvider({ children }: { children: React.ReactNode }) {
  const [fetchedItems, setFetchedItems] = useState<readonly HistoryJobView[]>([]);
  // Kept separate from `fetchedItems` so a poll can drop it by id once the real row arrives,
  // instead of de-duplicating one merged list in place.
  const [optimisticExtra, setOptimisticExtra] = useState<readonly HistoryJobView[]>([]);
  const [delay, setDelay] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [readers, setReaders] = useState(0);
  // When the currently-live streak started, so the schedule can back off the longer it runs.
  const activeSinceRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fetchedAtRef = useRef<number | null>(null);
  // Expected to still be changeable; whatever the next poll omits is looked up for its final state.
  const trackedIdsRef = useRef<Set<string>>(new Set());
  // Mirrors `readers` for the pause effect below, which must not re-run merely because a page
  // mounted or unmounted.
  const readersRef = useRef(0);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, isVisibleOnServer);
  const online = useSyncExternalStore(subscribeOnlineStatus, isOnline, isOnlineOnServer);

  const fetchOnce = useCallback(async () => {
    // A manual refresh() can race a scheduled tick, so only the newest request may ever update
    // state.
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
      const leftIds = [...trackedIdsRef.current].filter((id) => !currentIds.has(id));

      let refreshed = changeable.items;
      if (leftIds.length > 0) {
        const final = await apiFetch(
          `/api/history?ids=${leftIds.slice(0, MAX_IDS_PER_REQUEST).join(",")}`,
          { method: "GET", schema: historyJobsResponseSchema, signal: controller.signal },
        );
        refreshed = [...refreshed, ...final.items];
      }
      trackedIdsRef.current = currentIds;

      failuresRef.current = 0;
      fetchedAtRef.current = Date.now();
      setError(false);
      setStalled(false);
      setFetchedItems((prev) => foldRows(prev, refreshed));
      setOptimisticExtra((prev) => {
        const kept = prev.filter((job) => !refreshed.some((row) => row.id === job.id));
        return kept.length === prev.length ? prev : kept;
      });

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
  }, []);

  const onTick = useEffectEvent(() => {
    void fetchOnce();
  });

  // Fetches only when the held rows have gone stale, so a hop between the pages costs nothing.
  const onFirstReader = useEffectEvent(() => {
    const fetchedAt = fetchedAtRef.current;
    if (fetchedAt === null || Date.now() - fetchedAt >= (delay ?? ARRIVAL_STALE_MS)) onTick();
  });

  // Keyed on "is anyone reading", not on the count: a second page mounting must not be read as a
  // fresh arrival.
  const hasReaders = readers > 0;
  useEffect(() => {
    if (!hasReaders) return;
    onFirstReader();
  }, [hasReaders]);

  useEffect(() => {
    if (readers === 0 || delay === null || !visible || !online) return;
    const id = setInterval(() => onTick(), delay);
    return () => clearInterval(id);
  }, [readers, delay, visible, online]);

  // Keyed on visibility and connectivity alone: folding the reader count in would read the very
  // first render as a pause and the first subscriber as a resume, firing an extra fetch.
  const wasPausedRef = useRef(false);
  useEffect(() => {
    if (!visible || !online) {
      wasPausedRef.current = true;
      return;
    }
    if (!wasPausedRef.current) return;
    wasPausedRef.current = false;
    if (readersRef.current > 0) onTick();
  }, [visible, online]);

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const insertOptimistic = useCallback((job: HistoryJobView) => {
    for (const id of changeableIdsOf([job])) trackedIdsRef.current.add(id);
    setOptimisticExtra((prev) => [job, ...prev.filter((existing) => existing.id !== job.id)]);
  }, []);

  const trackChangeable = useCallback(
    (ids: readonly string[]) => {
      let added = false;
      for (const id of ids) {
        if (trackedIdsRef.current.has(id)) continue;
        trackedIdsRef.current.add(id);
        added = true;
      }
      // An id the poll never reported cannot be resolved by a tick that may never come.
      if (added && fetchedAtRef.current !== null) void fetchOnce();
    },
    [fetchOnce],
  );

  const subscribe = useCallback(() => {
    readersRef.current += 1;
    setReaders((count) => count + 1);
    return () => {
      readersRef.current -= 1;
      setReaders((count) => count - 1);
    };
  }, []);

  const jobs = useMemo(
    () => [...optimisticExtra, ...fetchedItems],
    [optimisticExtra, fetchedItems],
  );

  const value = useMemo<InternalValue>(
    () => ({ jobs, refresh, insertOptimistic, trackChangeable, error, stalled, subscribe }),
    [jobs, refresh, insertOptimistic, trackChangeable, error, stalled, subscribe],
  );

  return <JobPollingContext.Provider value={value}>{children}</JobPollingContext.Provider>;
}

// Reading the shared poll also declares this page as one of its readers, so the schedule runs while
// a page needs it and stops when none does.
export function useJobPolling(): JobPollingValue {
  const value = useContext(JobPollingContext);
  if (value === null) {
    throw new Error("useJobPolling must be rendered inside <JobPollingProvider>");
  }
  const { subscribe } = value;
  useEffect(() => subscribe(), [subscribe]);
  return value;
}
