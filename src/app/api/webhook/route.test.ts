import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransformParams } from "@/lib/transform-contract";
import { buildServerDeps, setServerDepsForTests } from "@/server/deps";
import { buildJobName } from "@/server/providers/magic-hour-mapping";
import { verifyWebhookSignature } from "@/server/providers/magic-hour-signature";
import type {
  CloudinaryAdapter,
  MagicHourAdapter,
  MagicHourJobDetails,
  Providers,
  StoredVideo,
} from "@/server/providers/types";
import { createJobsRepository, type NewJob } from "@/server/repositories/jobs";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import { apiRequest } from "@/test/requests";
import { POST } from "./route";

const { getDb } = setupTestDb();
const jobs = createJobsRepository(getDb);
const webhookSecret = testConfig.magicHour.webhookSecret;
const userId = "user-1";

const baseParams: TransformParams = {
  name: "beach clip",
  startSeconds: 0,
  endSeconds: 5,
  fpsResolution: "HALF",
  artStyle: "Watercolor",
  promptType: "default",
  model: "default",
  version: "default",
};

let idempotencyCounter = 0;
async function insertJob(overrides: Partial<NewJob> = {}) {
  idempotencyCounter += 1;
  return jobs.insert(userId, {
    sourceId: "65f000000000000000000002",
    params: baseParams,
    idempotencyKey: `idem-${idempotencyCounter}`,
    status: "processing",
    phase: "queued",
    deadlineAt: new Date("2026-09-20T13:00:00Z"),
    ...overrides,
  });
}

