// @vitest-environment jsdom
import {
  act,
  renderHook as baseRenderHook,
  waitFor,
  type RenderHookOptions,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import type { AttemptView, HistoryJobsResponse, HistoryJobView } from "@/lib/history-contract";
import { transformParamsSchema } from "@/lib/transform-contract";
import { JobPollingProvider } from "@/components/job/job-polling-provider";
import { useHistoryRefresh, type UseHistoryRefreshOptions } from "./use-history-refresh";

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

// The hook reads the shared poll rather than fetching, so every case runs inside the provider that
// owns it.
function wrapper({ children }: { children: React.ReactNode }) {
  return <JobPollingProvider>{children}</JobPollingProvider>;
}

function renderHook<Result, Props>(
  callback: (props: Props) => Result,
  options?: Omit<RenderHookOptions<Props>, "wrapper">,
) {
  return baseRenderHook(callback, { ...options, wrapper });
}

let autoId = 0;

function job(overrides: Partial<HistoryJobView> = {}): HistoryJobView {
  autoId += 1;
  return {
    id: `job-${autoId}`,
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

function attempt(overrides: Partial<HistoryJobView> = {}): AttemptView {
  const built = job(overrides);
  return {
    id: built.id,
    sourceId: built.sourceId,
    status: built.status,
    phase: built.phase,
    params: built.params,
    createdAt: built.createdAt,
    deadlineAt: built.deadlineAt,
    ...(built.completedAt !== undefined ? { completedAt: built.completedAt } : {}),
    ...(built.output !== undefined ? { output: built.output } : {}),
    ...(built.creditsCharged !== undefined ? { creditsCharged: built.creditsCharged } : {}),
    ...(built.errorCode !== undefined ? { errorCode: built.errorCode } : {}),
    ...(built.errorMessage !== undefined ? { errorMessage: built.errorMessage } : {}),
    ...(built.retryOfJobId !== undefined ? { retryOfJobId: built.retryOfJobId } : {}),
    ...(built.supersededByJobId !== undefined
      ? { supersededByJobId: built.supersededByJobId }
      : {}),
  };
}

const noneActive = { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 };

function changeableResponse(items: HistoryJobView[] = []): HistoryJobsResponse {
  return { items, nextCursor: null, active: { ...noneActive } };
}

function defaultOptions(
  overrides: Partial<UseHistoryRefreshOptions> = {},
): UseHistoryRefreshOptions {
  return {
    initial: [],
    sort: "createdAt",
    dir: "desc",
    filter: {},
    includePrevious: false,
    hasMore: false,
    ...overrides,
  };
}

// A tick can chain a changeable poll into an `ids` follow-up, so settling it can need more than one
// hop.
async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  autoId = 0;
  // A block body matters: Vitest treats a function returned from `beforeEach` as cleanup, and
  // `mockReset()` returns the mock.
  fetchMock.mockReset();
});
afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("useHistoryRefresh", () => {
  it("polls ?changeable=true on mount and merges the result", async () => {
    const row = job({ id: "job-a" });
    fetchMock.mockResolvedValueOnce(changeableResponse([row]));

    const { result } = renderHook(() => useHistoryRefresh(defaultOptions()));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history?changeable=true",
      expect.objectContaining({ method: "GET" }),
    );
    await waitFor(() => expect(result.current.jobs).toEqual([row]));
  });

  it("looks up a job that already finished before the hook's first poll, seeded from `initial`", async () => {
    const stale = job({ id: "job-a", status: "processing" });
    const finalA = job({ id: "job-a", status: "complete" });

    // job-a has already left the changeable set before the first client poll -- what
    // reconciliation's after() pass produces, and what the `initial` baseline seed exists to catch.
    fetchMock
      .mockResolvedValueOnce(changeableResponse([]))
      .mockResolvedValueOnce(changeableResponse([finalA]));

    const { result } = renderHook(() => useHistoryRefresh(defaultOptions({ initial: [stale] })));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/history?changeable=true",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/history?ids=job-a",
      expect.objectContaining({ method: "GET" }),
    );
    await waitFor(() => expect(result.current.jobs).toEqual([finalA]));
  });

  it("does not look up an already-terminal `initial` row just because the first poll omits it", async () => {
    const doneAlready = job({ id: "job-b", status: "complete" });
    fetchMock.mockResolvedValueOnce(changeableResponse([]));

    const { result } = renderHook(() =>
      useHistoryRefresh(defaultOptions({ initial: [doneAlready] })),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // A wrongly-triggered follow-up would fire in this same tick, so the extra round trips give it
    // every chance to show up.
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toEqual([doneAlready]);
  });

  it("issues exactly one ids follow-up when a job leaves the changeable set, and merges its final state", async () => {
    vi.useFakeTimers();
    try {
      const live = job({ id: "job-a", status: "processing" });
      const final = job({ id: "job-a", status: "complete", phase: "rendering" });
      fetchMock
        .mockResolvedValueOnce(changeableResponse([live]))
        .mockResolvedValueOnce(changeableResponse([]))
        .mockResolvedValueOnce(changeableResponse([final]));

      const { result } = renderHook(() => useHistoryRefresh(defaultOptions()));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.jobs).toEqual([live]);

      act(() => vi.advanceTimersByTime(3_000));
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/history?changeable=true",
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/history?ids=job-a",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.current.jobs).toEqual([final]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses several jobs leaving the changeable set together into a single ids call", async () => {
    vi.useFakeTimers();
    try {
      const a = job({ id: "job-a", status: "processing" });
      const b = job({ id: "job-b", status: "processing" });
      const c = job({ id: "job-c", status: "finalizing" });
      const finalA = job({ id: "job-a", status: "complete" });
      const finalB = job({ id: "job-b", status: "failed" });
      const finalC = job({ id: "job-c", status: "complete" });

      fetchMock
        .mockResolvedValueOnce(changeableResponse([a, b, c]))
        .mockResolvedValueOnce(changeableResponse([]))
        .mockResolvedValueOnce(changeableResponse([finalA, finalB, finalC]));

      const { result } = renderHook(() => useHistoryRefresh(defaultOptions()));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(3_000));
      await flush();

      // One changeable poll plus exactly one ids call, never one ids call per job that left.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/history?ids=job-a,job-b,job-c",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.current.jobs.map((j) => j.id).sort()).toEqual(["job-a", "job-b", "job-c"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once the changeable set comes back empty", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(changeableResponse([]));

      renderHook(() => useHistoryRefresh(defaultOptions()));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Past every finite cadence nextRefreshDelayMs can return, so a hook that merely scheduled a
      // slow retry would still show a second call.
      act(() => vi.advanceTimersByTime(400_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses polling while the tab is hidden, and re-syncs immediately once visible again", async () => {
    vi.useFakeTimers();
    try {
      const first = job({ id: "job-a", status: "processing" });
      const second = job({ id: "job-a", status: "processing" });
      fetchMock
        .mockResolvedValueOnce(changeableResponse([first]))
        .mockResolvedValueOnce(changeableResponse([second]));

      renderHook(() => useHistoryRefresh(defaultOptions()));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      act(() => document.dispatchEvent(new Event("visibilitychange")));

      // Past the 3s cadence the first response scheduled: a tab that had only "not ticked yet"
      // would have called again by now.
      act(() => vi.advanceTimersByTime(10_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses polling while offline, and re-syncs immediately once back online", async () => {
    vi.useFakeTimers();
    try {
      const first = job({ id: "job-a", status: "processing" });
      const second = job({ id: "job-a", status: "processing" });
      fetchMock
        .mockResolvedValueOnce(changeableResponse([first]))
        .mockResolvedValueOnce(changeableResponse([second]));

      renderHook(() => useHistoryRefresh(defaultOptions()));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      act(() => window.dispatchEvent(new Event("offline")));

      // Past the 3s cadence the first response scheduled: a poll that had only "not ticked yet"
      // would have called again by now.
      act(() => vi.advanceTimersByTime(10_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
      act(() => window.dispatchEvent(new Event("online")));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not advance the consecutive-failure counter while offline", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockRejectedValue(new Error("still down"));
      const { result } = renderHook(() => useHistoryRefresh(defaultOptions()));

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

  it("retries a failed poll at the fixed cadence and recovers once a later attempt succeeds", async () => {
    vi.useFakeTimers();
    try {
      const recovered = job({ id: "job-a", status: "processing" });
      fetchMock
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce(changeableResponse([recovered]));

      const { result } = renderHook(() => useHistoryRefresh(defaultOptions()));
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

  it("stops retrying and reports stalled once consecutive failures reach the bound", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockRejectedValue(new Error("still down"));
      const { result } = renderHook(() => useHistoryRefresh(defaultOptions()));

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

  it("does not surface a refreshed superseded row as a top-level card when includePrevious is false", async () => {
    const nestedBeforeRefresh = attempt({ id: "job-old", status: "processing" });
    // Terminal, so it is never seeded into the changeable baseline: this test is about the
    // superseded fold, not the owner leaving.
    const owner = job({
      id: "job-latest",
      status: "complete",
      attempts: [nestedBeforeRefresh],
    });
    const supersededRefresh = job({
      id: "job-old",
      status: "superseded",
      supersededByJobId: "job-latest",
      errorMessage: "final reason",
    });

    fetchMock.mockResolvedValueOnce(changeableResponse([supersededRefresh]));

    const { result } = renderHook(() => useHistoryRefresh(defaultOptions({ initial: [owner] })));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const nested = result.current.jobs
        .find((j) => j.id === "job-latest")
        ?.attempts.find((a) => a.id === "job-old");
      expect(nested?.status).toBe("superseded");
    });

    expect(result.current.jobs.map((j) => j.id)).toEqual(["job-latest"]);
  });

  it("folds a superseded attempt without spuriously looking up its still-changeable owner in the same tick", async () => {
    const nestedBeforeRefresh = attempt({ id: "job-old", status: "processing" });
    // Changeable, unlike the fold test above, so it IS seeded into the baseline and also comes back
    // in this tick's own response.
    const owner = job({
      id: "job-latest",
      status: "processing",
      phase: "queued",
      attempts: [nestedBeforeRefresh],
    });
    const ownerRefreshed = job({
      id: "job-latest",
      status: "processing",
      phase: "rendering",
      // Unrefreshed on purpose, so a passing "superseded" nested status below can only have come
      // from this hook's own fold step.
      attempts: [nestedBeforeRefresh],
    });
    const supersededRefresh = job({
      id: "job-old",
      status: "superseded",
      supersededByJobId: "job-latest",
      errorMessage: "final reason",
    });

    fetchMock.mockResolvedValueOnce(changeableResponse([ownerRefreshed, supersededRefresh]));

    const { result } = renderHook(() => useHistoryRefresh(defaultOptions({ initial: [owner] })));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const nested = result.current.jobs
        .find((j) => j.id === "job-latest")
        ?.attempts.find((a) => a.id === "job-old");
      expect(nested?.status).toBe("superseded");
    });

    const nested = result.current.jobs
      .find((j) => j.id === "job-latest")
      ?.attempts.find((a) => a.id === "job-old");
    expect(nested?.errorMessage).toBe("final reason");

    expect(result.current.jobs.map((j) => j.id)).toEqual(["job-latest"]);
    expect(result.current.jobs[0]?.phase).toBe("rendering");

    // Asserted on the call log rather than inferred from the merged output, so a spurious lookup
    // that still merged correctly is caught.
    const idsCalls = fetchMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("ids="),
    );
    expect(idsCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still folds the nested copy and keeps the row off the top level once a superseded attempt reconciles to complete", async () => {
    const nestedBeforeRefresh = attempt({ id: "job-old", status: "superseded" });
    const owner = job({
      id: "job-latest",
      status: "complete",
      attempts: [nestedBeforeRefresh],
    });
    // Reconciliation moved job-old on to "complete", but supersededByJobId is never cleared, so the
    // fold must key on the link.
    const reconciledRefresh = job({
      id: "job-old",
      status: "complete",
      supersededByJobId: "job-latest",
    });

    fetchMock.mockResolvedValueOnce(changeableResponse([reconciledRefresh]));

    const { result } = renderHook(() => useHistoryRefresh(defaultOptions({ initial: [owner] })));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const nested = result.current.jobs
        .find((j) => j.id === "job-latest")
        ?.attempts.find((a) => a.id === "job-old");
      expect(nested?.status).toBe("complete");
    });

    expect(result.current.jobs.map((j) => j.id)).toEqual(["job-latest"]);
  });

  describe("rows loaded via `additional` (load more)", () => {
    it("registers a load-more row with the shared poll, so it is updated in place instead of being excluded under the insertion-window rule", async () => {
      const stillLive = job({
        id: "keep-alive",
        status: "processing",
        createdAt: "2026-09-20T00:00:00.000Z",
      });
      // Older on purpose: a `load more` row is always older than what is on screen, so it sorts
      // after the boundary the insertion-window rule checks.
      const loadedViaLoadMore = job({
        id: "job-old",
        status: "timed_out",
        createdAt: "2026-09-19T00:00:00.000Z",
      });
      const refreshedViaPoll = job({
        id: "job-old",
        status: "complete",
        createdAt: "2026-09-19T00:00:00.000Z",
      });

      fetchMock.mockResolvedValueOnce(changeableResponse([stillLive]));

      const { result, rerender } = renderHook(
        (options: UseHistoryRefreshOptions) => useHistoryRefresh(options),
        { initialProps: defaultOptions({ initial: [stillLive], hasMore: true }) },
      );
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock
        .mockResolvedValueOnce(changeableResponse([stillLive]))
        .mockResolvedValueOnce(changeableResponse([refreshedViaPoll]));

      // Simulates `load more`: job-old is appended while more pages remain, exactly what
      // TransformationsPanel hands the hook as `additional`.
      rerender(
        defaultOptions({ initial: [stillLive], hasMore: true, additional: [loadedViaLoadMore] }),
      );
      expect(result.current.jobs.map((j) => j.id).sort()).toEqual(["job-old", "keep-alive"]);
      await flush();

      // The row is on screen as changeable and the poll's own list never mentioned it, so the
      // lookup goes out at once rather than waiting for a tick that may never come.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/history?ids=job-old",
        expect.objectContaining({ method: "GET" }),
      );
      const jobOld = result.current.jobs.find((j) => j.id === "job-old");
      expect(jobOld?.status).toBe("complete");
    });

    it("folds a second load-more page in on top of the first, without duplicating the first page's row", async () => {
      const pageTwoRow = job({ id: "page-2", status: "timed_out" });
      const pageThreeRow = job({ id: "page-3", status: "timed_out" });
      fetchMock.mockResolvedValueOnce(changeableResponse([]));

      const { result, rerender } = renderHook(
        (options: UseHistoryRefreshOptions) => useHistoryRefresh(options),
        { initialProps: defaultOptions({ hasMore: true }) },
      );
      await flush();

      rerender(defaultOptions({ hasMore: true, additional: [pageTwoRow] }));
      // Second load-more click: a brand new array containing both rows, the way the panel grows it.
      rerender(defaultOptions({ hasMore: true, additional: [pageTwoRow, pageThreeRow] }));

      expect(result.current.jobs.map((j) => j.id).sort()).toEqual(["page-2", "page-3"]);
    });
  });
});
