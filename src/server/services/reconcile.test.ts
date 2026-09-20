import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CloudinaryAdapter,
  MagicHourAdapter,
  MagicHourJobDetails,
  StoredVideo,
} from "@/server/providers/types";
import {
  createJobsRepository,
  type Job,
  type JobsRepository,
  type NewJob,
} from "@/server/repositories/jobs";
import { testConfig } from "@/test/env";
import { setupTestDb } from "@/test/mongo";
import {
  BATCH_BUDGET_MS,
  PROVIDER_CALL_TIMEOUT_MS,
  reconcileUserJobs,
  scheduleReconciliation,
  type ReconcileDeps,
} from "./reconcile";

const { getDb } = setupTestDb();
const jobs = createJobsRepository(getDb);

const NOW = new Date("2026-09-20T12:00:00Z");
const now = () => NOW;
const HOUR_MS = 60 * 60_000;
// testConfig sets JOB_GRACE_MINUTES=120.
const GRACE_MS = testConfig.jobGraceMinutes * 60_000;

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
  deadlineAt: new Date(NOW.getTime() + HOUR_MS),
};

let idCounter = 0;
async function insertJob(overrides: Partial<NewJob> = {}): Promise<Job> {
  idCounter += 1;
  return jobs.insert("user-1", {
    ...baseInput,
    magicHourId: `mh-${idCounter}`,
    idempotencyKey: `${baseInput.idempotencyKey}-${idCounter}`,
    ...overrides,
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

const unusedCreateJob = () => Promise.reject(new Error("unused"));
const unusedVerifyWebhook = () => {
  throw new Error("unused");
};

function makeDeps(
  options: {
    getJobDetails?: ReturnType<typeof vi.fn<MagicHourAdapter["getJobDetails"]>>;
    copyVideoFromUrl?: ReturnType<typeof vi.fn<CloudinaryAdapter["copyVideoFromUrl"]>>;
  } = {},
): ReconcileDeps {
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

// Every field but lastCheckedAt, which selectForReconcile always stamps the
// moment a job is picked up -- the one write a budget-exhausted or otherwise
// inert check is still allowed to have produced.
function withoutLastCheckedAt(job: Job | null): Job | null {
  if (!job) return job;
  return { ...job, lastCheckedAt: undefined };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("reconcileUserJobs", () => {
  it("exports the documented budget constants", () => {
    expect(PROVIDER_CALL_TIMEOUT_MS).toBe(10_000);
    expect(BATCH_BUDGET_MS).toBe(45_000);
  });

  it("finalizes a job the provider reports complete", async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails({ status: "complete" }));
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails, copyVideoFromUrl }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("complete");
    expect(copyVideoFromUrl).toHaveBeenCalledTimes(1);
  });

  it('fails a job with MAGIC_HOUR_JOB_FAILED and the provider reason for status "error"', async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () =>
      makeDetails({ status: "error", error: { code: "x", message: "boom" } }),
    );
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored).toMatchObject({
      status: "failed",
      errorCode: "MAGIC_HOUR_JOB_FAILED",
      errorMessage: "boom",
      magicHourError: { code: "x", message: "boom" },
    });
  });

  it("uses finalize.ts's canonical fallback wording for an error with no provider reason", async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails({ status: "error", error: null }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.errorCode).toBe("MAGIC_HOUR_JOB_FAILED");
    expect(stored?.errorMessage).toBe("Magic Hour reported the transform failed.");
    expect(stored?.magicHourError).toBeUndefined();
  });

  it('fails a job with MAGIC_HOUR_JOB_CANCELED for status "canceled"', async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails({ status: "canceled", error: null }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.errorCode).toBe("MAGIC_HOUR_JOB_CANCELED");
  });

  it("stays processing and advances the phase to queued when within the deadline", async () => {
    const job = await insertJob({ phase: "submitting" });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "queued" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
    expect(stored?.phase).toBe("queued");
  });

  it("stays processing and advances the phase to rendering when within the deadline", async () => {
    const job = await insertJob();
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
    expect(stored?.phase).toBe("rendering");
  });

  it("times out a job past its deadline but within grace, keeping magicHourId", async () => {
    const job = await insertJob({ deadlineAt: new Date(NOW.getTime() - 30 * 60_000) });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("timed_out");
    expect(stored?.errorCode).toBe("WEBHOOK_TIMEOUT");
    expect(stored?.magicHourId).toBe(job.magicHourId);
  });

  it("abandons a job past its deadline plus grace", async () => {
    const job = await insertJob({ deadlineAt: new Date(NOW.getTime() - (GRACE_MS + HOUR_MS)) });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("abandoned");
    expect(stored?.errorCode).toBe("JOB_ABANDONED");
  });

  // The tests above use margins of 30 minutes to 5 hours, which pass whether
  // the boundary is a strict `>` or a `>=` -- they would not notice a wrong
  // comparison operator. These pin the exact boundary instead.
  it("pins the deadline edge: now === deadlineAt exactly stays processing", async () => {
    const job = await insertJob({ deadlineAt: new Date(NOW.getTime()) });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("processing");
    expect(stored?.errorCode).toBeUndefined();
  });

  it("pins the deadline edge: now === deadlineAt + 1ms times out", async () => {
    const job = await insertJob({ deadlineAt: new Date(NOW.getTime() - 1) });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("timed_out");
    expect(stored?.errorCode).toBe("WEBHOOK_TIMEOUT");
  });

  it("pins the grace edge: now === deadlineAt + graceMs exactly stays timed_out, not abandoned", async () => {
    const job = await insertJob({ deadlineAt: new Date(NOW.getTime() - GRACE_MS) });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("timed_out");
    expect(stored?.errorCode).toBe("WEBHOOK_TIMEOUT");
  });

  it("pins the grace edge: now === deadlineAt + graceMs + 1ms abandons", async () => {
    const job = await insertJob({ deadlineAt: new Date(NOW.getTime() - GRACE_MS - 1) });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("abandoned");
    expect(stored?.errorCode).toBe("JOB_ABANDONED");
  });

  it("leaves an already-abandoned job abandoned when the provider still reports rendering", async () => {
    const job = await insertJob({
      status: "abandoned",
      errorCode: "JOB_ABANDONED",
      errorMessage: "We stopped checking this job.",
      deadlineAt: new Date(NOW.getTime() - 5 * HOUR_MS),
    });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "rendering" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("abandoned");
    expect(stored?.errorMessage).toBe("We stopped checking this job.");
  });

  it("writes nothing beyond the selection stamp for a draft job", async () => {
    const job = await insertJob();
    const before = withoutLastCheckedAt(job);
    const getJobDetails = vi.fn(async () => makeDetails({ status: "draft" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(withoutLastCheckedAt(stored)).toEqual(before);
  });

  it("finalizes a finalizing job whose claim is stale but still within grace", async () => {
    const job = await insertJob({
      status: "finalizing",
      claimedAt: new Date(NOW.getTime() - 10 * 60_000),
      preFinalizeStatus: "processing",
    });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "complete" }));
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails, copyVideoFromUrl }), now);

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("complete");
    expect(copyVideoFromUrl).toHaveBeenCalledTimes(1);
  });

  it("abandons a finalizing job past deadline plus grace instead of finalizing it", async () => {
    const job = await insertJob({
      status: "finalizing",
      claimedAt: new Date(NOW.getTime() - 10 * 60_000),
      preFinalizeStatus: "processing",
      deadlineAt: new Date(NOW.getTime() - (GRACE_MS + HOUR_MS)),
    });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "complete" }));
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails, copyVideoFromUrl }), now);

    // finalizeJob was never given the chance to run: neither of its own
    // provider/Cloudinary calls happened.
    expect(getJobDetails).not.toHaveBeenCalled();
    expect(copyVideoFromUrl).not.toHaveBeenCalled();

    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("abandoned");
    expect(stored?.errorCode).toBe("JOB_ABANDONED");
  });

  it("pins the grace edge on the finalizing path: now === deadlineAt + graceMs exactly still finalizes", async () => {
    const job = await insertJob({
      status: "finalizing",
      claimedAt: new Date(NOW.getTime() - 10 * 60_000),
      preFinalizeStatus: "processing",
      deadlineAt: new Date(NOW.getTime() - GRACE_MS),
    });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "complete" }));
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails, copyVideoFromUrl }), now);

    expect(getJobDetails).toHaveBeenCalledTimes(1);
    expect(copyVideoFromUrl).toHaveBeenCalledTimes(1);
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("complete");
  });

  it("pins the grace edge on the finalizing path: now === deadlineAt + graceMs + 1ms abandons instead of finalizing", async () => {
    const job = await insertJob({
      status: "finalizing",
      claimedAt: new Date(NOW.getTime() - 10 * 60_000),
      preFinalizeStatus: "processing",
      deadlineAt: new Date(NOW.getTime() - GRACE_MS - 1),
    });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "complete" }));
    const copyVideoFromUrl = vi.fn(async () => makeVideo());
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails, copyVideoFromUrl }), now);

    // finalizeJob was never given the chance to run.
    expect(getJobDetails).not.toHaveBeenCalled();
    expect(copyVideoFromUrl).not.toHaveBeenCalled();
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("abandoned");
    expect(stored?.errorCode).toBe("JOB_ABANDONED");
  });

  it("re-reads now() at the finalizing grace check instead of using a value memoized at entry", async () => {
    // deadlineAt sits exactly at NOW -- the selection-time clock value -- so
    // this can only come out abandoned if the grace check re-reads the clock
    // afterwards and sees it has moved past deadlineAt + graceMs. A `const t
    // = now()` memoized once at reconcileOne's entry (or reused from
    // reconcileUserJobs' own startedAt) would still hold NOW, which is not
    // past deadlineAt(NOW) + graceMs, so the job would be wrongly finalized
    // instead of abandoned.
    const job = await insertJob({
      status: "finalizing",
      claimedAt: new Date(NOW.getTime() - 10 * 60_000),
      preFinalizeStatus: "processing",
      deadlineAt: new Date(NOW.getTime()),
    });
    const getJobDetails = vi.fn(async () => makeDetails({ status: "complete" }));
    const copyVideoFromUrl = vi.fn(async () => makeVideo());

    // First call is reconcileUserJobs' own startedAt/selection stamp; every
    // call after that -- reconcileOne's own grace check among them -- reports
    // a time already past deadlineAt + graceMs.
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(NOW)
      .mockReturnValue(new Date(NOW.getTime() + GRACE_MS + 1));

    await reconcileUserJobs("user-1", makeDeps({ getJobDetails, copyVideoFromUrl }), clock);

    expect(getJobDetails).not.toHaveBeenCalled();
    expect(copyVideoFromUrl).not.toHaveBeenCalled();
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(stored?.status).toBe("abandoned");
    expect(stored?.errorCode).toBe("JOB_ABANDONED");
  });

  it("writes nothing and never releases a claim when the provider call exceeds its budget", async () => {
    const job = await insertJob();
    const before = withoutLastCheckedAt(job);
    const releaseClaim = vi.spyOn(jobs, "releaseClaim");
    // Never settles: the provider adapter exposes no abort signal, so a call
    // that loses the race is still "running" from this module's point of
    // view for the rest of the test.
    const getJobDetails = vi.fn(() => new Promise<MagicHourJobDetails>(() => {}));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Real timers throughout -- only the clock is rigged, giving the
    // per-job budget check ~20ms of real, positive budget (still the
    // PROVIDER_CALL_TIMEOUT_MS-vs-remaining race in withBudget, just with a
    // short enough remaining time that the test does not have to wait out
    // the real 10s constant). Mixing mongodb-memory-server's real socket I/O
    // with vi's fake timers is what actually hangs here, not the assertion
    // this test cares about.
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(NOW)
      .mockReturnValue(new Date(NOW.getTime() + BATCH_BUDGET_MS - 20));

    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), clock);

    expect(releaseClaim).not.toHaveBeenCalled();
    const stored = await jobs.findByIdUnscoped(job.id);
    expect(withoutLastCheckedAt(stored)).toEqual(before);
  });

  it("lets the other four jobs complete when one throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingId = "mh-throws";
    const okJobs = await Promise.all(
      [1, 2, 3, 4].map(() => insertJob({ magicHourId: `mh-ok-${idCounter}`, phase: "submitting" })),
    );
    const throwingJob = await insertJob({ magicHourId: throwingId, phase: "submitting" });

    const getJobDetails = vi.fn(async (magicHourId: string) => {
      if (magicHourId === throwingId) throw new Error("provider blew up");
      return makeDetails({ status: "queued", magicHourId });
    });

    await expect(
      reconcileUserJobs("user-1", makeDeps({ getJobDetails }), now),
    ).resolves.toBeUndefined();

    for (const okJob of okJobs) {
      const stored = await jobs.findByIdUnscoped(okJob.id);
      expect(stored?.status).toBe("processing");
      expect(stored?.phase).toBe("queued");
    }

    const before = withoutLastCheckedAt(throwingJob);
    const storedThrowing = await jobs.findByIdUnscoped(throwingJob.id);
    expect(withoutLastCheckedAt(storedThrowing)).toEqual(before);
  });

  it("skips remaining jobs and writes nothing once the batch budget is already spent", async () => {
    const jobA = await insertJob();
    const jobB = await insertJob();
    const beforeA = withoutLastCheckedAt(jobA);
    const beforeB = withoutLastCheckedAt(jobB);

    // First call is reconcileUserJobs' own startedAt; every later call (one
    // per selected job's own budget check) reports a time already past the
    // batch deadline, so each job's remaining budget is <= 0 by the time its
    // own check begins.
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(NOW)
      .mockReturnValue(new Date(NOW.getTime() + BATCH_BUDGET_MS + 1_000));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const getJobDetails = vi.fn(async () => makeDetails({ status: "queued" }));
    await reconcileUserJobs("user-1", makeDeps({ getJobDetails }), clock);

    const storedA = await jobs.findByIdUnscoped(jobA.id);
    const storedB = await jobs.findByIdUnscoped(jobB.id);
    expect(withoutLastCheckedAt(storedA)).toEqual(beforeA);
    expect(withoutLastCheckedAt(storedB)).toEqual(beforeB);
  });
});

describe("scheduleReconciliation", () => {
  it("resolves without rejecting when a dependency throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingJobs: JobsRepository = {
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
      selectForReconcile: vi.fn(() => {
        throw new Error("selectForReconcile boom");
      }),
      markTimedOut: vi.fn(async () => null),
      markAbandoned: vi.fn(async () => null),
      markFailedFromCheck: vi.fn(async () => null),
    };
    const deps = makeDeps();
    await expect(
      scheduleReconciliation("user-1", { ...deps, jobs: throwingJobs }, now),
    ).resolves.toBeUndefined();
  });
});
