import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { apiFetch } from "@/lib/api-client";
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

export function useJobPolling() {
  const [fetchedItems, setFetchedItems] = useState<JobView[]>([]);
  // A job just created via the transform route, shown before it can appear in a
  // fetched page. Kept separate from `fetchedItems` so a poll can drop it by id
  // once the real row arrives, instead of the two ever being merged into one
  // list that has to be de-duplicated in place.
  const [optimisticExtra, setOptimisticExtra] = useState<JobView[]>([]);
  const [delay, setDelay] = useState<number | null>(null);
  // When the currently-live streak started, so the schedule can back off the
  // longer it runs. Reset to null the moment nothing is active.
  const activeSinceRef = useRef<number | null>(null);
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, isVisibleOnServer);

  const fetchOnce = useCallback(async () => {
    try {
      const data = await apiFetch("/api/history", { method: "GET", schema: historyResponseSchema });
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
      // A transient failure (offline, a 5xx) shouldn't stop the poll loop or
      // reset its schedule; the next tick at the existing cadence tries again.
    }
  }, []);

  const onTick = useEffectEvent(() => {
    void fetchOnce();
  });

  // The first fetch, deferred through a timer callback (like the interval
  // below) rather than called directly, so this is a subscription to that
  // timer instead of a synchronous setState-in-effect.
  useEffect(() => {
    const id = setTimeout(() => onTick(), 0);
    return () => clearTimeout(id);
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
    const id = setTimeout(() => onTick(), 0);
    return () => clearTimeout(id);
  }, [visible]);

  const refresh = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const insertOptimistic = useCallback((job: JobView) => {
    setOptimisticExtra((prev) => [job, ...prev.filter((existing) => existing.id !== job.id)]);
  }, []);

  return { jobs: [...optimisticExtra, ...fetchedItems], refresh, insertOptimistic };
}
