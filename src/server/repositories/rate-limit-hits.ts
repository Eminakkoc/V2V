import "server-only";
import type { ObjectId } from "mongodb";
import { COLLECTIONS } from "./collections";
import { toObjectId } from "./documents";
import { withDb, type DbGetter } from "./mongo-client";

type HitDocument = { key: string; createdAt: Date };

export type RateLimitHitsRepository = {
  record(key: string, at: Date): Promise<string>;
  countSince(key: string, since: Date): Promise<number>;
  oldestSince(key: string, since: Date): Promise<Date | null>;
  remove(hitIds: string[]): Promise<void>;
};

export function createRateLimitHitsRepository(getDb: DbGetter): RateLimitHitsRepository {
  const hits = async () => (await getDb()).collection<HitDocument>(COLLECTIONS.rateLimitHits);
  return {
    record: (key, at) =>
      withDb(getDb, async () => {
        const { insertedId } = await (await hits()).insertOne({ key, createdAt: at });
        return insertedId.toHexString();
      }),
    countSince: (key, since) =>
      withDb(getDb, async () => (await hits()).countDocuments({ key, createdAt: { $gt: since } })),
    oldestSince: (key, since) =>
      withDb(getDb, async () => {
        const oldest = await (
          await hits()
        ).findOne({ key, createdAt: { $gt: since } }, { sort: { createdAt: 1 } });
        return oldest?.createdAt ?? null;
      }),
    remove: (hitIds) =>
      withDb(getDb, async () => {
        const ids = hitIds.map(toObjectId).filter((id): id is ObjectId => id !== null);
        await (await hits()).deleteMany({ _id: { $in: ids } });
      }),
  };
}
