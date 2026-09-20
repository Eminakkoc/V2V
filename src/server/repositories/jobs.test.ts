import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { setupTestDb } from "@/test/mongo";
import { createJobsRepository, type NewJob } from "./jobs";

const { getDb } = setupTestDb();
const jobs = createJobsRepository(getDb);

// setupTestDb() is one db for the whole file; without this, every test's
// inserts (many sharing input's idempotencyKey and "user-1") would pile up
// and corrupt the count/lookup assertions below.
beforeEach(async () => {
  await (await getDb()).collection("jobs").deleteMany({});
});

const input: NewJob = {
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
  phase: "submitting",
  deadlineAt: new Date("2026-09-19T12:00:00Z"),
};

describe("jobs repository", () => {
  it("creates a job with only the always-present fields", async () => {
    const created = await jobs.insert("user-1", input);
    const raw = await (await getDb()).collection("jobs").findOne({ _id: new ObjectId(created.id) });
    expect(raw).not.toBeNull();
    expect(raw).not.toHaveProperty("magicHourId");
    expect(raw).not.toHaveProperty("completedAt");
    expect(created.createdAt).toEqual(created.updatedAt);
    expect(await jobs.findById("user-1", created.id)).toEqual(created);
  });

  it("rejects null for optional fields", async () => {
    const attempt = jobs.insert("user-1", { ...input, magicHourId: null } as unknown as NewJob);
    await expect(attempt).rejects.toThrow(/Invalid jobs document on write/);
    // Not a ZodError: our own bad write must become a logged 500, not a 400.
    await expect(attempt).rejects.not.toBeInstanceOf(ZodError);
  });

  it("rejects an unknown status", async () => {
    await expect(
      jobs.insert("user-1", { ...input, status: "done" } as unknown as NewJob),
    ).rejects.toThrow(/Invalid jobs document on write/);
  });

  it("scopes reads by user", async () => {
    const created = await jobs.insert("user-1", input);
    expect(await jobs.findById("user-2", created.id)).toBeNull();
  });
});

describe("idempotency", () => {
  it("finds a job by its idempotency key, scoped to the user", async () => {
    const created = await jobs.insert("user-1", input);
    expect(await jobs.findByIdempotencyKey("user-1", input.idempotencyKey)).toEqual(created);
    expect(await jobs.findByIdempotencyKey("user-2", input.idempotencyKey)).toBeNull();
  });
});

describe("attachMagicHourId", () => {
  it("attaches when the job has no Magic Hour id yet", async () => {
    const created = await jobs.insert("user-1", input);
    const attached = await jobs.attachMagicHourId(created.id, "mh-1");
    expect(attached?.magicHourId).toBe("mh-1");
    expect(await jobs.findByMagicHourId("mh-1")).toEqual(attached);
  });

  it("refuses to overwrite an existing Magic Hour id", async () => {
    const created = await jobs.insert("user-1", { ...input, magicHourId: "mh-first" });
    // Two deliveries racing on the name fallback must not both claim the job.
    expect(await jobs.attachMagicHourId(created.id, "mh-second")).toBeNull();
    expect((await jobs.findByIdUnscoped(created.id))?.magicHourId).toBe("mh-first");
  });
});

