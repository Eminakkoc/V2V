import "server-only";
import type { Document, ObjectId } from "mongodb";
import { sourceRecordSchema, type SourceRecord } from "@/server/validation/records";
import { COLLECTIONS } from "./collections";
import { parseForWrite, parseStored, toObjectId } from "./documents";
import { withDb, type DbGetter } from "./mongo-client";

export type Source = SourceRecord & { id: string };

export type NewSource = Omit<SourceRecord, "schemaVersion" | "userId" | "createdAt">;

export type SourcesRepository = {
  insert(userId: string, input: NewSource): Promise<Source>;
  findById(userId: string, id: string): Promise<Source | null>;
  listForUser(
    userId: string,
    query: { limit: number; cursor?: { createdAt: Date; id: string } },
  ): Promise<Source[]>;
  findByIds(userId: string, ids: string[]): Promise<Source[]>;
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

    listForUser: (userId, query) =>
      withDb(getDb, async (db) => {
        const conditions: Document[] = [{ userId }];
        if (query.cursor) {
          const cursorId = toObjectId(query.cursor.id);
          if (cursorId) {
            conditions.push({
              $or: [
                { createdAt: { $lt: query.cursor.createdAt } },
                { createdAt: query.cursor.createdAt, _id: { $lt: cursorId } },
              ],
            });
          }
        }
        const docs = await db
          .collection(COLLECTIONS.sources)
          .find(conditions.length === 1 ? conditions[0]! : { $and: conditions })
          .sort({ createdAt: -1, _id: -1 })
          .limit(query.limit)
          .toArray();
        return docs.map((doc) => parseStored(COLLECTIONS.sources, sourceRecordSchema, doc));
      }),

    findByIds: (userId, ids) =>
      withDb(getDb, async (db) => {
        const objectIds = ids.map(toObjectId).filter((id): id is ObjectId => id !== null);
        if (objectIds.length === 0) return [];
        const docs = await db
          .collection(COLLECTIONS.sources)
          .find({ userId, _id: { $in: objectIds } })
          .toArray();
        return docs.map((doc) => parseStored(COLLECTIONS.sources, sourceRecordSchema, doc));
      }),
  };
}
