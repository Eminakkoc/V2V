import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors/app-error";
import type {
  CloudinaryAdapter,
  MagicHourAdapter,
  MagicHourJobDetails,
  StoredVideo,
} from "@/server/providers/types";
import { createJobsRepository, type NewJob } from "@/server/repositories/jobs";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import {
  FINALIZE_COPY_BUDGET_MS,
  finalizeJob,
  STALE_CLAIM_MS,
  type FinalizeDeps,
} from "./finalize";

const { getDb } = setupTestDb();
const jobs = createJobsRepository(getDb);

const now = () => new Date("2026-09-20T12:00:00Z");

const baseInput: NewJob = {
  sourceId: "65f000000000000000000001",
  idempotencyKey: "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a",
  params: {
    name: "beach clip",
    startSeconds: 0,
    endSeconds: 5.25,
    fpsResolution: "HALF",
    artStyle: "Watercolor",
    promptType: "default",
    model: "default",
    version: "default",
  },
  status: "processing",
  phase: "rendering",
  deadlineAt: new Date("2026-09-20T13:00:00Z"),
};

let idempotencyCounter = 0;
async function insertJob(overrides: Partial<NewJob> = {}) {
  idempotencyCounter += 1;
  return jobs.insert("user-1", {
    ...baseInput,
    magicHourId: "mh-1",
    idempotencyKey: `${baseInput.idempotencyKey}-${idempotencyCounter}`,
    ...overrides,
  });
}

// A separate helper (rather than insertJob({ magicHourId: undefined })) since an
// explicit undefined override is ambiguous about whether the field is absent.
async function insertJobWithoutMagicHourId() {
  idempotencyCounter += 1;
  return jobs.insert("user-1", {
    ...baseInput,
    idempotencyKey: `${baseInput.idempotencyKey}-${idempotencyCounter}`,
  });
}

function makeDetails(overrides: Partial<MagicHourJobDetails> = {}): MagicHourJobDetails {
  return {
    magicHourId: "mh-1",
    status: "complete",
    name: null,
    downloads: [{ url: "https://fake.magichour.ai/mh-1/output.mp4", expiresAt: null }],
    creditsCharged: 3,
    error: null,
    ...overrides,
  };
}

function makeVideo(overrides: Partial<StoredVideo> = {}): StoredVideo {
  return {
    publicId: "sources/abc",
    secureUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mp4",
    format: "mp4",
    bytes: 1_000,
    duration: 5,
    width: 640,
    height: 360,
    ...overrides,
  };
}

// The unused half of MagicHourAdapter for tests that never touch it.
const unusedCreateJob = () => Promise.reject(new Error("unused"));
const unusedVerifyWebhook = () => {
  throw new Error("unused");
};

function makeDeps(
  options: {
    getJobDetails?: ReturnType<typeof vi.fn<MagicHourAdapter["getJobDetails"]>>;
    copyVideoFromUrl?: ReturnType<typeof vi.fn<CloudinaryAdapter["copyVideoFromUrl"]>>;
  } = {},
): FinalizeDeps {
  return {
    config: testConfig,
    jobs,
    cloudinary: {
      copyVideoFromUrl: options.copyVideoFromUrl ?? vi.fn(async () => makeVideo()),
    },
    magicHour: {
      createJob: unusedCreateJob,
      getJobDetails: options.getJobDetails ?? vi.fn(async () => makeDetails()),
      verifyWebhook: unusedVerifyWebhook,
    },
  };
}

