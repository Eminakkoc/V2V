import "server-only";
import { jobRecordSchema, type JobRecord } from "@/server/validation/records";
import { COLLECTIONS } from "./collections";
import { parseForWrite, parseStored, toObjectId } from "./documents";
import { withDb, type DbGetter } from "./mongo-client";

export type Job = JobRecord & { id: string };

export type NewJob = Omit<JobRecord, "schemaVersion" | "userId" | "createdAt" | "updatedAt">;

export type JobsRepository = {
  insert(userId: string, input: NewJob): Promise<Job>;
  findById(userId: string, id: string): Promise<Job | null>;
};

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
  };
}
