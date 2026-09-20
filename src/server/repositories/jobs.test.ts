import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { JOB_STATUSES } from "@/lib/job-status";
import { clipSecondsOf } from "@/server/services/history-cursor";
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

describe("listForUser sorting and filtering", () => {
  async function seed() {
    const short = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      params: { ...input.params, startSeconds: 0, endSeconds: 2 },
    });
    const long = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      params: { ...input.params, startSeconds: 0, endSeconds: 20 },
    });
    const medium = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      params: { ...input.params, startSeconds: 0, endSeconds: 9 },
    });
    return { short, medium, long };
  }

  it("orders by clip duration, longest first", async () => {
    const { short, medium, long } = await seed();
    const rows = await jobs.listForUser("user-1", {
      includePrevious: false,
      sort: "duration",
      dir: "desc",
      limit: 10,
    });
    expect(rows.map((row) => row.id)).toEqual([long.id, medium.id, short.id]);
  });

  it("orders by clip duration, shortest first", async () => {
    const { short, medium, long } = await seed();
    const rows = await jobs.listForUser("user-1", {
      includePrevious: false,
      sort: "duration",
      dir: "asc",
      limit: 10,
    });
    expect(rows.map((row) => row.id)).toEqual([short.id, medium.id, long.id]);
  });

  it("paginates the duration sort through its own cursor tuple", async () => {
    const { short, medium, long } = await seed();
    const firstPage = await jobs.listForUser("user-1", {
      includePrevious: false,
      sort: "duration",
      dir: "desc",
      limit: 1,
    });
    expect(firstPage.map((row) => row.id)).toEqual([long.id]);

    const rest = await jobs.listForUser("user-1", {
      includePrevious: false,
      sort: "duration",
      dir: "desc",
      limit: 10,
      cursor: { clipSeconds: 20, createdAt: long.createdAt, id: long.id },
    });
    expect(rest.map((row) => row.id)).toEqual([medium.id, short.id]);
  });

  // The cursor value is computed in JS (clipSecondsOf, the same helper the
  // history service uses to encode a duration cursor) but the sort and
  // boundary comparison run in Mongo's $round, so the two must agree on
  // ordinary two-decimal lengths or a page boundary silently repeats or skips
  // a row. This does not exercise a genuine JS-vs-Mongo half-rounding tie:
  // $round(x, 2) only ties when the third decimal is exactly 5, and since
  // both startSeconds and endSeconds are constrained to two decimals, their
  // difference is always two decimals too, so a third-decimal tie cannot
  // arise here by construction. Paging one row at a time is what would make
  // any agreement gap visible regardless: a mismatch either re-returns the
  // previous row or jumps past the next one.
  it("keeps a JS-computed duration cursor in step with Mongo's $round when paging one row at a time", async () => {
    const hi = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      params: { ...input.params, startSeconds: 0, endSeconds: 5.3 },
    });
    const mid = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      params: { ...input.params, startSeconds: 0, endSeconds: 5.25 },
    });
    const lo = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      params: { ...input.params, startSeconds: 0, endSeconds: 5.05 },
    });
    const expectedOrder = [hi.id, mid.id, lo.id];

    const seen: string[] = [];
    let cursor: { clipSeconds: number; createdAt: Date; id: string } | undefined;
    for (let i = 0; i < expectedOrder.length; i += 1) {
      const page = await jobs.listForUser("user-1", {
        includePrevious: false,
        sort: "duration",
        dir: "desc",
        limit: 1,
        cursor,
      });
      expect(page).toHaveLength(1);
      const row = page[0]!;
      seen.push(row.id);
      cursor = { clipSeconds: clipSecondsOf(row.params), createdAt: row.createdAt, id: row.id };
    }

    expect(seen).toEqual(expectedOrder);
    expect(new Set(seen).size).toBe(expectedOrder.length);

    // Paging once more past the last row must come back empty, not repeat it.
    const trailing = await jobs.listForUser("user-1", {
      includePrevious: false,
      sort: "duration",
      dir: "desc",
      limit: 10,
      cursor,
    });
    expect(trailing).toEqual([]);
  });

  it("filters by a set of statuses", async () => {
    const processing = await jobs.insert("user-1", { ...input, idempotencyKey: randomUUID() });
    const done = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "complete",
    });
    const abandoned = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "abandoned",
    });

    const rows = await jobs.listForUser("user-1", {
      statuses: ["failed", "abandoned"],
      includePrevious: false,
      sort: "createdAt",
      dir: "desc",
      limit: 10,
    });
    expect(rows.map((row) => row.id)).toEqual([abandoned.id]);
    expect(rows.map((row) => row.id)).not.toContain(processing.id);
    expect(rows.map((row) => row.id)).not.toContain(done.id);
  });

  it("still excludes superseded rows by default under the duration sort", async () => {
    const kept = await jobs.insert("user-1", { ...input, idempotencyKey: randomUUID() });
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "superseded",
    });
    const rows = await jobs.listForUser("user-1", {
      includePrevious: false,
      sort: "duration",
      dir: "desc",
      limit: 10,
    });
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it("never returns another user's rows under either sort", async () => {
    await jobs.insert("user-2", { ...input, idempotencyKey: randomUUID() });
    for (const sort of ["createdAt", "duration"] as const) {
      const rows = await jobs.listForUser("user-1", {
        includePrevious: false,
        sort,
        dir: "desc",
        limit: 10,
      });
      expect(rows).toEqual([]);
    }
  });
});

