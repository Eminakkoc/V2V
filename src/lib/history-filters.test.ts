import { describe, expect, it } from "vitest";
import { JOB_STATUSES } from "./job-status";
import { BUCKET_STATUSES, matchesFilter, resolveStatuses, STATUS_BUCKETS } from "./history-filters";

describe("history filters", () => {
  it("maps each bucket onto the statuses the architecture records", () => {
    expect(BUCKET_STATUSES["in-progress"]).toEqual(["processing", "finalizing"]);
    expect(BUCKET_STATUSES["taking-longer"]).toEqual(["timed_out"]);
    expect(BUCKET_STATUSES.complete).toEqual(["complete"]);
    expect(BUCKET_STATUSES.failed).toEqual(["failed", "abandoned"]);
  });

  it("never places superseded in a bucket", () => {
    for (const bucket of STATUS_BUCKETS) {
      expect(BUCKET_STATUSES[bucket]).not.toContain("superseded");
    }
  });

  it("covers every status except superseded across all buckets", () => {
    const covered = new Set(STATUS_BUCKETS.flatMap((bucket) => BUCKET_STATUSES[bucket]));
    const expected = JOB_STATUSES.filter((status) => status !== "superseded");
    expect([...covered].sort()).toEqual([...expected].sort());
  });

  it("resolves nothing when neither status nor bucket is given", () => {
    expect(resolveStatuses({})).toBeUndefined();
  });

  it("resolves a single status to a one-element set", () => {
    expect(resolveStatuses({ status: "complete" })).toEqual(["complete"]);
  });

  it("resolves a bucket to its status set", () => {
    expect(resolveStatuses({ statusBucket: "failed" })).toEqual(["failed", "abandoned"]);
  });

  it("matches everything when no filter is active", () => {
    expect(matchesFilter("superseded", {})).toBe(true);
    expect(matchesFilter("complete", {})).toBe(true);
  });

  it("matches a row against the active bucket", () => {
    expect(matchesFilter("abandoned", { statusBucket: "failed" })).toBe(true);
    expect(matchesFilter("complete", { statusBucket: "failed" })).toBe(false);
  });
});
