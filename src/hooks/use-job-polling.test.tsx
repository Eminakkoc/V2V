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

beforeEach(() => fetchMock.mockReset());
afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
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
      // The first fetch is deferred through a zero-delay timer.
      act(() => vi.advanceTimersByTime(0));
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
});
