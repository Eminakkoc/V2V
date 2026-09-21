// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import {
  transformParamsSchema,
  type HistoryResponse,
  type JobView,
} from "@/lib/transform-contract";
import { useJobPolling } from "./use-job-polling";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

const baseParams = transformParamsSchema.parse({
  name: "clip",
  startSeconds: 0,
  endSeconds: 5,
  artStyle: "Watercolor",
});

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job-1",
    sourceId: "source-1",
    status: "processing",
    phase: "queued",
    params: baseParams,
    createdAt: "2026-09-20T00:00:00.000Z",
    deadlineAt: "2026-09-20T01:00:00.000Z",
    ...overrides,
  };
}

const noneActive = { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 };

function response(overrides: Partial<HistoryResponse> = {}): HistoryResponse {
  return { items: [], nextCursor: null, active: { ...noneActive }, ...overrides };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  // A block body matters here: `mockReset()` returns the mock itself, and a
  // concise-body arrow would return that too — Vitest treats a `beforeEach`
  // return value that's a function as an implicit post-test cleanup, which
  // would call `fetchMock()` for real once more after every test.
  fetchMock.mockReset();
});
afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("useJobPolling", () => {
  it("fetches the history endpoint once on mount", async () => {
    fetchMock.mockResolvedValueOnce(response());
    renderHook(() => useJobPolling());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("respects the schedule while work is live, then stops once nothing is active", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(response({ active: { ...noneActive, processing: 1 } }))
        .mockResolvedValueOnce(response({ active: noneActive }));

      renderHook(() => useJobPolling());
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(3_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Nothing is active any more: the schedule returned null, so the interval
      // must have been torn down rather than kept running at the last cadence.
      act(() => vi.advanceTimersByTime(60_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dedupes an optimistic job against the fetched one by id", async () => {
    const optimistic = job({ status: "processing", phase: "queued" });
    const confirmed = job({ status: "complete", phase: "rendering" });
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ items: [confirmed] }));

    const { result } = renderHook(() => useJobPolling());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => result.current.insertOptimistic(optimistic));
    expect(result.current.jobs).toEqual([optimistic]);

    act(() => result.current.refresh());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.jobs).toEqual([confirmed]));
  });

  it("inserts an optimistic job at the head, ahead of already-fetched rows", async () => {
    const existing = job({ id: "job-existing", status: "processing", phase: "rendering" });
    fetchMock.mockResolvedValueOnce(response({ items: [existing] }));

    const { result } = renderHook(() => useJobPolling());
    await waitFor(() => expect(result.current.jobs).toEqual([existing]));

    const optimistic = job({ id: "job-new", status: "processing", phase: "queued" });
    act(() => result.current.insertOptimistic(optimistic));

    expect(result.current.jobs).toEqual([optimistic, existing]);
  });

  it("recovers after a failed first fetch once a later attempt succeeds", async () => {
    vi.useFakeTimers();
    try {
      const recovered = job({ id: "job-1" });
      fetchMock
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce(response({ items: [recovered] }));

      const { result } = renderHook(() => useJobPolling());
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBe(true);
      expect(result.current.stalled).toBe(false);
      expect(result.current.jobs).toEqual([]);

      // The failed attempt schedules a retry rather than leaving the schedule
      // null (which would stop polling forever).
      act(() => vi.advanceTimersByTime(10_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current.error).toBe(false);
      expect(result.current.stalled).toBe(false);
      expect(result.current.jobs).toEqual([recovered]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying and reports stalled once failures reach the bound", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockRejectedValue(new Error("still down"));
      const { result } = renderHook(() => useJobPolling());

      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.stalled).toBe(false);

      for (let attempt = 2; attempt <= 5; attempt++) {
        act(() => vi.advanceTimersByTime(10_000));
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(attempt);
      }
      expect(result.current.stalled).toBe(true);
      expect(result.current.error).toBe(true);

      // The schedule was set to null once the bound was hit: no more retries.
      act(() => vi.advanceTimersByTime(60_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses while the tab is hidden and refreshes immediately once it is visible again", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ active: { ...noneActive, processing: 1 } }))
      .mockResolvedValueOnce(response({ active: { ...noneActive, processing: 1 } }));

    renderHook(() => useJobPolling());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("pauses while offline and refreshes immediately once back online", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ active: { ...noneActive, processing: 1 } }))
      .mockResolvedValueOnce(response({ active: { ...noneActive, processing: 1 } }));

    renderHook(() => useJobPolling());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not advance the consecutive-failure counter while offline", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockRejectedValue(new Error("still down"));
      const { result } = renderHook(() => useJobPolling());

      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.stalled).toBe(false);

      act(() => vi.advanceTimersByTime(10_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      act(() => window.dispatchEvent(new Event("offline")));

      // Comfortably past enough 10s retry cadences to have reached the
      // 5-failure stalled bound had ticking continued offline -- it must
      // not have, so the count stays exactly where offline found it.
      act(() => vi.advanceTimersByTime(60_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current.stalled).toBe(false);

      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
      act(() => window.dispatchEvent(new Event("online")));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
