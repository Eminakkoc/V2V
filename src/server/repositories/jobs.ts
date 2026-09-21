import "server-only";
import type { Document, ObjectId, WithId } from "mongodb";
import { CHANGEABLE_STATUSES, JOB_PHASES, type JobPhase, type JobStatus } from "@/lib/job-status";
import { jobRecordSchema, type JobRecord } from "@/server/validation/records";
import { COLLECTIONS } from "./collections";
import { parseForWrite, parseStored, toObjectId } from "./documents";
import { withDb, type DbGetter } from "./mongo-client";

export type Job = JobRecord & { id: string };

export type NewJob = Omit<JobRecord, "schemaVersion" | "userId" | "createdAt" | "updatedAt">;

export type FailurePatch = {
  errorCode: string;
  errorMessage: string;
  magicHourError?: { code: string; message: string };
};

export type CompletionPatch = {
  output: { cloudinaryPublicId: string; cloudinaryUrl: string };
  creditsCharged?: number;
};

export type JobsDateCursor = { createdAt: Date; id: string };
export type JobsDurationCursor = { clipSeconds: number; createdAt: Date; id: string };

// `sort` stays optional so date-sort callers keep compiling; the `{ clipSeconds?: never }` on the
// date arm is what stops a duration cursor slipping through union excess-property checking.
export type HistoryQuery = {
  statuses?: JobStatus[];
  artStyle?: string;
  includePrevious: boolean;
  dir: "asc" | "desc";
  limit: number;
} & (
  | { sort?: "createdAt"; cursor?: JobsDateCursor & { clipSeconds?: never } }
  | { sort: "duration"; cursor?: JobsDurationCursor }
);

export type ActiveCounts = {
  processing: number;
  finalizing: number;
  timedOut: number;
  superseded: number;
};

type FacetCount = { count: number }[];

type ActiveCountsFacet = {
  processing: FacetCount;
  finalizing: FacetCount;
  timedOut: FacetCount;
  superseded: FacetCount;
};

export type JobsRepository = {
  insert(userId: string, input: NewJob): Promise<Job>;
  findById(userId: string, id: string): Promise<Job | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<Job | null>;
  findByIdUnscoped(id: string): Promise<Job | null>;
  findByMagicHourId(magicHourId: string): Promise<Job | null>;
  attachMagicHourId(id: string, magicHourId: string): Promise<Job | null>;
  claimForFinalize(id: string, now: Date, staleBefore: Date): Promise<Job | null>;
  releaseClaim(id: string): Promise<void>;
  setPhase(id: string, phase: JobPhase): Promise<Job | null>;
  markFailed(id: string, patch: FailurePatch): Promise<Job | null>;
  markComplete(id: string, patch: CompletionPatch): Promise<Job | null>;
  markSuperseded(id: string, bySupersedingJobId: string): Promise<Job | null>;
  setLastError(id: string, lastError: string): Promise<void>;
  listForUser(userId: string, query: HistoryQuery): Promise<Job[]>;
  countActive(userId: string, now: Date, graceMs: number): Promise<ActiveCounts>;
  listChangeable(userId: string): Promise<Job[]>;
  findByIds(userId: string, ids: string[]): Promise<Job[]>;
  countBySourceIds(userId: string, sourceIds: string[]): Promise<Map<string, number>>;
  selectForReconcile(
    userId: string,
    now: Date,
    windows: {
      recentMs: number;
      staleClaimMs: number;
      hourlyMs: number;
      redeliveryMs: number;
      graceMs: number;
    },
    limit: number,
  ): Promise<Job[]>;
  markTimedOut(id: string): Promise<Job | null>;
  markAbandoned(
    id: string,
    errorCode: "JOB_ABANDONED" | "SUBMISSION_UNCONFIRMED",
    errorMessage: string,
  ): Promise<Job | null>;
  markFailedFromCheck(id: string, patch: FailurePatch): Promise<Job | null>;
};

// The rank of each phase in its declared order, so a write can only ever move a job's phase
// forward.
const PHASE_RANK: Record<JobPhase, number> = Object.fromEntries(
  JOB_PHASES.map((phase, index) => [phase, index]),
) as Record<JobPhase, number>;

export { CHANGEABLE_STATUSES };

