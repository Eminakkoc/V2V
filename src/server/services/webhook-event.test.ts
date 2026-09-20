import { describe, expect, it, vi } from "vitest";
import type { TransformParams } from "@/lib/transform-contract";
import type {
  CloudinaryAdapter,
  MagicHourAdapter,
  VerifyWebhookResult,
} from "@/server/providers/types";
import type { Job, JobsRepository } from "@/server/repositories/jobs";
import { testConfig } from "@/test/env";
import { handleWebhookEvent, webhookEventSchema, type WebhookDeps } from "./webhook-event";

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

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "65f000000000000000000001",
    schemaVersion: 1,
    userId: "user-1",
    sourceId: "65f000000000000000000002",
    params: baseParams,
    idempotencyKey: "idem-1",
    status: "processing",
    phase: "queued",
    deadlineAt: new Date("2026-09-20T13:00:00Z"),
    createdAt: new Date("2026-09-20T12:00:00Z"),
    updatedAt: new Date("2026-09-20T12:00:00Z"),
    magicHourId: "mh-1",
    ...overrides,
  };
}

function makeJobsStub(overrides: Partial<JobsRepository> = {}): JobsRepository {
  return {
    insert: vi.fn(() => Promise.reject(new Error("unused"))),
    findById: vi.fn(async () => null),
    findByIdempotencyKey: vi.fn(async () => null),
    findByIdUnscoped: vi.fn(async () => null),
    findByMagicHourId: vi.fn(async () => null),
    attachMagicHourId: vi.fn(async () => null),
    claimForFinalize: vi.fn(async () => null),
    releaseClaim: vi.fn(async () => {}),
    setPhase: vi.fn(async () => null),
    markFailed: vi.fn(async () => null),
    markComplete: vi.fn(async () => null),
    markSuperseded: vi.fn(async () => null),
    setLastError: vi.fn(async () => {}),
    listForUser: vi.fn(async () => []),
    countActive: vi.fn(async () => ({
      processing: 0,
      finalizing: 0,
      timedOut: 0,
      superseded: 0,
    })),
    listChangeable: vi.fn(async () => []),
    findByIds: vi.fn(async () => []),
    countBySourceIds: vi.fn(async () => new Map()),
    selectForReconcile: vi.fn(async () => []),
    ...overrides,
  };
}

const unusedCreateJob = () => Promise.reject(new Error("unused"));
const unusedGetJobDetails = () => Promise.reject(new Error("unused"));
const unusedCopyVideoFromUrl: CloudinaryAdapter["copyVideoFromUrl"] = () =>
  Promise.reject(new Error("unused"));

function makeDeps(
  options: {
    jobs?: JobsRepository;
    verifyWebhook?: MagicHourAdapter["verifyWebhook"];
  } = {},
): WebhookDeps {
  const verify: MagicHourAdapter["verifyWebhook"] =
    options.verifyWebhook ?? (() => ({ ok: true }) satisfies VerifyWebhookResult);
  return {
    config: testConfig,
    jobs: options.jobs ?? makeJobsStub(),
    cloudinary: { copyVideoFromUrl: unusedCopyVideoFromUrl },
    magicHour: {
      createJob: unusedCreateJob,
      getJobDetails: unusedGetJobDetails,
      verifyWebhook: verify,
    },
  };
}

const headers = { signature: "sig", timestamp: "1758000000" };

