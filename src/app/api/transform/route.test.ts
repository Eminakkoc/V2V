import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { transformRequestSchema } from "@/lib/transform-contract";
import { transformResponseSchema } from "@/lib/transform-contract";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import { AppError } from "@/server/errors/app-error";
import type { MagicHourAdapter, Providers } from "@/server/providers/types";
import { ensureIndexes } from "@/server/repositories/indexes";
import { createJobsRepository } from "@/server/repositories/jobs";
import { createRateLimitHitsRepository } from "@/server/repositories/rate-limit-hits";
import { createSourcesRepository } from "@/server/repositories/sources";
import { createRateLimiter } from "@/server/services/rate-limit";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import { apiRequest, identityCookie } from "@/test/requests";
import { POST } from "./route";

const { getDb } = setupTestDb();
const userId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const otherUserId = "9c1d2e3a-4b5c-4d6e-8f70-112233445566";

const sourceInput = {
  uploadcareUuid: "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a",
  uploadcareCdnUrl: "https://ucarecdn.com/3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a/",
  cloudinaryPublicId: "sources/abc",
  cloudinaryUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mov",
  format: "mov",
  bytes: 1_000_000,
  duration: 12.5,
  width: 1080,
  height: 1920,
};

const validParams = {
  name: "beach clip",
  startSeconds: 0,
  endSeconds: 5,
  artStyle: "Watercolor" as const,
};

// The transform route never touches Uploadcare or Cloudinary; these stubs
// only satisfy the type.
const unusedUploadcare = { getFileInfo: () => Promise.reject(new Error("unused")) };
const unusedCloudinary = { copyVideoFromUrl: () => Promise.reject(new Error("unused")) };

let createJob: ReturnType<typeof vi.fn<MagicHourAdapter["createJob"]>>;

function useDeps() {
  const providers: Providers = {
    uploadcare: unusedUploadcare,
    cloudinary: unusedCloudinary,
    magicHour: {
      createJob,
      getJobDetails: () => Promise.reject(new Error("unused")),
      verifyWebhook: () => {
        throw new Error("unused");
      },
    },
  };
  setServerDepsForTests(buildServerDeps(testConfig, { getDb, providers }));
}

async function insertSource(uid: string, overrides: Partial<typeof sourceInput> = {}) {
  const db = await getDb();
  const sources = createSourcesRepository(() => Promise.resolve(db));
  return sources.insert(uid, { ...sourceInput, ...overrides });
}

// z.input, not the schema's output type: this builds the wire payload a
// client sends, before Zod fills in defaults like fpsResolution.
type TransformRequestInput = z.input<typeof transformRequestSchema>;

