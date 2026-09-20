import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historySourcesResponseSchema } from "@/lib/history-contract";
import { historyResponseSchema, transformParamsSchema } from "@/lib/transform-contract";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import type { MagicHourAdapter, Providers } from "@/server/providers/types";
import { createJobsRepository, type NewJob } from "@/server/repositories/jobs";
import { createSourcesRepository, type NewSource } from "@/server/repositories/sources";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import { apiGetRequest, identityCookie } from "@/test/requests";
import { GET } from "./route";

const { getDb } = setupTestDb();
const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const otherUserId = "9c1d2e3a-4b5c-4d6e-8f70-112233445566";

// Parsed (not a literal) so the result carries the schema's resolved defaults
// (fpsResolution, promptType, model, version), matching what jobs.insert expects.
const baseParams = transformParamsSchema.parse({
  name: "beach clip",
  startSeconds: 0,
  endSeconds: 5,
  artStyle: "Watercolor",
});

// The history route never touches any provider; these stubs only satisfy the type.
const unusedUploadcare = { getFileInfo: () => Promise.reject(new Error("unused")) };
const unusedCloudinary = { copyVideoFromUrl: () => Promise.reject(new Error("unused")) };
const unusedMagicHour: MagicHourAdapter = {
  createJob: () => Promise.reject(new Error("unused")),
  getJobDetails: () => Promise.reject(new Error("unused")),
  verifyWebhook: () => {
    throw new Error("unused");
  },
};

function useDeps() {
  const providers: Providers = {
    uploadcare: unusedUploadcare,
    cloudinary: unusedCloudinary,
    magicHour: unusedMagicHour,
  };
  setServerDepsForTests(buildServerDeps(testConfig, { getDb, providers }));
}

async function insertJob(uid: string, overrides: Partial<NewJob> = {}) {
  const db = await getDb();
  const jobs = createJobsRepository(() => Promise.resolve(db));
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
  const db = await getDb();
  const sources = createSourcesRepository(() => Promise.resolve(db));
  return sources.insert(uid, { ...baseSource, uploadcareUuid: randomUUID(), ...overrides });
}

const history = (query = "", init: { cookie?: string } = {}) =>
  GET(apiGetRequest(`/api/history${query}`, { cookie: init.cookie ?? identityCookie(userId) }));

async function errorOf(response: Response) {
  return (await response.json()).error;
}

async function bodyOf(response: Response) {
  return historyResponseSchema.parse(await response.json());
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("jobs").deleteMany({});
  useDeps();
});
afterEach(() => setServerDepsForTests(undefined));

