import { describe, expect, it } from "vitest";
import type { AttemptView, HistoryJobView } from "./history-contract";
import { mergeRefreshed, sortKeyOf } from "./history-merge";
import type { MergeRefreshedOptions } from "./history-merge";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

let autoId = 0;

type JobOverrides = Partial<Omit<HistoryJobView, "params">> & {
  params?: Partial<HistoryJobView["params"]>;
};

// Deep-frozen, so a write to a row mergeRefreshed was handed throws instead of silently succeeding.
function job(overrides: JobOverrides = {}): HistoryJobView {
  autoId += 1;
  const base: HistoryJobView = {
    id: `job-${autoId}`,
    sourceId: "source-1",
    status: "complete",
    phase: "rendering",
    params: {
      name: "Clip",
      startSeconds: 0,
      endSeconds: 5,
      fpsResolution: "HALF",
      artStyle: "Anime Warrior",
      promptType: "default",
      model: "default",
      version: "default",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    deadlineAt: "2026-01-01T00:10:00.000Z",
    source: null,
    attempts: [],
  };
  return deepFreeze({
    ...base,
    ...overrides,
    params: { ...base.params, ...overrides.params },
  } as HistoryJobView);
}

type AttemptOverrides = Partial<Omit<AttemptView, "params">> & {
  params?: Partial<AttemptView["params"]>;
};

function attempt(overrides: AttemptOverrides = {}): AttemptView {
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

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-01T02:00:00.000Z";
const T3 = "2026-01-01T03:00:00.000Z";

function options(overrides: Partial<MergeRefreshedOptions> = {}): MergeRefreshedOptions {
  return {
    sort: "createdAt",
    dir: "desc",
    filter: {},
    includePrevious: false,
    hasMore: false,
    ...overrides,
  };
}

describe("sortKeyOf", () => {
  it("keys the createdAt sort on the creation timestamp twice, then the id", () => {
    const row = job({ id: "x", createdAt: T2 });
    expect(sortKeyOf(row, "createdAt")).toEqual([Date.parse(T2), Date.parse(T2), "x"]);
  });

  it("keys the duration sort on the clip length, rounded past float drift", () => {
    // 4.3 - 1.1 is 3.1999999999999997 in binary floating point.
    const row = job({ id: "x", createdAt: T1, params: { startSeconds: 1.1, endSeconds: 4.3 } });
    expect(sortKeyOf(row, "duration")).toEqual([3.2, Date.parse(T1), "x"]);
  });
});

describe("mergeRefreshed: replace loaded rows by id", () => {
  it("replaces an already-loaded row's content without appending a duplicate", () => {
    const a = job({ id: "a", createdAt: T3, status: "processing" });
    const b = job({ id: "b", createdAt: T1, status: "processing" });
    const aRefreshed = job({ id: "a", createdAt: T3, status: "complete" });

    const merged = mergeRefreshed([a, b], [aRefreshed], options());

    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
    expect(merged.find((r) => r.id === "a")?.status).toBe("complete");
  });
});

describe("mergeRefreshed: superseded rows fold into their latest job's attempts", () => {
  it("updates the matching attempt inside the latest job instead of surfacing as a top-level card", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      status: "processing",
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "processing" })],
    });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T1,
      status: "superseded",
      supersededByJobId: "latest",
      errorMessage: "final reason",
    });

    // filter: {} matches every status, so without the superseded special case old-1 would be
    // inserted top-level.
    const merged = mergeRefreshed([latest], [refreshedOld], options({ filter: {} }));

    expect(merged.map((r) => r.id)).toEqual(["latest"]);
    const attempts = merged[0]!.attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("superseded");
    expect(attempts[0]?.errorMessage).toBe("final reason");
  });

  it("removes a row from the top level once it refreshes as superseded, even though it was loaded there before", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "processing" })],
    });
    const oldTopLevel = job({ id: "old-1", createdAt: T1, status: "processing" });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T1,
      status: "superseded",
      supersededByJobId: "latest",
    });

    const merged = mergeRefreshed([oldTopLevel, latest], [refreshedOld], options({ filter: {} }));

    expect(merged.map((r) => r.id)).toEqual(["latest"]);
  });

  it("drops a superseded row rather than showing it top-level when its latest job is not loaded", () => {
    const refreshedOld = job({
      id: "old-1",
      status: "superseded",
      supersededByJobId: "not-loaded",
    });

    const merged = mergeRefreshed([], [refreshedOld], options({ filter: {} }));

    expect(merged).toEqual([]);
  });
});

