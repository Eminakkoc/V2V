// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import type { HistoryJobsResponse, HistoryJobView } from "@/lib/history-contract";
import { transformParamsSchema } from "@/lib/transform-contract";
import { JobPollingProvider, useJobPolling } from "./job-polling-provider";

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

function job(overrides: Partial<HistoryJobView> = {}): HistoryJobView {
  return {
    id: "job-1",
    sourceId: "source-1",
    status: "processing",
    phase: "queued",
    params: baseParams,
    createdAt: "2026-09-20T00:00:00.000Z",
    deadlineAt: "2026-09-20T01:00:00.000Z",
    source: null,
    attempts: [],
    ...overrides,
  };
}

const noneActive = { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 };

function response(overrides: Partial<HistoryJobsResponse> = {}): HistoryJobsResponse {
  return { items: [], nextCursor: null, active: { ...noneActive }, ...overrides };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <JobPollingProvider>{children}</JobPollingProvider>;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  // A block body matters: Vitest treats a function returned from `beforeEach` as cleanup, and
  // `mockReset()` returns the mock.
  fetchMock.mockReset();
});
afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("useJobPolling", () => {
  it("fetches the changeable rows once on mount", async () => {
    fetchMock.mockResolvedValueOnce(response());
    renderHook(() => useJobPolling(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history?changeable=true",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("respects the schedule while work is live, then stops once nothing is active", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(response({ items: [job({ status: "processing" })] }))
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(response({ items: [job({ status: "complete" })] }));

      renderHook(() => useJobPolling(), { wrapper });
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Two: the scheduled poll, then the lookup for the job that left the changeable set with it.
      act(() => vi.advanceTimersByTime(3_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/history?ids=job-1",
        expect.objectContaining({ method: "GET" }),
      );

      // The schedule returned null, so the interval must have been torn down rather than kept
      // running at the last cadence.
      act(() => vi.advanceTimersByTime(60_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(3);
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

    const { result } = renderHook(() => useJobPolling(), { wrapper });
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

    const { result } = renderHook(() => useJobPolling(), { wrapper });
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

      const { result } = renderHook(() => useJobPolling(), { wrapper });
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBe(true);
      expect(result.current.stalled).toBe(false);
      expect(result.current.jobs).toEqual([]);

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
      const { result } = renderHook(() => useJobPolling(), { wrapper });

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

    renderHook(() => useJobPolling(), { wrapper });
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

    renderHook(() => useJobPolling(), { wrapper });
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
      const { result } = renderHook(() => useJobPolling(), { wrapper });

      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.stalled).toBe(false);

      act(() => vi.advanceTimersByTime(10_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      act(() => window.dispatchEvent(new Event("offline")));

      // Past enough retry cadences to have reached the stalled bound had ticking continued offline.
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
