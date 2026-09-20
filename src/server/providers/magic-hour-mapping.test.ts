import { describe, expect, it } from "vitest";
import { buildJobName, mapProviderStatus, parseJobName } from "./magic-hour-mapping";

const jobId = "65f000000000000000000001";

describe("job name correlation", () => {
  it("round-trips the job id", () => {
    expect(parseJobName(buildJobName(jobId, "beach clip"))).toBe(jobId);
  });

  it("keeps the whole name within Magic Hour's limit by truncating the user part", () => {
    const name = buildJobName(jobId, "x".repeat(500));
    expect(name.length).toBeLessThanOrEqual(120);
    expect(parseJobName(name)).toBe(jobId);
  });

  it("survives a user name that itself looks like a prefix", () => {
    expect(parseJobName(buildJobName(jobId, "v2v:deadbeef other"))).toBe(jobId);
  });

  it("returns null for names it did not build", () => {
    expect(parseJobName("Untitled video")).toBeNull();
    expect(parseJobName(null)).toBeNull();
    expect(parseJobName(undefined)).toBeNull();
    expect(parseJobName("v2v:")).toBeNull();
    expect(parseJobName("v2v:not-an-object-id rest")).toBeNull();
  });
});

describe("provider status mapping", () => {
  it("maps queued and rendering to our processing phases", () => {
    expect(mapProviderStatus("queued")).toEqual({
      kind: "progress",
      status: "processing",
      phase: "queued",
    });
    expect(mapProviderStatus("rendering")).toEqual({
      kind: "progress",
      status: "processing",
      phase: "rendering",
    });
  });

  it("maps complete to the finalize trigger", () => {
    expect(mapProviderStatus("complete")).toEqual({ kind: "complete" });
  });

  it("maps error and canceled to distinct failure codes", () => {
    expect(mapProviderStatus("error")).toEqual({
      kind: "failed",
      errorCode: "MAGIC_HOUR_JOB_FAILED",
    });
    expect(mapProviderStatus("canceled")).toEqual({
      kind: "failed",
      errorCode: "MAGIC_HOUR_JOB_CANCELED",
    });
  });

  it("ignores draft, which we never expect to see", () => {
    expect(mapProviderStatus("draft")).toEqual({ kind: "ignored" });
  });
});
