import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { HistoryJobsResponse, HistorySourcesResponse } from "@/lib/history-contract";
import { transformParamsSchema } from "@/lib/transform-contract";
import { withErrorHandling } from "@/server/errors/with-error-handling";
import { createJobsRepository, type NewJob } from "@/server/repositories/jobs";
import { createSourcesRepository, type NewSource } from "@/server/repositories/sources";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import { historyQuerySchema, listHistory, MAX_ATTEMPT_DEPTH, parseHistoryQuery } from "./history";

const request = () => new NextRequest("http://localhost/api/history", { method: "GET" });

describe("history service re-exports", () => {
  it("re-exports historyQuerySchema and parseHistoryQuery from the shared contract", () => {
    expect(historyQuerySchema.parse({})).toMatchObject({ tab: "jobs" });
    expect(() => parseHistoryQuery({ tab: "sources", status: "complete" })).toThrow(ZodError);
  });

  // parseHistoryQuery throws a ZodError, never an AppError, so it can live in
  // src/lib (no server-only import) and still be parsed by the browser. Prove
  // that ZodError survives src/server/errors/with-error-handling.ts's mapping
  // to VALIDATION_FAILED exactly the way a schema failure would, the same
  // pattern that module's own test suite uses for a plain schema failure.
  it("maps a raw-presence rejection to VALIDATION_FAILED with field paths", async () => {
    const handler = withErrorHandling(async () => {
      parseHistoryQuery({ tab: "sources", status: "complete", dir: "asc" });
      return Response.json({});
    });
    const response = await handler(request());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.fields).toEqual(
      expect.arrayContaining([
        { path: "status", message: "cannot be combined with tab=sources" },
        { path: "dir", message: "cannot be combined with tab=sources" },
      ]),
    );
  });
});