describe("mergeRefreshed: superseded rows under includePrevious, per HIS-005's toggle", () => {
  it("inserts a not-yet-loaded, unowned-locally superseded row as its own top-level card at its sort position", () => {
    const newest = job({ id: "newest", createdAt: T3, status: "processing" });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T2,
      status: "superseded",
      supersededByJobId: "not-loaded",
    });

    const merged = mergeRefreshed(
      [newest],
      [refreshedOld],
      options({ filter: {}, includePrevious: true, hasMore: false }),
    );

    expect(merged.map((r) => r.id)).toEqual(["newest", "old-1"]);
    expect(merged.find((r) => r.id === "old-1")?.status).toBe("superseded");
    expect(merged.find((r) => r.id === "newest")?.attempts).toEqual([]);
  });

  it("updates an already-loaded superseded row's own card in place rather than nesting it", () => {
    const oldTopLevel = job({ id: "old-1", createdAt: T1, status: "processing" });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T1,
      status: "superseded",
      supersededByJobId: "not-loaded",
      errorMessage: "final reason",
    });

    const merged = mergeRefreshed(
      [oldTopLevel],
      [refreshedOld],
      options({ filter: {}, includePrevious: true }),
    );

    expect(merged.map((r) => r.id)).toEqual(["old-1"]);
    expect(merged[0]?.status).toBe("superseded");
    expect(merged[0]?.errorMessage).toBe("final reason");
  });

  it("keeps a superseded row's own top-level card AND its owner's nested copy both current, when both are loaded", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "processing" })],
    });
    const oldTopLevel = job({ id: "old-1", createdAt: T1, status: "processing" });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T1,
      status: "superseded",
      supersededByJobId: "latest",
      errorMessage: "final reason",
    });

    const merged = mergeRefreshed(
      [oldTopLevel, latest],
      [refreshedOld],
      options({ filter: {}, includePrevious: true }),
    );

    const topLevelOld = merged.find((r) => r.id === "old-1");
    const owner = merged.find((r) => r.id === "latest");

    expect(topLevelOld?.status).toBe("superseded");
    expect(topLevelOld?.errorMessage).toBe("final reason");

    // The owner's nested entry must carry the same fresh content as the top-level card -- a reader
    // should never see the two disagree.
    const nestedOld = owner?.attempts.find((a) => a.id === "old-1");
    expect(nestedOld?.status).toBe("superseded");
    expect(nestedOld?.errorMessage).toBe("final reason");
  });

  it("keeps the two views of the same superseded row in agreement with each other", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "processing" })],
    });
    const oldTopLevel = job({ id: "old-1", createdAt: T1, status: "processing" });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T1,
      status: "superseded",
      supersededByJobId: "latest",
      errorMessage: "final reason",
    });

    const merged = mergeRefreshed(
      [oldTopLevel, latest],
      [refreshedOld],
      options({ filter: {}, includePrevious: true }),
    );

    const topLevelOld = merged.find((r) => r.id === "old-1")!;
    const nestedOld = merged
      .find((r) => r.id === "latest")!
      .attempts.find((a) => a.id === "old-1")!;

    expect({ status: nestedOld.status, errorMessage: nestedOld.errorMessage }).toEqual({
      status: topLevelOld.status,
      errorMessage: topLevelOld.errorMessage,
    });
  });

  it("folds a superseded row into its owner's attempts even when it is windowed out of the top level", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "processing" })],
    });
    const other = job({ id: "other", createdAt: T2 });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T1,
      status: "superseded",
      supersededByJobId: "latest",
      errorMessage: "final reason",
    });

    const merged = mergeRefreshed(
      [latest, other],
      [refreshedOld],
      options({ filter: {}, includePrevious: true, hasMore: true }),
    );

    expect(merged.some((r) => r.id === "old-1")).toBe(false);

    const nestedOld = merged.find((r) => r.id === "latest")!.attempts.find((a) => a.id === "old-1");
    expect(nestedOld?.status).toBe("superseded");
    expect(nestedOld?.errorMessage).toBe("final reason");
  });
});