describe("changeable, id lookup and source counts", () => {
  it("returns exactly the statuses reconciliation can select", async () => {
    const ids: Record<string, string> = {};
    for (const status of JOB_STATUSES) {
      const created = await jobs.insert("user-1", {
        ...input,
        idempotencyKey: randomUUID(),
        status,
      });
      ids[status] = created.id;
    }
    const rows = await jobs.listChangeable("user-1");
    expect(rows.map((row) => row.status).sort()).toEqual(
      ["abandoned", "finalizing", "processing", "superseded", "timed_out"].sort(),
    );
    expect(rows.map((row) => row.id)).not.toContain(ids.complete);
    expect(rows.map((row) => row.id)).not.toContain(ids.failed);
  });

  it("never returns another user's changeable rows", async () => {
    await jobs.insert("user-2", { ...input, idempotencyKey: randomUUID() });
    expect(await jobs.listChangeable("user-1")).toEqual([]);
  });

  it("looks jobs up by id, omitting unknown and other users' ids", async () => {
    const mine = await jobs.insert("user-1", { ...input, idempotencyKey: randomUUID() });
    const theirs = await jobs.insert("user-2", { ...input, idempotencyKey: randomUUID() });
    const rows = await jobs.findByIds("user-1", [
      mine.id,
      theirs.id,
      "65f0000000000000000000ff",
      "not-an-object-id",
    ]);
    expect(rows.map((row) => row.id)).toEqual([mine.id]);
  });

  it("returns an empty array for an empty id list", async () => {
    expect(await jobs.findByIds("user-1", [])).toEqual([]);
  });

  it("counts every job per source regardless of status, retries included", async () => {
    const sourceA = "65f0000000000000000000a1";
    const sourceB = "65f0000000000000000000b2";
    await jobs.insert("user-1", { ...input, idempotencyKey: randomUUID(), sourceId: sourceA });
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      sourceId: sourceA,
      status: "superseded",
    });
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      sourceId: sourceA,
      status: "failed",
    });
    await jobs.insert("user-1", { ...input, idempotencyKey: randomUUID(), sourceId: sourceB });
    await jobs.insert("user-2", { ...input, idempotencyKey: randomUUID(), sourceId: sourceA });

    const counts = await jobs.countBySourceIds("user-1", [
      sourceA,
      sourceB,
      "65f0000000000000000000c3",
    ]);
    expect(counts.get(sourceA)).toBe(3);
    expect(counts.get(sourceB)).toBe(1);
    expect(counts.get("65f0000000000000000000c3")).toBeUndefined();
  });
});