describe("finalizeJob", () => {
  it("claims, fetches details, copies to Cloudinary, and marks the job complete", async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails());
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const deps = makeDeps({ getJobDetails, copyVideoFromUrl });

    const outcome = await finalizeJob(job.id, deps, now);

    expect(outcome).toMatchObject({
      kind: "completed",
      job: {
        status: "complete",
        creditsCharged: 3,
        output: {
          cloudinaryPublicId: "sources/abc",
          cloudinaryUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mp4",
        },
      },
    });
    if (outcome.kind === "completed") {
      // markComplete stamps completedAt with its own real clock, not the
      // injected `now` — only finalizeJob's own timing (the claim, the
      // Cloudinary deadline) is driven by the injected clock.
      expect(outcome.job.completedAt).toBeInstanceOf(Date);
      expect(outcome.job.claimedAt).toBeUndefined();
    }
    expect(copyVideoFromUrl).toHaveBeenCalledWith("https://fake.magichour.ai/mh-1/output.mp4", {
      deadline: now().getTime() + FINALIZE_COPY_BUDGET_MS,
      // WHK-005: a render is a result, never filed with the user's uploads.
      folder: "results",
      treatSanityFailureAsRetryable: true,
    });

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("complete");
    expect(stored?.claimedAt).toBeUndefined();
    expect(stored?.preFinalizeStatus).toBeUndefined();
  });

  it("fetches details itself instead of trusting the caller", async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails());
    // The caller may already know the video.completed event fired; finalizeJob
    // still has no way to receive that, and must call the provider itself.
    await finalizeJob(job.id, makeDeps({ getJobDetails }), now);
    expect(getJobDetails).toHaveBeenCalledTimes(1);
    expect(getJobDetails).toHaveBeenCalledWith("mh-1");
  });

  it("returns already-complete for a job that already completed, and never calls Cloudinary", async () => {
    const job = await insertJob({ status: "complete" });
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const outcome = await finalizeJob(job.id, makeDeps({ copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "already-complete" });
    expect(copyVideoFromUrl).not.toHaveBeenCalled();
  });

  it("returns claim-held for a job someone else is actively finalizing", async () => {
    const job = await insertJob({
      status: "finalizing",
      claimedAt: new Date("2026-09-20T11:59:00Z"),
      preFinalizeStatus: "processing",
    });
    const outcome = await finalizeJob(job.id, makeDeps(), now);
    expect(outcome).toEqual({ kind: "claim-held" });
  });

  it("returns already-terminal for a job that already failed, not claim-held", async () => {
    const job = await insertJob({ status: "failed" });
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const outcome = await finalizeJob(job.id, makeDeps({ copyVideoFromUrl }), now);
    // Distinct from claim-held: a failed job will never become claimable
    // again, so the webhook route must acknowledge (200) instead of asking
    // Magic Hour to keep retrying (409).
    expect(outcome).toEqual({ kind: "already-terminal" });
    expect(copyVideoFromUrl).not.toHaveBeenCalled();
  });

  it("reclaims a finalizing job whose claim is older than STALE_CLAIM_MS", async () => {
    const staleClaimedAt = new Date(now().getTime() - STALE_CLAIM_MS - 1_000);
    const job = await insertJob({
      status: "finalizing",
      claimedAt: staleClaimedAt,
      preFinalizeStatus: "processing",
    });
    const outcome = await finalizeJob(job.id, makeDeps(), now);
    expect(outcome.kind).toBe("completed");
  });

  it.each(["superseded", "abandoned"] as const)(
    "claims and finalizes a %s job (a late result is still saved)",
    async (status) => {
      const job = await insertJob({ status });
      const outcome = await finalizeJob(job.id, makeDeps(), now);
      expect(outcome.kind).toBe("completed");
    },
  );

  it("releases the claim and returns transient on a transient Cloudinary failure, leaving the job claimable again", async () => {
    const job = await insertJob();
    const copyVideoFromUrl = vi.fn(async () => {
      throw new AppError("CLOUDINARY_UPLOAD_FAILED", { retryable: true });
    });
    const outcome = await finalizeJob(job.id, makeDeps({ copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "transient" });

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
    expect(stored?.claimedAt).toBeUndefined();

    const reclaimed = await jobs.claimForFinalize(
      job.id,
      now(),
      new Date(now().getTime() - STALE_CLAIM_MS),
    );
    expect(reclaimed).not.toBeNull();
  });

  it("requests sanity failures as retryable, since this is a paid render, not a user upload", async () => {
    const job = await insertJob();
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    await finalizeJob(job.id, makeDeps({ copyVideoFromUrl }), now);
    expect(copyVideoFromUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ treatSanityFailureAsRetryable: true }),
    );
  });

  it("releases the claim and returns transient on a Cloudinary sanity failure, never marking the job failed", async () => {
    const job = await insertJob();
    // What copyVideoFromUrl throws once treatSanityFailureAsRetryable is honoured
    // (see cloudinary.test.ts): a sanity failure, but retryable.
    const copyVideoFromUrl = vi.fn(async () => {
      throw new AppError("CLOUDINARY_UPLOAD_FAILED", {
        retryable: true,
        details: { reason: "missing-duration" },
      });
    });
    const outcome = await finalizeJob(job.id, makeDeps({ copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "transient" });

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
    expect(stored?.claimedAt).toBeUndefined();
  });

  it("marks the job failed on a permanent Cloudinary failure and does not leave it finalizing", async () => {
    const copyVideoFromUrl = vi.fn(async () => {
      throw new AppError("CLOUDINARY_UPLOAD_FAILED", { retryable: false });
    });
    const job = await insertJob();
    const outcome = await finalizeJob(job.id, makeDeps({ copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "failed", errorCode: "CLOUDINARY_UPLOAD_FAILED" });

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.claimedAt).toBeUndefined();
  });

  it('marks the job failed with MAGIC_HOUR_JOB_FAILED for status "error", and never copies', async () => {
    const job = await insertJob();
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const getJobDetails = vi.fn(async () =>
      makeDetails({ status: "error", error: { code: "x", message: "boom" } }),
    );
    const outcome = await finalizeJob(job.id, makeDeps({ getJobDetails, copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "failed", errorCode: "MAGIC_HOUR_JOB_FAILED" });
    expect(copyVideoFromUrl).not.toHaveBeenCalled();

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored).toMatchObject({
      status: "failed",
      errorCode: "MAGIC_HOUR_JOB_FAILED",
      errorMessage: "boom",
      magicHourError: { code: "x", message: "boom" },
    });
  });

  it('marks the job failed with MAGIC_HOUR_JOB_CANCELED for status "canceled"', async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails({ status: "canceled", error: null }));
    const outcome = await finalizeJob(job.id, makeDeps({ getJobDetails }), now);
    expect(outcome).toEqual({ kind: "failed", errorCode: "MAGIC_HOUR_JOB_CANCELED" });
  });

  it("releases the claim and returns transient when downloads is empty", async () => {
    const job = await insertJob();
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const getJobDetails = vi.fn(async () => makeDetails({ downloads: [] }));
    const outcome = await finalizeJob(job.id, makeDeps({ getJobDetails, copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "transient" });
    expect(copyVideoFromUrl).not.toHaveBeenCalled();

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
  });

  it("releases the claim and returns transient when the job still has no magicHourId", async () => {
    const job = await insertJobWithoutMagicHourId();
    const getJobDetails = vi.fn(async () => makeDetails());
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const outcome = await finalizeJob(job.id, makeDeps({ getJobDetails, copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "transient" });
    expect(getJobDetails).not.toHaveBeenCalled();
    expect(copyVideoFromUrl).not.toHaveBeenCalled();

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
  });

  it("releases the claim and returns transient when the provider still reports progress", async () => {
    const job = await insertJob();
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    const outcome = await finalizeJob(job.id, makeDeps({ getJobDetails, copyVideoFromUrl }), now);
    expect(outcome).toEqual({ kind: "transient" });
    expect(copyVideoFromUrl).not.toHaveBeenCalled();
  });

  it("releases the claim and rethrows when an unexpected error escapes the store step", async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => {
      throw new Error("unexpected provider blowup");
    });
    await expect(finalizeJob(job.id, makeDeps({ getJobDetails }), now)).rejects.toThrow(
      "unexpected provider blowup",
    );

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
    expect(stored?.claimedAt).toBeUndefined();
  });

  it("lets only one of two concurrent finalizeJob calls complete, and calls Cloudinary exactly once", async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails());
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    const deps = makeDeps({ getJobDetails, copyVideoFromUrl });

    const [first, second] = await Promise.all([
      finalizeJob(job.id, deps, now),
      finalizeJob(job.id, deps, now),
    ]);

    const kinds = [first.kind, second.kind];
    // Exactly one caller wins the claim and completes the job. The loser's
    // exact outcome is a timing race between its own findByIdUnscoped read
    // and the winner's markComplete write, both settling from an in-flight
    // "finalizing" state — "claim-held" if it reads first, "already-complete"
    // if the winner finishes first. Either is safe: neither touches Cloudinary.
    expect(kinds.filter((kind) => kind === "completed")).toHaveLength(1);
    expect(
      kinds.filter((kind) => kind === "claim-held" || kind === "already-complete"),
    ).toHaveLength(1);
    expect(copyVideoFromUrl).toHaveBeenCalledTimes(1);
  });
});