describe("mergeRefreshed: a superseded attempt reconciled off that status", () => {
  it("still folds the nested copy and stays off the top level once superseded reconciles to complete (includePrevious: false)", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      status: "failed",
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "superseded" })],
    });
    // Reconciliation moved old-1 on to "complete", but supersededByJobId is never cleared, so it
    // still names its owner.
    const reconciledOld = job({
      id: "old-1",
      createdAt: T1,
      status: "complete",
      supersededByJobId: "latest",
    });

    const merged = mergeRefreshed([latest], [reconciledOld], options({ filter: {} }));

    expect(merged.map((r) => r.id)).toEqual(["latest"]);
    const nested = merged[0]!.attempts.find((a) => a.id === "old-1");
    expect(nested?.status).toBe("complete");
  });

  it("folds the nested copy AND promotes the row top-level once superseded reconciles to complete (includePrevious: true)", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      status: "failed",
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "superseded" })],
    });
    const reconciledOld = job({
      id: "old-1",
      createdAt: T1,
      status: "complete",
      supersededByJobId: "latest",
    });

    const merged = mergeRefreshed(
      [latest],
      [reconciledOld],
      options({ filter: {}, includePrevious: true }),
    );

    expect(merged.map((r) => r.id).sort()).toEqual(["latest", "old-1"]);
    expect(merged.find((r) => r.id === "old-1")?.status).toBe("complete");
    const nested = merged.find((r) => r.id === "latest")!.attempts.find((a) => a.id === "old-1");
    expect(nested?.status).toBe("complete");
  });
});

