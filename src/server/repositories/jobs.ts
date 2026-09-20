import "server-only";
import type { Document, ObjectId, WithId } from "mongodb";
import { JOB_PHASES, type JobPhase, type JobStatus } from "@/lib/job-status";
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

// `sort` is optional rather than required so the pre-existing date-sort
// callers (and their tests, which predate this field) keep compiling with
// undefined behaving exactly like "createdAt". But `sort` and `cursor` must
// still agree: a duration cursor paired with `sort` omitted would silently
// take the date branch below, drop `clipSeconds`, and page on createdAt/_id
// against a caller who believes they are paging by length. The intersected
// `{ clipSeconds?: never }` on the date arm is required, not decorative — a
// plain discriminated union lets a duration cursor's `clipSeconds` through
// under union excess-property checking because it is a known key on the
// other arm.
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
};

// The rank of each phase in its declared order, so a write can be guarded to
// only ever move a job's phase forward.
const PHASE_RANK: Record<JobPhase, number> = Object.fromEntries(
  JOB_PHASES.map((phase, index) => [phase, index]),
) as Record<JobPhase, number>;

// The statuses reconciliation can still act on. The History refresh asks for
// exactly this set, which is what makes "the set came back empty" a correct
// reason to stop polling rather than merely a convenient one.
export const CHANGEABLE_STATUSES = [
  "processing",
  "finalizing",
  "timed_out",
  "superseded",
  "abandoned",
] as const satisfies readonly JobStatus[];

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

    // Guarded on magicHourId being absent so two deliveries racing the name
    // fallback cannot both attach. Returns null when someone else won.
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

    // One atomic transition. A job already finalizing is only reclaimable when its
    // claim predates staleBefore — that is the crashed-mid-finalize recovery.
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
          // A pipeline update so the status being replaced is captured in the same
          // write. Reading it beforehand would restore a stale value on release.
          [
            {
              $set: {
                // Re-claiming a stale finalizing job must not overwrite the original
                // pre-claim status with "finalizing".
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

    // No status argument: restores whatever claimForFinalize recorded as the
    // pre-claim status, atomically, in the same write that clears the claim.
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

    // Guarded on status: "processing" so a late video.started (or any other phase
    // update) cannot drag a job that already moved on backwards. Also guarded on
    // phase rank so, independent of status, a phase update can only advance —
    // e.g. the create call's own "queued" write must not overwrite "rendering"
    // when a video.started webhook won the race.
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
          // Magic Hour redelivers for up to 24h: a late video.errored must not
          // overwrite a job that already finalized and paid out a result.
          { _id, status: { $ne: "complete" } },
          {
            $set: {
              status: "failed",
              errorCode: patch.errorCode,
              errorMessage: patch.errorMessage,
              updatedAt: new Date(),
              ...(patch.magicHourError ? { magicHourError: patch.magicHourError } : {}),
            },
            // Failure is terminal: any claim bookkeeping left over from a finalize
            // attempt no longer means anything.
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
            $unset: { claimedAt: "", preFinalizeStatus: "" },
          },
          { returnDocument: "after" },
        );
        return doc ? parseStored(COLLECTIONS.jobs, jobRecordSchema, doc) : null;
      }),

    // Guarded to only retryable states: a job that already completed (and was
    // paid for) or is mid-flight must never be hidden by a same-named retry.
    // A guarded-out call returns null; the caller proceeds with the new job
    // regardless — only the link between the two is refused.
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
        if (!query.includePrevious) conditions.push({ status: { $ne: "superseded" } });
        if (query.statuses?.length) conditions.push({ status: { $in: query.statuses } });
        if (query.artStyle) conditions.push({ "params.artStyle": query.artStyle });

        const op = query.dir === "desc" ? "$lt" : "$gt";
        const sortDir = query.dir === "asc" ? 1 : -1;

        if (query.sort === "duration") {
          // No cast: the union on HistoryQuery narrows query.cursor to
          // JobsDurationCursor | undefined once query.sort is known to be
          // "duration".
          const cursor = query.cursor;
          // $addFields has to run before the cursor comparison, because the
          // boundary is expressed against the computed length. The owner and
          // filter conditions stay ahead of it so they can still use an index.
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

        // No cast: query.sort narrowed to "createdAt" | undefined above, so
        // query.cursor here is JobsDateCursor (with clipSeconds excluded) |
        // undefined.
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

    // timed_out and superseded jobs are still reachable by claimForFinalize (a
    // late result is genuinely still saved), but that window is not forever:
    // past deadlineAt + graceMs no further delivery is plausible, and counting
    // them past that point would drive polling forever with nothing left to
    // check (nothing else ever clears these statuses this cycle).
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

    // Owner-scoped by the same { userId } every read here uses, so an id that is
    // unknown or belongs to someone else is simply absent from the result rather
    // than reported -- the caller cannot tell those two cases apart, which is
    // what stops the parameter revealing that another user's job exists.
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
  };
}