describe("listHistory", () => {
  const { getDb } = setupTestDb();
  const jobs = createJobsRepository(getDb);
  const sources = createSourcesRepository(getDb);
  const deps = { jobs, sources, config: testConfig };

  const userId = "user-1";
  const otherUserId = "user-2";

  const baseParams = transformParamsSchema.parse({
    name: "beach clip",
    startSeconds: 0,
    endSeconds: 5,
    artStyle: "Watercolor",
  });

  const baseSource: NewSource = {
    uploadcareUuid: randomUUID(),
    uploadcareCdnUrl: "https://ucarecdn.com/placeholder/",
    cloudinaryPublicId: "sources/abc",
    cloudinaryUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mov",
    format: "mov",
    bytes: 1000,
    duration: 12.5,
    width: 1080,
    height: 1920,
  };

  async function insertSource(uid: string, overrides: Partial<NewSource> = {}) {
    return sources.insert(uid, { ...baseSource, uploadcareUuid: randomUUID(), ...overrides });
  }

  async function insertJob(uid: string, overrides: Partial<NewJob> = {}) {
    return jobs.insert(uid, {
      sourceId: randomUUID(),
      params: { ...baseParams },
      idempotencyKey: randomUUID(),
      status: "processing",
      phase: "queued",
      deadlineAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    });
  }

  function query(overrides: Record<string, unknown> = {}) {
    return historyQuerySchema.parse(overrides);
  }

  async function jobsResponse(overrides: Record<string, unknown> = {}) {
    return (await listHistory(query(overrides), userId, deps)) as HistoryJobsResponse;
  }

  beforeEach(async () => {
    const db = await getDb();
    await db.collection("jobs").deleteMany({});
    await db.collection("sources").deleteMany({});
  });

  it("attaches the owner-scoped source projection to every job row", async () => {
    const source = await insertSource(userId);
    const job = await insertJob(userId, { sourceId: source.id, status: "complete" });

    const result = await jobsResponse();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: job.id,
      source: {
        cloudinaryPublicId: source.cloudinaryPublicId,
        cloudinaryUrl: source.cloudinaryUrl,
        duration: source.duration,
      },
      attempts: [],
    });
  });

  it("returns source: null, without throwing, when the source record is missing -- and still renders the rest of the row", async () => {
    const missingSourceId = "65f0000000000000000000ff";
    const job = await insertJob(userId, { sourceId: missingSourceId, status: "complete" });

    const result = await jobsResponse();

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.source).toBeNull();
    expect(item.id).toBe(job.id);
    expect(item.status).toBe("complete");
    expect(item.params).toEqual(job.params);
    expect(item.attempts).toEqual([]);
  });

  it("attaches a retried job's predecessor as its attempts, oldest to newest", async () => {
    const source = await insertSource(userId);
    const original = await insertJob(userId, { sourceId: source.id, status: "superseded" });
    const retry = await insertJob(userId, {
      sourceId: source.id,
      status: "complete",
      retryOfJobId: original.id,
    });

    const result = await jobsResponse();

    expect(result.items.map((item) => item.id)).toEqual([retry.id]);
    expect(result.items[0]!.attempts.map((attempt) => attempt.id)).toEqual([original.id]);
  });

  it("returns a three-deep chain's predecessors oldest to newest on the newest row", async () => {
    const source = await insertSource(userId);
    const first = await insertJob(userId, { sourceId: source.id, status: "superseded" });
    const second = await insertJob(userId, {
      sourceId: source.id,
      status: "superseded",
      retryOfJobId: first.id,
    });
    const third = await insertJob(userId, {
      sourceId: source.id,
      status: "complete",
      retryOfJobId: second.id,
    });

    const result = await jobsResponse();

    expect(result.items.map((item) => item.id)).toEqual([third.id]);
    expect(result.items[0]!.attempts.map((attempt) => attempt.id)).toEqual([first.id, second.id]);
  });

  it("keeps the same attempt count regardless of the page limit", async () => {
    const source = await insertSource(userId);
    for (let i = 0; i < 5; i += 1) {
      await insertJob(userId, { sourceId: source.id, status: "complete" });
    }
    const original = await insertJob(userId, { sourceId: source.id, status: "superseded" });
    // Inserted last, so it is the single newest row regardless of limit.
    const retry = await insertJob(userId, {
      sourceId: source.id,
      status: "complete",
      retryOfJobId: original.id,
    });

    const tightPage = await jobsResponse({ limit: 1 });
    const widePage = await jobsResponse({ limit: 50 });

    expect(tightPage.items[0]!.id).toBe(retry.id);
    const tightAttempts = tightPage.items[0]!.attempts.map((attempt) => attempt.id);
    const wideAttempts = widePage.items
      .find((item) => item.id === retry.id)!
      .attempts.map((attempt) => attempt.id);
    expect(tightAttempts).toEqual([original.id]);
    expect(wideAttempts).toEqual(tightAttempts);
  });

  it("nests attempts only by default; includePrevious=true also lists them top-level", async () => {
    const source = await insertSource(userId);
    const original = await insertJob(userId, { sourceId: source.id, status: "superseded" });
    const retry = await insertJob(userId, {
      sourceId: source.id,
      status: "complete",
      retryOfJobId: original.id,
    });

    const withoutPrevious = await jobsResponse();
    expect(withoutPrevious.items.map((item) => item.id)).toEqual([retry.id]);
    expect(withoutPrevious.items[0]!.attempts.map((attempt) => attempt.id)).toEqual([original.id]);

    const withPrevious = await jobsResponse({ includePrevious: "true" });
    expect(withPrevious.items.map((item) => item.id).sort()).toEqual(
      [original.id, retry.id].sort(),
    );
    const latest = withPrevious.items.find((item) => item.id === retry.id)!;
    expect(latest.attempts.map((attempt) => attempt.id)).toEqual([original.id]);
    const oldest = withPrevious.items.find((item) => item.id === original.id)!;
    expect(oldest.attempts).toEqual([]);
  });

  it("truncates an attempt chain deeper than MAX_ATTEMPT_DEPTH", async () => {
    const source = await insertSource(userId);
    let previous: { id: string } | undefined;
    let head: { id: string } | undefined;
    for (let i = 0; i < MAX_ATTEMPT_DEPTH + 3; i += 1) {
      head = await insertJob(userId, {
        sourceId: source.id,
        status: i === MAX_ATTEMPT_DEPTH + 2 ? "complete" : "superseded",
        ...(previous ? { retryOfJobId: previous.id } : {}),
      });
      previous = head;
    }

    const result = await jobsResponse();

    expect(result.items.map((item) => item.id)).toEqual([head!.id]);
    // MAX_ATTEMPT_DEPTH batches resolve at most that many ancestor levels;
    // the chain is longer than that, so it is truncated rather than thrown.
    expect(result.items[0]!.attempts.length).toBeLessThanOrEqual(MAX_ATTEMPT_DEPTH);
    expect(result.items[0]!.attempts.length).toBeGreaterThan(0);
  });

  it("returns SourceView rows with transformCount and no active key on tab=sources", async () => {
    const source = await insertSource(userId);
    const other = await insertSource(userId);
    await insertJob(userId, { sourceId: source.id, status: "complete" });
    await insertJob(userId, { sourceId: source.id, status: "failed" });
    const first = await insertJob(userId, { sourceId: source.id, status: "superseded" });
    await insertJob(userId, {
      sourceId: source.id,
      status: "complete",
      retryOfJobId: first.id,
    });
    await insertJob(userId, { sourceId: other.id, status: "complete" });

    const result = (await listHistory(
      query({ tab: "sources" }),
      userId,
      deps,
    )) as HistorySourcesResponse;

    expect("active" in result).toBe(false);
    expect(result.items).toHaveLength(2);
    const sourceRow = result.items.find((item) => item.id === source.id)!;
    expect(sourceRow.transformCount).toBe(4);
    const otherRow = result.items.find((item) => item.id === other.id)!;
    expect(otherRow.transformCount).toBe(1);
  });

  it("changeable=true returns the five changeable statuses, nextCursor null, still carries active", async () => {
    const source = await insertSource(userId);
    const changeableStatuses = [
      "processing",
      "finalizing",
      "timed_out",
      "superseded",
      "abandoned",
    ] as const;
    for (const status of changeableStatuses) {
      await insertJob(userId, { sourceId: source.id, status });
    }
    await insertJob(userId, { sourceId: source.id, status: "complete" });
    await insertJob(userId, { sourceId: source.id, status: "failed" });

    const result = await jobsResponse({ changeable: "true" });

    expect(result.items).toHaveLength(5);
    expect(result.items.map((item) => item.status).sort()).toEqual([...changeableStatuses].sort());
    expect(result.nextCursor).toBeNull();
    expect(result.active).toMatchObject({
      processing: expect.any(Number),
      finalizing: expect.any(Number),
      timedOut: expect.any(Number),
      superseded: expect.any(Number),
    });
    // Every changeable row still renders complete: the projection is
    // present on this path too, not only the default paginated one.
    for (const item of result.items) expect(item.source!.cloudinaryPublicId).toBeDefined();
  });

  it("ids returns only the caller's own rows, nextCursor null, still carries active", async () => {
    const source = await insertSource(userId);
    const mine = await insertJob(userId, { sourceId: source.id, status: "complete" });
    const theirSource = await insertSource(otherUserId);
    const theirs = await insertJob(otherUserId, { sourceId: theirSource.id, status: "complete" });

    const result = await jobsResponse({ ids: `${mine.id},${theirs.id}` });

    expect(result.items.map((item) => item.id)).toEqual([mine.id]);
    expect(result.nextCursor).toBeNull();
    expect(result.active).toMatchObject({
      processing: expect.any(Number),
      finalizing: expect.any(Number),
      timedOut: expect.any(Number),
      superseded: expect.any(Number),
    });
  });

  it("decodes the duration sort's nextCursor under sort=duration, and refuses it under sort=createdAt", async () => {
    const source = await insertSource(userId);
    for (let i = 0; i < 3; i += 1) {
      await insertJob(userId, {
        sourceId: source.id,
        status: "complete",
        params: { ...baseParams, endSeconds: 5 + i },
      });
    }

    const firstPage = await jobsResponse({ sort: "duration", limit: 1 });
    expect(firstPage.nextCursor).not.toBeNull();

    const nextPage = await jobsResponse({
      sort: "duration",
      limit: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(nextPage.items).toHaveLength(1);

    await expect(
      listHistory(query({ sort: "createdAt", cursor: firstPage.nextCursor! }), userId, deps),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
