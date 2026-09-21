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
import { jsonEqual } from "@/lib/json-equal";
import { isOnline, isOnlineOnServer, subscribeOnlineStatus } from "@/lib/online-status";
import { nextDelayMs } from "@/lib/polling-schedule";

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

// A failure means we don't know whether work is active, and "unknown" must
// not be treated as "idle" — retry at a fixed, conservative cadence instead
// of stopping. But a genuinely dead endpoint shouldn't poll forever either,
// so retries are bounded.
const RETRY_DELAY_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 5;

// How old the held rows may be before a page that starts reading them asks
// for fresh ones. Used only when nothing is active and the schedule has
// therefore stopped; while something is live the schedule's own delay is the
// stricter figure and wins.
const ARRIVAL_STALE_MS = 30_000;

type JobPollingValue = {
  jobs: readonly HistoryJobView[];
  refresh: () => void;
  insertOptimistic: (job: HistoryJobView) => void;
  error: boolean;
  stalled: boolean;
};

type InternalValue = JobPollingValue & { subscribe: () => () => void };

const JobPollingContext = createContext<InternalValue | null>(null);

// Lives in the root layout, which is not re-created when the router moves
// between Create and History -- so the poll survives navigation instead of
// being torn down and restarted, and re-arriving on Create no longer costs a
// request for rows already in hand. It polls only while a page is actually
// reading it, so sitting on History (which refreshes its own list against the
// active query) adds nothing.
export function JobPollingProvider({ children }: { children: React.ReactNode }) {
  const [fetchedItems, setFetchedItems] = useState<readonly HistoryJobView[]>([]);
  // A job just created via the transform route, shown before it can appear in a
  // fetched page. Kept separate from `fetchedItems` so a poll can drop it by id
  // once the real row arrives, instead of the two ever being merged into one
  // list that has to be de-duplicated in place.
  const [optimisticExtra, setOptimisticExtra] = useState<readonly HistoryJobView[]>([]);
  const [delay, setDelay] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [readers, setReaders] = useState(0);
  // When the currently-live streak started, so the schedule can back off the
  // longer it runs. Reset to null the moment nothing is active.
  const activeSinceRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fetchedAtRef = useRef<number | null>(null);
  // Mirrors `readers` for the pause effect below, which must not re-run (and
  // so must not re-sync) merely because a page mounted or unmounted.
  const readersRef = useRef(0);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, isVisibleOnServer);
  const online = useSyncExternalStore(subscribeOnlineStatus, isOnline, isOnlineOnServer);

  const fetchOnce = useCallback(async () => {
    // A manual refresh() can race a scheduled tick; abort whatever is still
    // in flight so only the newest request can ever update state.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await apiFetch("/api/history", {
        method: "GET",
        schema: historyJobsResponseSchema,
        signal: controller.signal,
      });
      failuresRef.current = 0;
      fetchedAtRef.current = Date.now();
      setError(false);
      setStalled(false);
      // Identical rows keep the objects already on screen: a poll exists to
      // notice the job that moved, and replacing every row with an equal copy
      // re-renders the page for a tick that learned nothing.
      setFetchedItems((prev) => (jsonEqual(prev, data.items) ? prev : data.items));
      setOptimisticExtra((prev) => {
        const kept = prev.filter((job) => !data.items.some((item) => item.id === job.id));
        return kept.length === prev.length ? prev : kept;
      });

      const live = data.active.processing + data.active.finalizing;
      if (live > 0) {
        activeSinceRef.current ??= Date.now();
      } else {
        activeSinceRef.current = null;
      }
      const ageMs = activeSinceRef.current === null ? 0 : Date.now() - activeSinceRef.current;
      setDelay(nextDelayMs(data.active, ageMs));
    } catch {
      // Superseded by a newer request — not a real failure, and that newer
      // request owns the resulting state.
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

  // Fetches only when the held rows cannot answer for themselves: nothing
  // fetched yet, or nothing active and what we have has gone stale. Arriving
  // back on Create a few seconds after leaving it therefore costs nothing.
  const onFirstReader = useEffectEvent(() => {
    const fetchedAt = fetchedAtRef.current;
    if (fetchedAt === null || Date.now() - fetchedAt >= (delay ?? ARRIVAL_STALE_MS)) onTick();
  });

  // Keyed on "is anyone reading", not on the count: a second page mounting
  // must not be read as a fresh arrival and trigger another fetch.
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

  // Keyed on visibility and connectivity alone. Folding the reader count in
  // here would read the very first render -- before any page has subscribed --
  // as a pause, and the first subscriber as a resume, firing a second fetch
  // on top of the arrival one below.
  const wasPausedRef = useRef(false);
  useEffect(() => {
    if (!visible || !online) {
      wasPausedRef.current = true;
      return;
    }
    if (!wasPausedRef.current) return;
    wasPausedRef.current = false;
    // Re-sync when the tab becomes visible again or the browser comes back
    // online, where the held rows really can be out of date.
    if (readersRef.current > 0) onTick();
  }, [visible, online]);

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const insertOptimistic = useCallback((job: HistoryJobView) => {
    setOptimisticExtra((prev) => [job, ...prev.filter((existing) => existing.id !== job.id)]);
  }, []);

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
    () => ({ jobs, refresh, insertOptimistic, error, stalled, subscribe }),
    [jobs, refresh, insertOptimistic, error, stalled, subscribe],
  );

  return <JobPollingContext.Provider value={value}>{children}</JobPollingContext.Provider>;
}

// Reading the shared poll also declares this page as one of its readers, so
// the schedule runs while a page needs it and stops when none does.
export function useJobPolling(): JobPollingValue {
  const value = useContext(JobPollingContext);
  if (value === null) {
    throw new Error("useJobPolling must be rendered inside <JobPollingProvider>");
  }
  const { subscribe } = value;
  useEffect(() => subscribe(), [subscribe]);
  return value;
}