describe("mergeRefreshed: inserting not-yet-loaded rows", () => {
  it("inserts a fresh row at its sort position when it falls inside the loaded window", () => {
    const newest = job({ id: "newest", createdAt: T3 });
    const oldest = job({ id: "oldest", createdAt: T1 });
    const middle = job({ id: "middle", createdAt: T2 });

    const merged = mergeRefreshed([newest, oldest], [middle], options({ hasMore: true }));

    expect(merged.map((r) => r.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("does not insert a row that sorts after the last loaded row while more pages remain", () => {
    const a = job({ id: "a", createdAt: T3 });
    const b = job({ id: "b", createdAt: T2 });
    const c = job({ id: "c", createdAt: T1 });

    const merged = mergeRefreshed([a, b], [c], options({ hasMore: true }));

    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("recovers that same row once load-more actually supplies it, rather than discarding it", () => {
    const a = job({ id: "a", createdAt: T3 });
    const b = job({ id: "b", createdAt: T2 });
    const c = job({ id: "c", createdAt: T1, status: "processing" });

    // mergeRefreshed is stateless, so only a second call -- with the row now in `loaded` -- can
    // tell "excluded this time" from "discarded forever".
    const afterFirstRefresh = mergeRefreshed([a, b], [c], options({ hasMore: true }));
    expect(afterFirstRefresh.map((r) => r.id)).toEqual(["a", "b"]);

    const cRefreshedAgain = job({ id: "c", createdAt: T1, status: "complete" });
    const afterLoadMore = mergeRefreshed(
      [...afterFirstRefresh, c],
      [cRefreshedAgain],
      options({ hasMore: false }),
    );

    expect(afterLoadMore.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(afterLoadMore.find((r) => r.id === "c")?.status).toBe("complete");
  });

  it("inserts that same trailing row once hasMore is false, since nothing remains missing", () => {
    const a = job({ id: "a", createdAt: T3 });
    const b = job({ id: "b", createdAt: T2 });
    const c = job({ id: "c", createdAt: T1 });

    const merged = mergeRefreshed([a, b], [c], options({ hasMore: false }));

    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not insert a fresh row that fails the active status filter", () => {
    const a = job({ id: "a", createdAt: T3, status: "processing" });
    const b = job({ id: "b", createdAt: T1, status: "complete" });

    const merged = mergeRefreshed([a], [b], options({ filter: { statusBucket: "in-progress" } }));

    expect(merged.map((r) => r.id)).toEqual(["a"]);
  });

  it("does not insert a fresh row whose art style fails the active style filter", () => {
    const a = job({ id: "a", createdAt: T3 });
    const b = job({ id: "b", createdAt: T1, params: { artStyle: "Naruto" } });

    const merged = mergeRefreshed([a], [b], options({ style: "Anime Warrior" }));

    expect(merged.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("mergeRefreshed: loaded rows are never evicted by the filter", () => {
  it("keeps a loaded row in place once its refreshed status stops matching the active filter", () => {
    const a = job({ id: "a", status: "processing" });
    const aRefreshed = job({ id: "a", status: "complete" });

    const merged = mergeRefreshed(
      [a],
      [aRefreshed],
      options({ filter: { statusBucket: "in-progress" } }),
    );

    expect(merged.map((r) => r.id)).toEqual(["a"]);
    expect(merged[0]?.status).toBe("complete");
  });
});

describe("mergeRefreshed: idempotency", () => {
  it("produces no duplicates, top-level or nested, when the same refresh batch is applied twice", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "processing" })],
    });
    const refreshedOld = job({
      id: "old-1",
      createdAt: T1,
      status: "superseded",
      supersededByJobId: "latest",
    });
    const fresh = job({ id: "fresh", createdAt: T2, status: "processing" });
    const refreshed = [refreshedOld, fresh];
    const opts = options({ filter: {}, hasMore: false });

    const once = mergeRefreshed([latest], refreshed, opts);
    const twice = mergeRefreshed(once, refreshed, opts);

    expect(twice).toEqual(once);
    const ids = once.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const nestedIds = once.find((r) => r.id === "latest")!.attempts.map((a) => a.id);
    expect(new Set(nestedIds).size).toBe(nestedIds.length);
  });
});

describe("mergeRefreshed: ordering", () => {
  it("orders by clip length rather than creation time under the duration sort", () => {
    // Clip lengths run opposite to creation order, so a bug that sorted on createdAt would reverse
    // this.
    const short = job({ id: "short", createdAt: T3, params: { startSeconds: 0, endSeconds: 2 } });
    const medium = job({ id: "medium", createdAt: T2, params: { startSeconds: 0, endSeconds: 5 } });
    const long = job({ id: "long", createdAt: T1, params: { startSeconds: 0, endSeconds: 9 } });

    const merged = mergeRefreshed(
      [],
      [long, short, medium],
      options({ sort: "duration", dir: "asc" }),
    );

    expect(merged.map((r) => r.id)).toEqual(["short", "medium", "long"]);
  });

  it("reverses the duration order under the descending direction", () => {
    const short = job({ id: "short", createdAt: T3, params: { startSeconds: 0, endSeconds: 2 } });
    const medium = job({ id: "medium", createdAt: T2, params: { startSeconds: 0, endSeconds: 5 } });
    const long = job({ id: "long", createdAt: T1, params: { startSeconds: 0, endSeconds: 9 } });

    const merged = mergeRefreshed(
      [],
      [long, short, medium],
      options({ sort: "duration", dir: "desc" }),
    );

    expect(merged.map((r) => r.id)).toEqual(["long", "medium", "short"]);
  });

  it("orders ascending by creation time under the createdAt sort", () => {
    const a = job({ id: "a", createdAt: T3 });
    const b = job({ id: "b", createdAt: T1 });
    const c = job({ id: "c", createdAt: T2 });

    const merged = mergeRefreshed([], [a, b, c], options({ sort: "createdAt", dir: "asc" }));

    expect(merged.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("mergeRefreshed: deterministic tiebreak when both leading sort components are equal", () => {
  it("breaks a createdAt tie by id, and the tiebreak itself follows the sort direction", () => {
    const tiedA = job({ id: "a-tie", createdAt: T1 });
    const tiedB = job({ id: "b-tie", createdAt: T1 });

    // Without the id tiebreak both rows compare equal, and a stable sort would preserve input order
    // regardless of `dir`.
    const asc = mergeRefreshed([], [tiedB, tiedA], options({ sort: "createdAt", dir: "asc" }));
    expect(asc.map((r) => r.id)).toEqual(["a-tie", "b-tie"]);

    const desc = mergeRefreshed([], [tiedB, tiedA], options({ sort: "createdAt", dir: "desc" }));
    expect(desc.map((r) => r.id)).toEqual(["b-tie", "a-tie"]);
  });

  it("breaks a duration tie (equal clip length AND equal createdAt) by id, following the sort direction", () => {
    const params = { startSeconds: 0, endSeconds: 5 };
    const tiedA = job({ id: "a-tie", createdAt: T1, params });
    const tiedB = job({ id: "b-tie", createdAt: T1, params });

    const asc = mergeRefreshed([], [tiedB, tiedA], options({ sort: "duration", dir: "asc" }));
    expect(asc.map((r) => r.id)).toEqual(["a-tie", "b-tie"]);

    const desc = mergeRefreshed([], [tiedB, tiedA], options({ sort: "duration", dir: "desc" }));
    expect(desc.map((r) => r.id)).toEqual(["b-tie", "a-tie"]);
  });
});

describe("mergeRefreshed: purity", () => {
  it("never mutates the loaded or refreshed arrays, or the rows inside them", () => {
    const latest = job({
      id: "latest",
      createdAt: T3,
      attempts: [attempt({ id: "old-1", createdAt: T1, status: "processing" })],
    });
    const loaded = [latest];
    const refreshed = [
      job({ id: "old-1", createdAt: T1, status: "superseded", supersededByJobId: "latest" }),
      job({ id: "fresh", createdAt: T2 }),
    ];
    const loadedSnapshot = structuredClone(loaded);
    const refreshedSnapshot = structuredClone(refreshed);

    mergeRefreshed(loaded, refreshed, options({ filter: {} }));

    expect(loaded).toEqual(loadedSnapshot);
    expect(refreshed).toEqual(refreshedSnapshot);
  });
});

// A poll exists to notice the one job that moved; a fresh object on every other tick re-rendered
// the whole list for nothing.
describe("mergeRefreshed identity", () => {
  it("returns the very same array when the refresh changed nothing", () => {
    const loaded = [job({ id: "a", status: "processing" }), job({ id: "b", status: "complete" })];
    const refreshed = [{ ...job({ id: "a", status: "processing" }) }];

    const merged = mergeRefreshed(loaded, refreshed, options());

    expect(merged).toBe(loaded);
  });

  it("keeps the untouched rows' own objects when one row did change", () => {
    const loaded = [job({ id: "a", status: "processing" }), job({ id: "b", status: "processing" })];
    const refreshed = [job({ id: "a", status: "complete" })];

    const merged = mergeRefreshed(loaded, refreshed, options());

    expect(merged).not.toBe(loaded);
    expect(merged[0]).not.toBe(loaded[0]);
    expect(merged[0]?.status).toBe("complete");
    expect(merged[1]).toBe(loaded[1]);
  });
});
