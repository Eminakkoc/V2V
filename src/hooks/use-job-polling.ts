import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { apiFetch } from "@/lib/api-client";
import { isOnline, isOnlineOnServer, subscribeOnlineStatus } from "@/lib/online-status";
import { nextDelayMs } from "@/lib/polling-schedule";
import { historyResponseSchema, type JobView } from "@/lib/transform-contract";

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

export function useJobPolling() {
  const [fetchedItems, setFetchedItems] = useState<JobView[]>([]);
  // A job just created via the transform route, shown before it can appear in a
  // fetched page. Kept separate from `fetchedItems` so a poll can drop it by id
  // once the real row arrives, instead of the two ever being merged into one
  // list that has to be de-duplicated in place.
  const [optimisticExtra, setOptimisticExtra] = useState<JobView[]>([]);
  const [delay, setDelay] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [stalled, setStalled] = useState(false);
  // When the currently-live streak started, so the schedule can back off the
  // longer it runs. Reset to null the moment nothing is active.
  const activeSinceRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
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
        schema: historyResponseSchema,
        signal: controller.signal,
      });
      failuresRef.current = 0;
      setError(false);
      setStalled(false);
      setFetchedItems(data.items);
      setOptimisticExtra((prev) =>
        prev.filter((job) => !data.items.some((item) => item.id === job.id)),
      );

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

  // Syncing with the history endpoint on mount is a sanctioned use of an
  // Effect (react.dev/learn/synchronizing-with-effects); the state update
  // the linter flags here is exactly that sync completing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const insertOptimistic = useCallback((job: JobView) => {
    setOptimisticExtra((prev) => [job, ...prev.filter((existing) => existing.id !== job.id)]);
  }, []);

  return { jobs: [...optimisticExtra, ...fetchedItems], refresh, insertOptimistic, error, stalled };
}