describe("GET /api/history", () => {
  it("returns 200 with items, nextCursor and active counts for the caller only", async () => {
    await insertJob(userId, { status: "processing" });
    await insertJob(userId, { status: "finalizing" });
    await insertJob(otherUserId, { status: "processing" });

    const response = await history();
    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
    expect(body.active).toMatchObject({
      processing: 1,
      finalizing: 1,
      timedOut: 0,
      superseded: 0,
    });
  });

  it("never returns another user's jobs", async () => {
    await insertJob(otherUserId);
    await insertJob(otherUserId, { status: "complete" });

    const body = await bodyOf(await history());
    expect(body.items).toHaveLength(0);
    expect(body.active).toMatchObject({ processing: 0, finalizing: 0, timedOut: 0, superseded: 0 });
  });

  it("excludes superseded jobs by default and includes them with includePrevious=true", async () => {
    await insertJob(userId, { status: "superseded" });
    await insertJob(userId, { status: "complete" });

    const withoutPrevious = await bodyOf(await history());
    expect(withoutPrevious.items).toHaveLength(1);
    expect(withoutPrevious.items[0]?.status).toBe("complete");

    const withPrevious = await bodyOf(await history("?includePrevious=true"));
    expect(withPrevious.items).toHaveLength(2);
    expect(withPrevious.items.map((item) => item.status).sort()).toEqual([
      "complete",
      "superseded",
    ]);
  });

  it("defaults limit to 20 and accepts the cap of 50", async () => {
    for (let i = 0; i < 25; i += 1) await insertJob(userId);

    const defaultPage = await bodyOf(await history());
    expect(defaultPage.items).toHaveLength(20);
    expect(defaultPage.nextCursor).not.toBeNull();

    const cappedPage = await bodyOf(await history("?limit=50"));
    expect(cappedPage.items).toHaveLength(25);
    expect(cappedPage.nextCursor).toBeNull();
  });

  it("paginates via cursor without repeating or skipping items", async () => {
    for (let i = 0; i < 5; i += 1) await insertJob(userId);
    const full = await bodyOf(await history("?limit=50"));
    expect(full.items).toHaveLength(5);

    const collected: string[] = [];
    let cursor: string | null = null;
    do {
      const query = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2";
      const page = await bodyOf(await history(query));
      collected.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(collected).toEqual(full.items.map((item) => item.id));
  });

  it("filters by status", async () => {
    await insertJob(userId, { status: "complete" });
    await insertJob(userId, { status: "failed" });

    const body = await bodyOf(await history("?status=complete"));
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe("complete");
  });

  it("filters by style", async () => {
    await insertJob(userId, { params: { ...baseParams, artStyle: "Anime Warrior" } });
    await insertJob(userId, { params: { ...baseParams, artStyle: "Watercolor" } });

    const body = await bodyOf(await history(`?style=${encodeURIComponent("Anime Warrior")}`));
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.params.artStyle).toBe("Anime Warrior");
  });

  it("returns 400 VALIDATION_FAILED for a bad limit", async () => {
    const response = await history("?limit=51");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 VALIDATION_FAILED for a bad status", async () => {
    const response = await history("?status=bogus");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 VALIDATION_FAILED for a bad cursor", async () => {
    const response = await history("?cursor=not-a-real-cursor");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it("sorts by clip duration under sort=duration", async () => {
    await insertJob(userId, { params: { ...baseParams, endSeconds: 5 } });
    await insertJob(userId, { params: { ...baseParams, endSeconds: 8 } });
    await insertJob(userId, { params: { ...baseParams, endSeconds: 3 } });

    const body = await bodyOf(await history("?sort=duration"));
    // dir defaults to desc, and baseParams.startSeconds is 0, so each clip's
    // duration equals its endSeconds.
    expect(body.items.map((item) => item.params.endSeconds)).toEqual([8, 5, 3]);
  });

  it("returns source rows with no active key under tab=sources", async () => {
    const source = await insertSource(userId);
    await insertJob(userId, { sourceId: source.id, status: "complete" });

    const response = await history("?tab=sources");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).not.toHaveProperty("active");

    // Pins sourceViewSchema's shape: a future field change on the sources tab
    // fails this parse loudly rather than sliding through as an extra key.
    const body = historySourcesResponseSchema.parse(json);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: source.id,
      cloudinaryPublicId: source.cloudinaryPublicId,
      transformCount: 1,
    });
  });

  it("returns nextCursor: null for changeable=true", async () => {
    await insertJob(userId, { status: "processing" });
    await insertJob(userId, { status: "complete" });

    const body = await bodyOf(await history("?changeable=true"));
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe("processing");
  });

  it("omits another user's id from an ids lookup", async () => {
    const mine = await insertJob(userId, { status: "complete" });
    const theirs = await insertJob(otherUserId, { status: "complete" });

    const body = await bodyOf(await history(`?ids=${mine.id},${theirs.id}`));
    expect(body.items.map((item) => item.id)).toEqual([mine.id]);
    expect(body.nextCursor).toBeNull();
  });

  it("rejects tab=sources combined with status", async () => {
    const response = await history("?tab=sources&status=complete");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it("rejects changeable=true combined with sort", async () => {
    const response = await history("?changeable=true&sort=duration");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it("rejects ids combined with cursor", async () => {
    const response = await history(`?ids=${"a".repeat(24)}&cursor=abc`);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it("carries Cache-Control: private, no-store", async () => {
    const response = await history();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns a response body that validates against historyResponseSchema", async () => {
    await insertJob(userId, { status: "complete" });
    const result = historyResponseSchema.safeParse(await (await history()).json());
    expect(result.success).toBe(true);
  });
});
