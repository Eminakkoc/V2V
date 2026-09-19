import "server-only";
import { sourceRecordSchema, type SourceRecord } from "@/server/validation/records";
import { COLLECTIONS } from "./collections";
import { parseForWrite, parseStored, toObjectId } from "./documents";
import { withDb, type DbGetter } from "./mongo-client";

export type Source = SourceRecord & { id: string };

export type NewSource = Omit<SourceRecord, "schemaVersion" | "userId" | "createdAt">;

export type SourcesRepository = {
  insert(userId: string, input: NewSource): Promise<Source>;
  findById(userId: string, id: string): Promise<Source | null>;
};

export function createSourcesRepository(getDb: DbGetter): SourcesRepository {
  return {
    insert: (userId, input) =>
      withDb(getDb, async (db) => {
        const record = parseForWrite(COLLECTIONS.sources, sourceRecordSchema, {
          ...input,
          userId,
          schemaVersion: 1,
          createdAt: new Date(),
        });
        const { insertedId } = await db.collection(COLLECTIONS.sources).insertOne({ ...record });
        return { ...record, id: insertedId.toHexString() };
      }),
    findById: (userId, id) =>
      withDb(getDb, async (db) => {
        const _id = toObjectId(id);
        if (!_id) return null;
        const document = await db.collection(COLLECTIONS.sources).findOne({ _id, userId });
        return document ? parseStored(COLLECTIONS.sources, sourceRecordSchema, document) : null;
      }),
  };
}