export function createJobsRepository(getDb: DbGetter): JobsRepository {
  return {
    insert: (userId, input) =>
      withDb(getDb, async (db) => {
        const now = new Date();
        const record = parseForWrite(COLLECTIONS.jobs, jobRecordSchema, {
          ...input,
          userId,
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        });
        const { insertedId } = await db.collection(COLLECTIONS.jobs).insertOne({ ...record });
        return { ...record, id: insertedId.toHexString() };
      }),
    findById: (userId, id) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const document = await db.collection(COLLECTIONS.jobs).findOne({ _id, userId });
        return document ? parseStored(COLLECTIONS.jobs, jobRecordSchema, document) : null;
      }),

    findByIdempotencyKey: (userId, key) =>
      withDb(getDb, async (db) => {
        const doc = await db.collection(COLLECTIONS.jobs).findOne({ userId, idempotencyKey: key });
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    findByIdUnscoped: (id) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db.collection(COLLECTIONS.jobs).findOne({ _id });
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    findByMagicHourId: (magicHourId) =>
      withDb(getDb, async (db) => {
        const doc = await db.collection(COLLECTIONS.jobs).findOne({ magicHourId });
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    // Guarded on magicHourId being absent so two deliveries racing the name fallback cannot both
    // attach.
    attachMagicHourId: (id, magicHourId) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db
          .collection(COLLECTIONS.jobs)
          .findOneAndUpdate(
            { _id, magicHourId: { $exists: false } },
            { $set: { magicHourId, updatedAt: new Date() } },
            { returnDocument: "after" },
          );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    // A job already finalizing is only reclaimable when its claim predates staleBefore -- the
    // crashed-mid-finalize recovery.
    claimForFinalize: (id, now, staleBefore) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
          {
            _id,
            $or: [
              { status: { $in: ["processing", "timed_out", "superseded", "abandoned"] } },
              { status: "finalizing", claimedAt: { $lt: staleBefore } },
            ],
          },
          [
            {
              $set: {
                // Re-claiming a stale finalizing job must not overwrite the original pre-claim
                // status with "finalizing".
                preFinalizeStatus: {
                  $cond: [
                    { $eq: ["$status", "finalizing"] },
                    { $ifNull: ["$preFinalizeStatus", "processing"] },
                    "$status",
                  ],
                },
                status: "finalizing",
                claimedAt: now,
                updatedAt: now,
              },
            },
          ],
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    releaseClaim: (id) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return;
        await db.collection(COLLECTIONS.jobs).updateOne({ _id, status: "finalizing" }, [
          {
            $set: {
              status: { $ifNull: ["$preFinalizeStatus", "processing"] },
              updatedAt: "$$NOW",
            },
          },
          { $unset: ["claimedAt", "preFinalizeStatus"] },
        ]);
      }),

    // Guarded on status and on phase rank, so neither a late webhook nor the create call's own
    // write can drag a job backwards.
    setPhase: (id, phase) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const notAhead = JOB_PHASES.filter(
          (candidate) => PHASE_RANK[candidate] <= PHASE_RANK[phase],
        );
        const doc = await db
          .collection(COLLECTIONS.jobs)
          .findOneAndUpdate(
            { _id, status: "processing", phase: { $in: notAhead } },
            { $set: { phase, updatedAt: new Date() } },
            { returnDocument: "after" },
          );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    markFailed: (id, patch) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
          // Magic Hour redelivers for up to 24h: a late video.errored must not overwrite a job that
          // already finalized.
          { _id, status: { $ne: "complete" } },
          {
            $set: {
              status: "failed",
              errorCode: patch.errorCode,
              errorMessage: patch.errorMessage,
              updatedAt: new Date(),
              ...(patch.magicHourError ? { magicHourError: patch.magicHourError } : {}),
            },
            $unset: { claimedAt: "", preFinalizeStatus: "" },
          },
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    markComplete: (id, patch) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const now = new Date();
        const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
          { _id },
          {
            $set: {
              status: "complete",
              completedAt: now,
              updatedAt: now,
              output: patch.output,
              ...(patch.creditsCharged !== undefined
                ? { creditsCharged: patch.creditsCharged }
                : {}),
            },
            // The error fields go too: a late webhook can rescue a job reconciliation already
            // failed, and errorCode is projected into the public job view.
            $unset: {
              claimedAt: "",
              preFinalizeStatus: "",
              errorCode: "",
              errorMessage: "",
            },
          },
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    // Guarded to retryable states so a same-named retry can never hide a completed render; a
    // guarded-out call returns null and only the link is refused.
    markSuperseded: (id, bySupersedingJobId) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
          { _id, status: { $in: ["failed", "timed_out", "abandoned"] } },
          {
            $set: {
              status: "superseded",
              supersededByJobId: bySupersedingJobId,
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    setLastError: (id, lastError) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return;
        await db
          .collection(COLLECTIONS.jobs)
          .updateOne({ _id }, { $set: { lastError, updatedAt: new Date() } });
      }),

    listForUser: (userId, query) =>
      withDb(getDb, async (db) => {
        const conditions: Document[] = [{ userId }];
        // Two exclusions, because reconciliation can move a previous attempt off "superseded" while
        // supersededByJobId stays -- a status-only test would let such a row onto the top level and
        // render it twice.
        if (!query.includePrevious) {
          conditions.push({ supersededByJobId: { $exists: false } });
          conditions.push({ status: { $ne: "superseded" } });
        }
        if (query.statuses?.length) conditions.push({ status: { $in: query.statuses } });
        if (query.artStyle) conditions.push({ "params.artStyle": query.artStyle });

        const op = query.dir === "desc" ? "$lt" : "$gt";
        const sortDir = query.dir === "asc" ? 1 : -1;

        if (query.sort === "duration") {
          const cursor = query.cursor;
          // $addFields has to run before the cursor comparison; the owner and filter conditions
          // stay ahead of it so they can still use an index.
          const pipeline: Document[] = [
            { $match: conditions.length === 1 ? conditions[0]! : { $and: conditions } },
            {
              $addFields: {
                clipSeconds: {
                  $round: [{ $subtract: ["$params.endSeconds", "$params.startSeconds"] }, 2],
                },
              },
            },
          ];
          if (cursor) {
            const cursorId = toObjectId(cursor.id);
            if (cursorId) {
              pipeline.push({
                $match: {
                  $or: [
                    { clipSeconds: { [op]: cursor.clipSeconds } },
                    { clipSeconds: cursor.clipSeconds, createdAt: { [op]: cursor.createdAt } },
                    {
                      clipSeconds: cursor.clipSeconds,
                      createdAt: cursor.createdAt,
                      _id: { [op]: cursorId },
                    },
                  ],
                },
              });
            }
          }
          pipeline.push(
            { $sort: { clipSeconds: sortDir, createdAt: sortDir, _id: sortDir } },
            { $limit: query.limit },
            { $unset: "clipSeconds" },
          );
          const docs = await db
            .collection(COLLECTIONS.jobs)
            .aggregate<WithId<Document>>(pipeline)
            .toArray();
          return docs.map((doc) => parseStored(COLLECTIONS.jobs, jobRecordSchema, doc));
        }

        const cursor = query.cursor;
        if (cursor) {
          const cursorId = toObjectId(cursor.id);
          if (cursorId) {
            conditions.push({
              $or: [
                { createdAt: { [op]: cursor.createdAt } },
                { createdAt: cursor.createdAt, _id: { [op]: cursorId } },
              ],
            });
          }
        }
        const docs = await db
          .collection(COLLECTIONS.jobs)
          .find(conditions.length === 1 ? conditions[0]! : { $and: conditions })
          .sort({ createdAt: sortDir, _id: sortDir })
          .limit(query.limit)
          .toArray();
        return docs.map((doc) => parseStored(COLLECTIONS.jobs, jobRecordSchema, doc));
      }),

    // timed_out and superseded jobs stay claimable, but counting them past deadlineAt + graceMs
    // would drive polling forever with nothing left to check.
    countActive: (userId, now, graceMs) =>
      withDb(getDb, async (db) => {
        const graceFloor = new Date(now.getTime() - graceMs);
        const [result] = await db
          .collection(COLLECTIONS.jobs)
          .aggregate<ActiveCountsFacet>([
            { $match: { userId } },
            {
              $facet: {
                processing: [{ $match: { status: "processing" } }, { $count: "count" }],
                finalizing: [{ $match: { status: "finalizing" } }, { $count: "count" }],
                timedOut: [
                  { $match: { status: "timed_out", deadlineAt: { $gt: graceFloor } } },
                  { $count: "count" },
                ],
                superseded: [
                  { $match: { status: "superseded", deadlineAt: { $gt: graceFloor } } },
                  { $count: "count" },
                ],
              },
            },
          ])
          .toArray();
        return {
          processing: result?.processing[0]?.count ?? 0,
          finalizing: result?.finalizing[0]?.count ?? 0,
          timedOut: result?.timedOut[0]?.count ?? 0,
          superseded: result?.superseded[0]?.count ?? 0,
        };
      }),

    listChangeable: (userId) =>
      withDb(getDb, async (db) => {
        const docs = await db
          .collection(COLLECTIONS.jobs)
          .find({ userId, status: { $in: [...CHANGEABLE_STATUSES] } })
          .sort({ createdAt: -1, _id: -1 })
          .toArray();
        return docs.map((doc) => parseStored(COLLECTIONS.jobs, jobRecordSchema, doc));
      }),

    // Owner-scoped, so an id that is unknown or belongs to someone else is simply absent rather
    // than reported -- the caller cannot tell those cases apart.
    findByIds: (userId, ids) =>
      withDb(getDb, async (db) => {
        const objectIds = ids.map(toObjectId).filter((id): id is ObjectId => id !== null);
        if (objectIds.length === 0) return [];
        const docs = await db
          .collection(COLLECTIONS.jobs)
          .find({ userId, _id: { $in: objectIds } })
          .toArray();
        return docs.map((doc) => parseStored(COLLECTIONS.jobs, jobRecordSchema, doc));
      }),

    countBySourceIds: (userId, sourceIds) =>
      withDb(getDb, async (db) => {
        if (sourceIds.length === 0) return new Map<string, number>();
        const rows = await db
          .collection(COLLECTIONS.jobs)
          .aggregate<{ _id: string; count: number }>([
            { $match: { userId, sourceId: { $in: sourceIds } } },
            { $group: { _id: "$sourceId", count: { $sum: 1 } } },
          ])
          .toArray();
        return new Map(rows.map((row) => [row._id, row.count]));
      }),

    // Sequential findOneAndUpdate calls, not updateMany: stamping lastCheckedAt inside the write
    // that matches on it is what stops two overlapping requests selecting the same job.
    selectForReconcile: (userId, now, windows, limit) =>
      withDb(getDb, async (db) => {
        const uncheckedBefore = (ms: number) => ({
          $or: [
            { lastCheckedAt: { $exists: false } },
            { lastCheckedAt: { $lt: new Date(now.getTime() - ms) } },
          ],
        });
        const filter = {
          userId,
          $or: [
            {
              status: { $in: ["processing", "timed_out"] },
              magicHourId: { $exists: true },
              ...uncheckedBefore(windows.recentMs),
            },
            // superseded needs its own arm bounded by the redelivery window, because nothing else
            // ever moves it to a terminal state.
            {
              status: "superseded",
              magicHourId: { $exists: true },
              ...uncheckedBefore(windows.recentMs),
              deadlineAt: {
                $lt: now,
                $gte: new Date(now.getTime() - windows.redeliveryMs),
              },
            },
            {
              status: "finalizing",
              claimedAt: { $lt: new Date(now.getTime() - windows.staleClaimMs) },
              ...uncheckedBefore(windows.recentMs),
            },
            {
              status: "abandoned",
              magicHourId: { $exists: true },
              ...uncheckedBefore(windows.hourlyMs),
              deadlineAt: {
                $lt: now,
                $gte: new Date(now.getTime() - windows.redeliveryMs),
              },
            },
            // A job we asked the provider to start but never got an id back for: keyed on the
            // absence of the id, since no provider call is possible and every other arm requires
            // it.
            {
              status: "processing",
              magicHourId: { $exists: false },
              ...uncheckedBefore(windows.recentMs),
              deadlineAt: { $lt: new Date(now.getTime() - windows.graceMs) },
            },
          ],
        };

        const selected: Job[] = [];
        for (let taken = 0; taken < limit; taken += 1) {
          const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
            filter,
            { $set: { lastCheckedAt: now } },
            // A missing lastCheckedAt sorts before any date, so a never-checked job is always taken
            // first.
            { sort: { lastCheckedAt: 1 }, returnDocument: "after" },
          );
          if (!doc) break;
          selected.push(parseStored(COLLECTIONS.jobs, jobRecordSchema, doc));
        }
        return selected;
      }),

    // Guarded to processing only, so the deadline boundary fires exactly once.
    markTimedOut: (id) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
          { _id, status: "processing" },
          {
            $set: {
              status: "timed_out",
              errorCode: "WEBHOOK_TIMEOUT",
              errorMessage: "This is taking longer than expected. We are still checking.",
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    // The grace boundary, also once; abandoned must never eclipse a delivered result or a confirmed
    // failure.
    markAbandoned: (id, errorCode, errorMessage) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
          { _id, status: { $in: ["processing", "timed_out", "finalizing"] } },
          {
            $set: { status: "abandoned", errorCode, errorMessage, updatedAt: new Date() },
            $unset: { claimedAt: "", preFinalizeStatus: "" },
          },
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    // Narrower than markFailed: a status check can be reporting a view older than a webhook write
    // that already landed, so the stale reader loses.
    markFailedFromCheck: (id, patch) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const doc = await db.collection(COLLECTIONS.jobs).findOneAndUpdate(
          {
            _id,
            status: { $in: ["processing", "timed_out", "superseded", "abandoned", "finalizing"] },
          },
          {
            $set: {
              status: "failed",
              errorCode: patch.errorCode,
              errorMessage: patch.errorMessage,
              updatedAt: new Date(),
              ...(patch.magicHourError ? { magicHourError: patch.magicHourError } : {}),
            },
            $unset: { claimedAt: "", preFinalizeStatus: "" },
          },
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),
  };
}