function makeBody(
  sourceId: string,
  overrides: Partial<TransformRequestInput> = {},
): TransformRequestInput {
  return {
    sourceId,
    params: { ...validParams },
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

const transform = (body: unknown, init: { cookie?: string } = {}) =>
  POST(apiRequest("/api/transform", { body, cookie: init.cookie ?? identityCookie(userId) }));

async function errorOf(response: Response) {
  return (await response.json()).error;
}

async function jobDoc(id: string) {
  const db = await getDb();
  return db.collection("jobs").findOne({ _id: new ObjectId(id) });
}

// The unique {userId, idempotencyKey} index is what the concurrent-request
// test below relies on to reproduce the duplicate-key race; it is only
// created out-of-band in production (scripts/create-indexes.ts), so the test
// database needs it set up explicitly.
beforeAll(async () => ensureIndexes(await getDb()));

beforeEach(async () => {
  const db = await getDb();
  await Promise.all(
    ["sources", "jobs", "rateLimitHits"].map((name) => db.collection(name).deleteMany({})),
  );
  createJob = vi.fn(async () => ({ magicHourId: `mh-${randomUUID()}` }));
  useDeps();
});
afterEach(() => setServerDepsForTests(undefined));

describe("POST /api/transform", () => {
  it("returns 202 with a processing/queued job and attaches the provider id", async () => {
    const source = await insertSource(userId);
    const response = await transform(makeBody(source.id));
    expect(response.status).toBe(202);
    const body = transformResponseSchema.parse(await response.json());
    expect(body.job.status).toBe("processing");
    expect(body.job.phase).toBe("queued");
    expect(createJob).toHaveBeenCalledTimes(1);

    const saved = await jobDoc(body.job.id);
    expect(saved).toMatchObject({ status: "processing", phase: "queued" });
    expect(typeof saved?.magicHourId).toBe("string");
  });

  it("returns 202 with the job as inserted when the provider accepts the job but persisting its id fails", async () => {
    const source = await insertSource(userId);
    const db = await getDb();
    setServerDepsForTests({
      config: testConfig,
      sources: createSourcesRepository(() => Promise.resolve(db)),
      jobs: {
        ...createJobsRepository(() => Promise.resolve(db)),
        // Simulates a database blip landing right after a successful create:
        // the job is already live at Magic Hour, so this must not be treated
        // as a failed submission.
        attachMagicHourId: () => Promise.reject(new AppError("DATABASE_UNAVAILABLE")),
      },
      rateLimiter: createRateLimiter(createRateLimitHitsRepository(() => Promise.resolve(db))),
      uploadcare: unusedUploadcare,
      cloudinary: unusedCloudinary,
      magicHour: {
        createJob,
        getJobDetails: () => Promise.reject(new Error("unused")),
        verifyWebhook: () => {
          throw new Error("unused");
        },
      },
    });

    const response = await transform(makeBody(source.id));
    expect(response.status).toBe(202);
    const body = transformResponseSchema.parse(await response.json());
    expect(body.job.status).toBe("processing");
    expect(body.job.phase).toBe("submitting");

    const saved = await jobDoc(body.job.id);
    expect(saved).toMatchObject({ status: "processing", phase: "submitting" });
    expect(saved?.magicHourId).toBeUndefined();
  });

  it("keeps the job row before calling the provider: a definite rejection still leaves a failed record", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const source = await insertSource(userId);
    createJob.mockRejectedValueOnce(
      new AppError("MAGIC_HOUR_REQUEST_FAILED", { details: { definite: true } }),
    );
    const response = await transform(makeBody(source.id));
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe("MAGIC_HOUR_REQUEST_FAILED");

    const db = await getDb();
    const saved = await db.collection("jobs").findOne({});
    expect(saved).toMatchObject({ status: "failed", errorCode: "MAGIC_HOUR_REQUEST_FAILED" });
  });

  it("returns the same job for a repeated idempotencyKey and calls the provider only once", async () => {
    const source = await insertSource(userId);
    const body = makeBody(source.id);
    const first = await transform(body);
    expect(first.status).toBe(202);
    const firstJob = transformResponseSchema.parse(await first.json()).job;

    const second = await transform(body);
    expect(second.status).toBe(202);
    const secondJob = transformResponseSchema.parse(await second.json()).job;

    expect(secondJob.id).toBe(firstJob.id);
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(await (await getDb()).collection("jobs").countDocuments()).toBe(1);
  });

  it("returns 202 for both requests when two genuinely concurrent submissions share an idempotencyKey", async () => {
    const source = await insertSource(userId);
    const body = makeBody(source.id);
    // Both requests race past the idempotency read above before either has
    // inserted; the unique {userId, idempotencyKey} index then rejects the
    // loser's insert, which must be turned back into the winner's 202, not
    // a 500.
    const [first, second] = await Promise.all([transform(body), transform(body)]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstJob = transformResponseSchema.parse(await first.json()).job;
    const secondJob = transformResponseSchema.parse(await second.json()).job;
    expect(firstJob.id).toBe(secondJob.id);
    expect(createJob).toHaveBeenCalledTimes(1);

    const db = await getDb();
    expect(
      await db.collection("jobs").countDocuments({ idempotencyKey: body.idempotencyKey }),
    ).toBe(1);
  });

  it("returns 404 SOURCE_NOT_FOUND when the source belongs to another user", async () => {
    const source = await insertSource(otherUserId);
    const response = await transform(makeBody(source.id));
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("SOURCE_NOT_FOUND");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("returns 400 CLIP_TOO_LONG when the clip exceeds the configured maximum", async () => {
    const source = await insertSource(userId, { duration: 100 });
    const response = await transform(
      makeBody(source.id, {
        params: { ...validParams, startSeconds: 0, endSeconds: testConfig.maxClipSeconds + 1 },
      }),
    );
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("CLIP_TOO_LONG");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("returns 400 CLIP_TOO_LONG when endSeconds exceeds the source's real duration", async () => {
    const source = await insertSource(userId, { duration: 5 });
    const response = await transform(
      makeBody(source.id, { params: { ...validParams, startSeconds: 0, endSeconds: 6 } }),
    );
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("CLIP_TOO_LONG");
    expect(createJob).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED for a bad body", async () => {
    const response = await transform({ sourceId: "abc" });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("VALIDATION_FAILED");
  });

  it.each([
    ["MAGIC_HOUR_INSUFFICIENT_CREDITS", 402],
    ["MAGIC_HOUR_INVALID_PARAMS", 422],
    ["MAGIC_HOUR_MISCONFIGURED", 500],
  ] as const)(
    "marks the job failed and returns the error for a definite %s rejection",
    async (code, status) => {
      if (status >= 500) vi.spyOn(console, "error").mockImplementation(() => {});
      const source = await insertSource(userId);
      createJob.mockRejectedValueOnce(new AppError(code, { details: { definite: true } }));
      const response = await transform(makeBody(source.id));
      expect(response.status).toBe(status);
      expect((await errorOf(response)).code).toBe(code);

      const db = await getDb();
      const saved = await db.collection("jobs").findOne({});
      expect(saved).toMatchObject({ status: "failed", errorCode: code });
    },
  );

  it("returns 202 with the job still processing/submitting when the provider outcome is uncertain, and records lastError", async () => {
    const source = await insertSource(userId);
    createJob.mockRejectedValueOnce(
      new AppError("MAGIC_HOUR_REQUEST_FAILED", { details: { definite: false } }),
    );
    const response = await transform(makeBody(source.id));
    expect(response.status).toBe(202);
    const body = transformResponseSchema.parse(await response.json());
    expect(body.job.status).toBe("processing");
    expect(body.job.phase).toBe("submitting");

    const saved = await jobDoc(body.job.id);
    expect(saved).toMatchObject({ status: "processing", phase: "submitting" });
    expect(typeof saved?.lastError).toBe("string");
    expect(saved?.magicHourId).toBeUndefined();
  });

  it("marks the old job superseded and links both jobs when retryOfJobId names a failed job", async () => {
    const source = await insertSource(userId);
    // A retry is only ever offered in the UI for a job in a retryable state;
    // drive the original there for real via a definite provider rejection.
    createJob.mockRejectedValueOnce(
      new AppError("MAGIC_HOUR_INVALID_PARAMS", { details: { definite: true } }),
    );
    await transform(makeBody(source.id));
    const originalDoc = await (await getDb()).collection("jobs").findOne({});
    const originalId = originalDoc!._id.toHexString();
    expect(originalDoc?.status).toBe("failed");

    const retryResponse = await transform(makeBody(source.id, { retryOfJobId: originalId }));
    expect(retryResponse.status).toBe(202);
    const retryJob = transformResponseSchema.parse(await retryResponse.json()).job;
    expect(retryJob.retryOfJobId).toBe(originalId);

    const oldDoc = await jobDoc(originalId);
    expect(oldDoc).toMatchObject({ status: "superseded", supersededByJobId: retryJob.id });
  });

  it("does not supersede a job that is not in a retryable state, and still creates the new job", async () => {
    const source = await insertSource(userId);
    const original = transformResponseSchema.parse(
      await (await transform(makeBody(source.id))).json(),
    ).job;
    expect(original.status).toBe("processing");

    // Naming a still-live (or complete) job's id must not be able to make a
    // render the user paid for permanently invisible.
    const retryResponse = await transform(makeBody(source.id, { retryOfJobId: original.id }));
    expect(retryResponse.status).toBe(202);
    const retryJob = transformResponseSchema.parse(await retryResponse.json()).job;
    expect(retryJob.retryOfJobId).toBe(original.id);

    const originalDoc = await jobDoc(original.id);
    expect(originalDoc?.status).toBe("processing");
    expect(originalDoc?.supersededByJobId).toBeUndefined();
  });

  it("allows retryOfJobId to reference another user's job, but the source owner check still refuses a source the caller does not own", async () => {
    const otherSource = await insertSource(otherUserId);
    createJob.mockRejectedValueOnce(
      new AppError("MAGIC_HOUR_INVALID_PARAMS", { details: { definite: true } }),
    );
    await transform(makeBody(otherSource.id), { cookie: identityCookie(otherUserId) });
    const otherJobDocBefore = await (
      await getDb()
    )
      .collection("jobs")
      .findOne({ userId: otherUserId });
    const otherJobId = otherJobDocBefore!._id.toHexString();
    expect(otherJobDocBefore?.status).toBe("failed");

    // Retrying another user's job is accepted when the caller's own source is used.
    const ownSource = await insertSource(userId);
    const retryResponse = await transform(makeBody(ownSource.id, { retryOfJobId: otherJobId }));
    expect(retryResponse.status).toBe(202);
    const retryJob = transformResponseSchema.parse(await retryResponse.json()).job;
    expect(retryJob.retryOfJobId).toBe(otherJobId);
    const otherJobDoc = await jobDoc(otherJobId);
    expect(otherJobDoc).toMatchObject({ status: "superseded", supersededByJobId: retryJob.id });

    // But a source the caller does not own is still refused, retryOfJobId or not.
    const refused = await transform(makeBody(otherSource.id, { retryOfJobId: otherJobId }));
    expect(refused.status).toBe(404);
    expect((await errorOf(refused)).code).toBe("SOURCE_NOT_FOUND");
  });

  it("rate limits the 11th transform with Retry-After", async () => {
    const source = await insertSource(userId);
    for (let i = 0; i < 10; i += 1) {
      expect((await transform(makeBody(source.id))).status).toBe(202);
    }
    const limited = await transform(makeBody(source.id));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});
