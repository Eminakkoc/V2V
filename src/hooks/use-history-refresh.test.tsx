// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import type { AttemptView, HistoryJobsResponse, HistoryJobView } from "@/lib/history-contract";
import { transformParamsSchema } from "@/lib/transform-contract";
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

// Trims a job() fixture down to AttemptView's shape -- attempts carry no
// `source` or nested `attempts` of their own.
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

// Several microtask round trips: unlike use-job-polling's single apiFetch
// per tick, a tick here can chain a changeable poll into an `ids`
// follow-up, so settling it can need more than one hop. Extra hops on an
// already-settled promise are free.
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
  // A block body matters here: `mockReset()` returns the mock itself, and a
  // concise-body arrow would return that too -- Vitest treats a `beforeEach`
  // return value that's a function as an implicit post-test cleanup, which
  // would call `fetchMock()` for real once more after every test.
  fetchMock.mockReset();
});
afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
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

    // The account no longer considers job-a changeable by the time the
    // first client poll runs -- exactly what reconciliation's after() pass
    // (scheduled on the same request that rendered `initial`) can produce
    // before this hook ever gets to run. Without seeding the baseline from
    // `initial`, job-a's absence here would look like "was never
    // changeable" rather than "just left", and no ids call would follow.
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
    // A wrongly-triggered follow-up would fire synchronously in the same
    // tick as the first call, not on a later timer -- these extra
    // microtask round trips give it every chance to show up before the
    // absence is asserted.
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

      // job-a was processing, so nextRefreshDelayMs scheduled the 3s rung.
      act(() => vi.advanceTimersByTime(3_000));
      await flush();

      // Exactly 3 calls total: the two changeable polls plus one ids
      // follow-up -- not, say, a changeable poll repeated or an ids call
      // skipped/duplicated.
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

      // The count is the whole point of this test: one changeable poll plus
      // exactly one ids call, never one ids call per job that left.
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

      // Comfortably past every finite cadence nextRefreshDelayMs can ever
      // return (its longest, abandoned-only rung, is 300_000ms). A hook
      // that had merely scheduled a slow retry instead of truly stopping
      // would show a second call here; one that stopped will not.
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

      // Well past the 3s cadence the first (processing) response scheduled.
      // If hiding the tab had not torn the interval down, this alone would
      // have produced a second call, before the tab is ever made visible
      // again -- that is what distinguishes "paused" from "just hasn't
      // ticked yet".
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

      // The failed attempt schedules a fixed-cadence retry rather than
      // leaving the schedule null (which would stop polling forever).
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

      // The schedule was set to null once the bound was hit: advancing well
      // past another retry interval must not produce a 6th call.
      act(() => vi.advanceTimersByTime(60_000));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not surface a refreshed superseded row as a top-level card when includePrevious is false", async () => {
    const nestedBeforeRefresh = attempt({ id: "job-old", status: "processing" });
    // Terminal (not in CHANGEABLE_STATUSES) so it isn't seeded into the
    // changeable baseline -- this test is about the superseded fold, not
    // about the owner itself leaving the changeable set, which would need
    // its own mocked ids follow-up and is exercised elsewhere.
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

    // The nested copy inside its owner is current (asserted above), but the
    // row must never also stand on its own as a top-level card.
    expect(result.current.jobs.map((j) => j.id)).toEqual(["job-latest"]);
  });

  it("folds a superseded attempt without spuriously looking up its still-changeable owner in the same tick", async () => {
    const nestedBeforeRefresh = attempt({ id: "job-old", status: "processing" });
    // Changeable (processing), unlike the dedicated fold test above -- so it
    // IS seeded into the baseline, and also comes back in this tick's own
    // changeable response (still processing). A reader retried a
    // transform: the retry (owner) is still running while the superseded
    // original (job-old) is also still being re-checked. Both are
    // changeable and both arrive in the same poll.
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
      // The server's own snapshot of owner still carries its attempts
      // chain -- unrefreshed here on purpose, so a passing "superseded"
      // nested status below can only have come from this hook's own fold
      // step (using the co-arriving supersededRefresh row), not from a
      // value that merely passed through unchanged.
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

    // owner stays the only top-level card, refreshed with its new phase --
    // job-old never surfaces top-level (includePrevious is false).
    expect(result.current.jobs.map((j) => j.id)).toEqual(["job-latest"]);
    expect(result.current.jobs[0]?.phase).toBe("rendering");

    // The load-bearing assertion: owner never left the changeable set this
    // tick (it's still processing, in the same response), so no ids
    // follow-up should ever fire. Asserted directly on the call log, not
    // inferred from the merged output above -- a mutant that fired a
    // spurious lookup for owner here (and happened to get a response that
    // still merged correctly) would still be caught.
    const idsCalls = fetchMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("ids="),
    );
    expect(idsCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