describe("webhookEventSchema", () => {
  it("accepts the payload under `payload`", () => {
    const parsed = webhookEventSchema.safeParse({
      type: "video.started",
      payload: { id: "mh-1" },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ type: "video.started", payload: { id: "mh-1" } });
  });

  it("accepts the payload under `object` as well as `payload`", () => {
    const parsed = webhookEventSchema.safeParse({
      type: "video.completed",
      object: { id: "mh-2", status: "complete" },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      type: "video.completed",
      payload: { id: "mh-2", status: "complete" },
    });
  });

  it("rejects a body with neither `payload` nor `object`", () => {
    expect(webhookEventSchema.safeParse({ type: "video.started" }).success).toBe(false);
  });

  it("rejects a body missing `type`", () => {
    expect(webhookEventSchema.safeParse({ payload: { id: "mh-1" } }).success).toBe(false);
  });

  it("accepts a null, undefined, or present error object", () => {
    for (const error of [null, undefined, { code: "x", message: "boom" }]) {
      expect(
        webhookEventSchema.safeParse({ type: "video.errored", payload: { id: "mh-1", error } })
          .success,
      ).toBe(true);
    }
  });
});

describe("handleWebhookEvent", () => {
  it("throws the matching AppError when the signature is invalid, without reading the body", async () => {
    const jobs = makeJobsStub();
    const deps = makeDeps({
      jobs,
      verifyWebhook: () => ({ ok: false, code: "WEBHOOK_INVALID_SIGNATURE" }),
    });
    await expect(handleWebhookEvent("not even json", headers, deps)).rejects.toMatchObject({
      code: "WEBHOOK_INVALID_SIGNATURE",
      status: 401,
    });
    expect(jobs.findByMagicHourId).not.toHaveBeenCalled();
  });

  it("throws the matching AppError when the timestamp is stale", async () => {
    const deps = makeDeps({
      verifyWebhook: () => ({ ok: false, code: "WEBHOOK_STALE_TIMESTAMP" }),
    });
    await expect(handleWebhookEvent("{}", headers, deps)).rejects.toMatchObject({
      code: "WEBHOOK_STALE_TIMESTAMP",
      status: 401,
    });
  });

  it("acknowledges a body that fails to parse without touching the jobs repository", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = makeJobsStub();
    const deps = makeDeps({ jobs });
    const result = await handleWebhookEvent("{not json", headers, deps);
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(jobs.findByMagicHourId).not.toHaveBeenCalled();
  });

  it("acknowledges an unknown magicHourId with no parsable name", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = makeJobsStub();
    const raw = JSON.stringify({ type: "video.started", payload: { id: "unknown-id" } });
    const result = await handleWebhookEvent(raw, headers, makeDeps({ jobs }));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(jobs.attachMagicHourId).not.toHaveBeenCalled();
  });

  it("acknowledges an unrecognised event type without changing the job", async () => {
    const job = makeJob();
    const jobs = makeJobsStub({ findByMagicHourId: vi.fn(async () => job) });
    const raw = JSON.stringify({ type: "video.paused", payload: { id: job.magicHourId } });
    const result = await handleWebhookEvent(raw, headers, makeDeps({ jobs }));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(jobs.setPhase).not.toHaveBeenCalled();
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });

  it("moves a resolved job to rendering on video.started", async () => {
    const job = makeJob();
    const jobs = makeJobsStub({ findByMagicHourId: vi.fn(async () => job) });
    const raw = JSON.stringify({ type: "video.started", payload: { id: job.magicHourId } });
    const result = await handleWebhookEvent(raw, headers, makeDeps({ jobs }));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(jobs.setPhase).toHaveBeenCalledWith(job.id, "rendering");
  });

  it("marks a resolved job failed on video.errored, forwarding the provider error", async () => {
    const job = makeJob();
    const jobs = makeJobsStub({ findByMagicHourId: vi.fn(async () => job) });
    const raw = JSON.stringify({
      type: "video.errored",
      payload: { id: job.magicHourId, error: { code: "x", message: "boom" } },
    });
    const result = await handleWebhookEvent(raw, headers, makeDeps({ jobs }));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(jobs.markFailed).toHaveBeenCalledWith(job.id, {
      errorCode: "MAGIC_HOUR_JOB_FAILED",
      errorMessage: "boom",
      magicHourError: { code: "x", message: "boom" },
    });
  });
});