describe("claimForFinalize", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const staleBefore = new Date("2026-09-20T11:55:00Z");

  it.each(["processing", "timed_out", "superseded", "abandoned"] as const)(
    "claims a %s job and marks it finalizing",
    async (status) => {
      const created = await jobs.insert("user-1", { ...input, status });
      const claimed = await jobs.claimForFinalize(created.id, now, staleBefore);
      expect(claimed?.status).toBe("finalizing");
      expect(claimed?.claimedAt).toEqual(now);
    },
  );

  it("refuses a job someone else is already finalizing", async () => {
    const created = await jobs.insert("user-1", {
      ...input,
      status: "finalizing",
      claimedAt: new Date("2026-09-20T11:59:00Z"),
    });
    expect(await jobs.claimForFinalize(created.id, now, staleBefore)).toBeNull();
  });

  it("reclaims a finalizing job whose claim went stale", async () => {
    const created = await jobs.insert("user-1", {
      ...input,
      status: "finalizing",
      claimedAt: new Date("2026-09-20T11:50:00Z"),
    });
    expect((await jobs.claimForFinalize(created.id, now, staleBefore))?.claimedAt).toEqual(now);
  });

  it("refuses an already complete job", async () => {
    const created = await jobs.insert("user-1", { ...input, status: "complete" });
    expect(await jobs.claimForFinalize(created.id, now, staleBefore)).toBeNull();
  });

  it("lets only one of two concurrent claims win", async () => {
    const created = await jobs.insert("user-1", input);
    const results = await Promise.all([
      jobs.claimForFinalize(created.id, now, staleBefore),
      jobs.claimForFinalize(created.id, now, staleBefore),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("records the status it replaced, and restores it on release", async () => {
    const created = await jobs.insert("user-1", { ...input, status: "timed_out" });
    const claimed = await jobs.claimForFinalize(created.id, now, staleBefore);
    expect(claimed?.preFinalizeStatus).toBe("timed_out");
    await jobs.releaseClaim(created.id);
    const after = await jobs.findByIdUnscoped(created.id);
    // A timed-out job must come back timed_out, not processing.
    expect(after?.status).toBe("timed_out");
    expect(after?.claimedAt).toBeUndefined();
    expect(after?.preFinalizeStatus).toBeUndefined();
  });

  it("keeps the original pre-claim status when reclaiming a stale finalizing job", async () => {
    const created = await jobs.insert("user-1", {
      ...input,
      status: "finalizing",
      claimedAt: new Date("2026-09-20T11:50:00Z"),
      preFinalizeStatus: "abandoned",
    });
    const reclaimed = await jobs.claimForFinalize(created.id, now, staleBefore);
    // Re-claiming must not record "finalizing" as the thing to restore.
    expect(reclaimed?.preFinalizeStatus).toBe("abandoned");
  });
});

describe("markFailed", () => {
  it("refuses to fail a job that already completed", async () => {
    const created = await jobs.insert("user-1", { ...input, status: "complete" });
    // Magic Hour redelivers for up to 24h, so a late video.errored for an
    // already-finalized job is expected — it must not destroy a stored result.
    expect(
      await jobs.markFailed(created.id, {
        errorCode: "MAGIC_HOUR_JOB_FAILED",
        errorMessage: "late failure",
      }),
    ).toBeNull();
    expect((await jobs.findByIdUnscoped(created.id))?.status).toBe("complete");
  });
});

describe("markSuperseded", () => {
  it.each(["failed", "timed_out", "abandoned"] as const)("supersedes a %s job", async (status) => {
    const created = await jobs.insert("user-1", { ...input, status });
    const superseded = await jobs.markSuperseded(created.id, "new-job-id");
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.supersededByJobId).toBe("new-job-id");
  });

  it("refuses to supersede a complete job, keeping its output visible", async () => {
    const created = await jobs.insert("user-1", { ...input, status: "processing" });
    const completed = await jobs.markComplete(created.id, {
      output: { cloudinaryPublicId: "sources/abc", cloudinaryUrl: "https://example.com/abc.mp4" },
    });
    expect(completed?.status).toBe("complete");

    // A retry naming a completed job's id must not be able to hide a render
    // the user already paid for.
    expect(await jobs.markSuperseded(created.id, "new-job-id")).toBeNull();
    const after = await jobs.findByIdUnscoped(created.id);
    expect(after?.status).toBe("complete");
    expect(after?.output).toEqual(completed?.output);
    expect(after?.supersededByJobId).toBeUndefined();
  });

  it.each(["processing", "finalizing"] as const)(
    "refuses to supersede a %s job that is still in flight",
    async (status) => {
      const created = await jobs.insert("user-1", { ...input, status });
      expect(await jobs.markSuperseded(created.id, "new-job-id")).toBeNull();
      expect((await jobs.findByIdUnscoped(created.id))?.status).toBe(status);
    },
  );
});

describe("setPhase", () => {
  it("advances phase forward", async () => {
    const created = await jobs.insert("user-1", { ...input, phase: "submitting" });
    const updated = await jobs.setPhase(created.id, "queued");
    expect(updated?.phase).toBe("queued");
  });

  it("refuses to move phase backwards", async () => {
    const created = await jobs.insert("user-1", { ...input, phase: "rendering" });
    // e.g. the create call's own "queued" write losing a race against a
    // video.started webhook that already advanced the job to "rendering".
    expect(await jobs.setPhase(created.id, "queued")).toBeNull();
    expect((await jobs.findByIdUnscoped(created.id))?.phase).toBe("rendering");
  });

  it("allows setting the same phase again", async () => {
    const created = await jobs.insert("user-1", { ...input, phase: "queued" });
    const updated = await jobs.setPhase(created.id, "queued");
    expect(updated?.phase).toBe("queued");
  });
});

describe("listForUser", () => {
  it("excludes superseded jobs unless asked for", async () => {
    await jobs.insert("user-1", input);
    await jobs.insert("user-1", { ...input, idempotencyKey: "k2", status: "superseded" });
    const base = { includePrevious: false, dir: "desc" as const, limit: 20 };
    expect(await jobs.listForUser("user-1", base)).toHaveLength(1);
    expect(await jobs.listForUser("user-1", { ...base, includePrevious: true })).toHaveLength(2);
  });

  it("paginates newest first on a (createdAt, id) cursor", async () => {
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      made.push(await jobs.insert("user-1", { ...input, idempotencyKey: `key-${i}` }));
    }
    const base = { includePrevious: true, dir: "desc" as const, limit: 2 };
    const first = await jobs.listForUser("user-1", base);
    expect(first).toHaveLength(2);
    const last = first[1]!;
    const second = await jobs.listForUser("user-1", {
      ...base,
      cursor: { createdAt: last.createdAt, id: last.id },
    });
    expect(second.map((j) => j.id)).not.toContain(first[0]!.id);
  });
});

describe("countActive", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const graceMs = 60 * 60_000; // 1 hour

  it("counts each active status separately, within the grace window", async () => {
    await jobs.insert("user-1", input);
    await jobs.insert("user-1", { ...input, idempotencyKey: "k2", status: "finalizing" });
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: "k3",
      status: "timed_out",
      deadlineAt: new Date("2026-09-20T11:30:00Z"),
    });
    await jobs.insert("user-1", { ...input, idempotencyKey: "k4", status: "complete" });
    await jobs.insert("user-2", { ...input, idempotencyKey: "k5" });
    expect(await jobs.countActive("user-1", now, graceMs)).toEqual({
      processing: 1,
      finalizing: 1,
      timedOut: 1,
      superseded: 0,
    });
  });

  it("stops counting a superseded job once its deadline plus the grace window has passed", async () => {
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: "k6",
      status: "superseded",
      // Well past deadlineAt + graceMs relative to `now`: no further Magic
      // Hour delivery is plausible, so this must no longer drive polling.
      deadlineAt: new Date("2026-09-20T01:00:00Z"),
    });
    expect(await jobs.countActive("user-1", now, graceMs)).toEqual({
      processing: 0,
      finalizing: 0,
      timedOut: 0,
      superseded: 0,
    });
  });

  it("still counts a superseded job whose deadline plus grace window has not yet passed", async () => {
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: "k7",
      status: "superseded",
      deadlineAt: new Date("2026-09-20T11:30:00Z"),
    });
    expect((await jobs.countActive("user-1", now, graceMs)).superseded).toBe(1);
  });
});