describe("selectForReconcile", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const windows = {
    recentMs: 60_000,
    staleClaimMs: 5 * 60_000,
    hourlyMs: 60 * 60_000,
    redeliveryMs: 24 * 60 * 60_000,
  };

  it("selects a processing job with a magicHourId and no lastCheckedAt, and stamps lastCheckedAt", async () => {
    const created = await jobs.insert("user-1", { ...input, magicHourId: "mh-1" });
    const selected = await jobs.selectForReconcile("user-1", now, windows, 5);
    expect(selected.map((j) => j.id)).toEqual([created.id]);
    expect(selected[0]?.lastCheckedAt).toEqual(now);
  });

  it("does not select a processing job checked 10s ago, but does select one checked 90s ago", async () => {
    const recent = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      magicHourId: "mh-recent",
      lastCheckedAt: new Date(now.getTime() - 10_000),
    });
    const stale = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      magicHourId: "mh-stale",
      lastCheckedAt: new Date(now.getTime() - 90_000),
    });
    const selected = await jobs.selectForReconcile("user-1", now, windows, 5);
    expect(selected.map((j) => j.id)).toEqual([stale.id]);
    expect(selected.map((j) => j.id)).not.toContain(recent.id);
  });

  it("never selects a processing job with no magicHourId -- the SUBMISSION_UNCONFIRMED dormancy", async () => {
    await jobs.insert("user-1", { ...input, idempotencyKey: randomUUID() });
    expect(await jobs.selectForReconcile("user-1", now, windows, 5)).toEqual([]);
  });

  it("does not select a finalizing job claimed 1 min ago, but does select one claimed 10 min ago", async () => {
    const recentlyClaimed = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "finalizing",
      claimedAt: new Date(now.getTime() - 60_000),
    });
    const staleClaim = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "finalizing",
      claimedAt: new Date(now.getTime() - 10 * 60_000),
    });
    const selected = await jobs.selectForReconcile("user-1", now, windows, 5);
    expect(selected.map((j) => j.id)).toEqual([staleClaim.id]);
    expect(selected.map((j) => j.id)).not.toContain(recentlyClaimed.id);
  });

  it("selects an abandoned job checked 2h ago within 24h of its deadline, but not one checked 5 min ago or one 30h past its deadline", async () => {
    const checkedRecently = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "abandoned",
      magicHourId: "mh-a",
      lastCheckedAt: new Date(now.getTime() - 5 * 60_000),
      deadlineAt: new Date(now.getTime() - 60_000),
    });
    const eligible = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "abandoned",
      magicHourId: "mh-b",
      lastCheckedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      deadlineAt: new Date(now.getTime() - 60_000),
    });
    const pastRedelivery = await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "abandoned",
      magicHourId: "mh-c",
      lastCheckedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      deadlineAt: new Date(now.getTime() - 30 * 60 * 60_000),
    });
    const selected = await jobs.selectForReconcile("user-1", now, windows, 5);
    expect(selected.map((j) => j.id)).toEqual([eligible.id]);
    expect(selected.map((j) => j.id)).not.toContain(checkedRecently.id);
    expect(selected.map((j) => j.id)).not.toContain(pastRedelivery.id);
  });

  it("never selects a complete or a failed job", async () => {
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "complete",
      magicHourId: "mh-d",
    });
    await jobs.insert("user-1", {
      ...input,
      idempotencyKey: randomUUID(),
      status: "failed",
      magicHourId: "mh-e",
    });
    expect(await jobs.selectForReconcile("user-1", now, windows, 5)).toEqual([]);
  });

  it("caps selection at the given limit even with more eligible jobs", async () => {
    for (let i = 0; i < 8; i += 1) {
      await jobs.insert("user-1", {
        ...input,
        idempotencyKey: randomUUID(),
        magicHourId: `mh-${i}`,
      });
    }
    const selected = await jobs.selectForReconcile("user-1", now, windows, 5);
    expect(selected).toHaveLength(5);
  });

  it("never lets two overlapping passes select the same job", async () => {
    for (let i = 0; i < 8; i += 1) {
      await jobs.insert("user-1", {
        ...input,
        idempotencyKey: randomUUID(),
        magicHourId: `mh-${i}`,
      });
    }
    const [first, second] = await Promise.all([
      jobs.selectForReconcile("user-1", now, windows, 5),
      jobs.selectForReconcile("user-1", now, windows, 5),
    ]);
    const firstIds = new Set(first.map((j) => j.id));
    const secondIds = new Set(second.map((j) => j.id));
    const intersection = [...firstIds].filter((id) => secondIds.has(id));
    expect(intersection).toEqual([]);
  });

  it("never selects another user's jobs", async () => {
    await jobs.insert("user-2", {
      ...input,
      idempotencyKey: randomUUID(),
      magicHourId: "mh-other",
    });
    expect(await jobs.selectForReconcile("user-1", now, windows, 5)).toEqual([]);
  });
});
