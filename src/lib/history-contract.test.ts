import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  historyJobsResponseSchema,
  historyQuerySchema,
  parseHistoryQuery,
} from "./history-contract";

const parse = (input: Record<string, string>) => historyQuerySchema.safeParse(input);

describe("history query contract", () => {
  it("defaults to today's behaviour when nothing is sent", () => {
    const result = historyQuerySchema.parse({});
    expect(result).toMatchObject({
      tab: "jobs",
      includePrevious: false,
      sort: "createdAt",
      dir: "desc",
      limit: 20,
    });
    expect(result.status).toBeUndefined();
    expect(result.statusBucket).toBeUndefined();
    expect(result.changeable).toBe(false);
    expect(result.ids).toBeUndefined();
  });

  it("accepts a status bucket and a duration sort", () => {
    const result = historyQuerySchema.parse({ statusBucket: "failed", sort: "duration" });
    expect(result.statusBucket).toBe("failed");
    expect(result.sort).toBe("duration");
  });

  it("rejects status together with statusBucket", () => {
    expect(parse({ status: "complete", statusBucket: "complete" }).success).toBe(false);
  });

  it("rejects job-only parameters under tab=sources", () => {
    const extras: Record<string, string>[] = [
      { status: "complete" },
      { statusBucket: "failed" },
      { style: "Watercolor" },
      { includePrevious: "true" },
      { sort: "duration" },
      { dir: "asc" },
      { changeable: "true" },
      { ids: "65f000000000000000000001" },
    ];
    for (const extra of extras) {
      expect(() => parseHistoryQuery({ tab: "sources", ...extra })).toThrow(ZodError);
    }
  });

  it("accepts tab=sources with only pagination", () => {
    expect(() => parseHistoryQuery({ tab: "sources", limit: "5" })).not.toThrow();
  });

  it("rejects filter and ordering parameters alongside changeable", () => {
    const extras: Record<string, string>[] = [
      { status: "complete" },
      { statusBucket: "failed" },
      { style: "Watercolor" },
      { sort: "duration" },
      { dir: "asc" },
      { cursor: "abc" },
      { limit: "5" },
      { includePrevious: "true" },
    ];
    for (const extra of extras) {
      expect(() => parseHistoryQuery({ changeable: "true", ...extra })).toThrow(ZodError);
    }
  });

  it("rejects the same parameters alongside ids", () => {
    const ids = "65f000000000000000000001";
    expect(() => parseHistoryQuery({ ids, status: "complete" })).toThrow(ZodError);
    expect(() => parseHistoryQuery({ ids, cursor: "abc" })).toThrow(ZodError);
    expect(() => parseHistoryQuery({ ids, limit: "5" })).toThrow(ZodError);
  });

  // changeable and ids both ignore `limit`, so it must be refused rather than silently disregarded,
  // exactly like `cursor` already is.
  it("names limit, not just cursor, when rejecting it alongside changeable or ids", () => {
    const ids = "65f000000000000000000001";
    let caught: unknown;
    try {
      parseHistoryQuery({ changeable: "true", limit: "5" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZodError);
    expect((caught as ZodError).issues).toEqual([
      { code: "custom", path: ["limit"], message: "cannot be combined with changeable" },
    ]);

    let caughtIds: unknown;
    try {
      parseHistoryQuery({ ids, limit: "5" });
    } catch (error) {
      caughtIds = error;
    }
    expect(caughtIds).toBeInstanceOf(ZodError);
    expect((caughtIds as ZodError).issues).toEqual([
      { code: "custom", path: ["limit"], message: "cannot be combined with ids" },
    ]);
  });

  it("rejects changeable together with ids", () => {
    expect(parse({ changeable: "true", ids: "65f000000000000000000001" }).success).toBe(false);
  });

  it("splits ids, collapses duplicates and caps the list at 50", () => {
    const a = "65f000000000000000000001";
    const b = "65f000000000000000000002";
    expect(historyQuerySchema.parse({ ids: `${a},${b},${a}` }).ids).toEqual([a, b]);
    const tooMany = Array.from(
      { length: 51 },
      (_, i) => `65f0000000000000000000${String(i).padStart(2, "0")}`,
    ).join(",");
    expect(parse({ ids: tooMany }).success).toBe(false);
  });

  it("rejects an unknown parameter", () => {
    expect(parse({ nope: "1" }).success).toBe(false);
  });

  // with-error-handling.ts reads `issue.path.join(".")` and `issue.message`, so this pins that
  // shape without leaving src/lib.
  it("throws a ZodError whose issues carry a joinable path and a message", () => {
    let caught: unknown;
    try {
      parseHistoryQuery({ tab: "sources", status: "complete", dir: "asc" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZodError);
    const fields = (caught as ZodError).issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    expect(fields).toEqual([
      { path: "status", message: "cannot be combined with tab=sources" },
      { path: "dir", message: "cannot be combined with tab=sources" },
    ]);
  });
});

describe("history response contract", () => {
  it("requires the source projection and an attempts array on every job row", () => {
    const row = {
      id: "65f000000000000000000001",
      sourceId: "65f0000000000000000000a1",
      status: "complete",
      phase: "rendering",
      params: {
        name: "clip",
        startSeconds: 0,
        endSeconds: 5,
        fpsResolution: "HALF",
        artStyle: "Watercolor",
        promptType: "default",
        model: "default",
        version: "default",
      },
      createdAt: "2026-09-20T10:00:00.000Z",
      deadlineAt: "2026-09-20T11:00:00.000Z",
      source: {
        cloudinaryPublicId: "sources/abc",
        cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/sources/abc.mp4",
        duration: 12.5,
      },
      attempts: [],
    };
    const parsed = historyJobsResponseSchema.parse({
      items: [row],
      nextCursor: null,
      active: { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 },
    });
    expect(parsed.items[0]!.source!.duration).toBe(12.5);
    expect(parsed.items[0]!.attempts).toEqual([]);
    expect(
      historyJobsResponseSchema.safeParse({
        items: [{ ...row, source: undefined }],
        nextCursor: null,
        active: { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 },
      }).success,
    ).toBe(false);
  });
});