function sign(timestamp: string, body: string): string {
  return createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

function makeDetails(overrides: Partial<MagicHourJobDetails> = {}): MagicHourJobDetails {
  return {
    magicHourId: "mh-x",
    status: "complete",
    name: null,
    downloads: [{ url: "https://fake.magichour.ai/mh-x/output.mp4", expiresAt: null }],
    creditsCharged: 1,
    error: null,
    ...overrides,
  };
}

function makeVideo(overrides: Partial<StoredVideo> = {}): StoredVideo {
  return {
    publicId: "sources/out",
    secureUrl: "https://res.cloudinary.com/test-cloud/video/upload/sources/out.mp4",
    format: "mp4",
    bytes: 1_000,
    duration: 5,
    width: 640,
    height: 360,
    ...overrides,
  };
}

let getJobDetails: ReturnType<typeof vi.fn<MagicHourAdapter["getJobDetails"]>>;
let copyVideoFromUrl: ReturnType<typeof vi.fn<CloudinaryAdapter["copyVideoFromUrl"]>>;

function useDeps() {
  const magicHour: MagicHourAdapter = {
    createJob: () => Promise.reject(new Error("unused")),
    getJobDetails,
    // Real crypto against the configured test secret, exactly like the real
    // adapter and the PROVIDER_MODE=fake wiring both do.
    verifyWebhook: (args) =>
      verifyWebhookSignature({
        rawBody: args.rawBody,
        signature: args.signature,
        timestamp: args.timestamp,
        secret: webhookSecret,
        nowSeconds: args.nowSeconds ?? Math.floor(Date.now() / 1000),
      }),
  };
  const providers: Providers = {
    uploadcare: { getFileInfo: () => Promise.reject(new Error("unused")) },
    cloudinary: { copyVideoFromUrl },
    magicHour,
  };
  setServerDepsForTests(buildServerDeps(testConfig, { getDb, providers }));
}

beforeEach(async () => {
  const db = await getDb();
  await db.collection("jobs").deleteMany({});
  getJobDetails = vi.fn(async () => makeDetails());
  copyVideoFromUrl = vi.fn(async () => makeVideo());
  useDeps();
});
afterEach(() => setServerDepsForTests(undefined));

function deliver(
  payload: unknown,
  opts: { timestamp?: string; signature?: string; rawBody?: string } = {},
) {
  const rawBody = opts.rawBody ?? JSON.stringify(payload);
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = opts.signature ?? sign(timestamp, rawBody);
  return POST(
    apiRequest("/api/webhook", {
      rawBody,
      headers: {
        "magic-hour-event-signature": signature,
        "magic-hour-event-timestamp": timestamp,
      },
    }),
  );
}

async function errorOf(response: Response) {
  return (await response.json()).error;
}

describe("POST /api/webhook", () => {
  it("rejects a wrong signature with 401 WEBHOOK_INVALID_SIGNATURE, and never acts on the body", async () => {
    const job = await insertJob({ magicHourId: "mh-1", phase: "queued" });
    const payload = { type: "video.started", payload: { id: "mh-1" } };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await deliver(payload, { rawBody, timestamp, signature: "0".repeat(64) });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("WEBHOOK_INVALID_SIGNATURE");
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.phase).toBe("queued");
  });

  it("rejects a stale timestamp with 401 WEBHOOK_STALE_TIMESTAMP", async () => {
    const payload = { type: "video.started", payload: { id: "mh-1" } };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const response = await deliver(payload, {
      rawBody,
      timestamp,
      signature: sign(timestamp, rawBody),
    });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("WEBHOOK_STALE_TIMESTAMP");
  });

  it("moves phase to rendering for a well-formed video.started", async () => {
    const job = await insertJob({ magicHourId: "mh-2", phase: "queued" });
    const response = await deliver({ type: "video.started", payload: { id: "mh-2" } });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.phase).toBe("rendering");
  });

  it("does not move an already-complete job backwards on a late video.started", async () => {
    const job = await insertJob({
      magicHourId: "mh-3",
      status: "complete",
      phase: "rendering",
      output: {
        cloudinaryPublicId: "sources/x",
        cloudinaryUrl: "https://res.cloudinary.com/test-cloud/video/upload/sources/x.mp4",
      },
    });
    const response = await deliver({ type: "video.started", payload: { id: "mh-3" } });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("complete");
  });

  it("marks the job failed with the provider error on video.errored", async () => {
    const job = await insertJob({ magicHourId: "mh-4" });
    const response = await deliver({
      type: "video.errored",
      payload: { id: "mh-4", error: { code: "x", message: "boom" } },
    });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored).toMatchObject({
      status: "failed",
      errorCode: "MAGIC_HOUR_JOB_FAILED",
      errorMessage: "boom",
      magicHourError: { code: "x", message: "boom" },
    });
  });

  it("finalizes the job on video.completed", async () => {
    const job = await insertJob({ magicHourId: "mh-5" });
    getJobDetails.mockResolvedValue(makeDetails({ magicHourId: "mh-5" }));
    const response = await deliver({ type: "video.completed", payload: { id: "mh-5" } });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("complete");
    expect(stored?.output).toBeDefined();
  });

  it("returns 409 when finalize reports the claim is held", async () => {
    await insertJob({
      magicHourId: "mh-6",
      status: "finalizing",
      claimedAt: new Date(),
      preFinalizeStatus: "processing",
    });
    const response = await deliver({ type: "video.completed", payload: { id: "mh-6" } });
    expect(response.status).toBe(409);
  });

  it("returns 200 for a job that already failed, instead of 409, so Magic Hour stops retrying", async () => {
    await insertJob({
      magicHourId: "mh-6b",
      status: "failed",
      errorCode: "MAGIC_HOUR_JOB_FAILED",
      errorMessage: "already failed",
    });
    const response = await deliver({ type: "video.completed", payload: { id: "mh-6b" } });
    expect(response.status).toBe(200);
  });

  it("returns 500 when finalize reports a transient condition", async () => {
    const job = await insertJob({ magicHourId: "mh-7" });
    getJobDetails.mockResolvedValue(makeDetails({ magicHourId: "mh-7", status: "rendering" }));
    const response = await deliver({ type: "video.completed", payload: { id: "mh-7" } });
    expect(response.status).toBe(500);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
  });

  it("acknowledges an unknown magicHourId with no parsable name", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await deliver({ type: "video.started", payload: { id: "does-not-exist" } });
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalled();
  });

  it("attaches magicHourId via the name fallback and proceeds", async () => {
    const job = await insertJob({ phase: "queued" });
    const name = buildJobName(job.id, "beach clip");
    const response = await deliver({ type: "video.started", payload: { id: "new-mh-id", name } });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.magicHourId).toBe("new-mh-id");
    expect(stored?.phase).toBe("rendering");
  });

  it("does not attach via the name fallback when the job already has a different id", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const job = await insertJob({ magicHourId: "existing-mh-id" });
    const name = buildJobName(job.id, "beach clip");
    const response = await deliver({
      type: "video.started",
      payload: { id: "new-id-not-used", name },
    });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.magicHourId).toBe("existing-mh-id");
    expect(log).toHaveBeenCalled();
  });

  it("acknowledges an unrecognised event type without changing the job", async () => {
    const job = await insertJob({ magicHourId: "mh-8", phase: "queued" });
    const response = await deliver({ type: "video.paused", payload: { id: "mh-8" } });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.phase).toBe("queued");
  });

  it("verifies using the exact raw bytes, even when the JSON would re-serialise differently", async () => {
    const job = await insertJob({ magicHourId: "mh-9", phase: "queued" });
    const rawBody = '{ "type": "video.started",  "payload": { "id": "mh-9" } }';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await deliver(undefined, {
      rawBody,
      timestamp,
      signature: sign(timestamp, rawBody),
    });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.phase).toBe("rendering");
  });

  it("accepts the payload under `object` as well as `payload`", async () => {
    const job = await insertJob({ magicHourId: "mh-10", phase: "queued" });
    const response = await deliver({ type: "video.started", object: { id: "mh-10" } });
    expect(response.status).toBe(200);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.phase).toBe("rendering");
  });
});
