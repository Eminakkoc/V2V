import "server-only";
import type { Db, IndexDescription } from "mongodb";
import { COLLECTIONS } from "./collections";

export const RATE_LIMIT_WINDOW_SECONDS = 600;

// Keyed on the known collection names (not `string`) so `INDEXES.jobs` etc. are
// exhaustive properties, not an index signature — noUncheckedIndexedAccess would
// otherwise widen every access to `| undefined`.
export const INDEXES: Record<(typeof COLLECTIONS)[keyof typeof COLLECTIONS], IndexDescription[]> = {
  [COLLECTIONS.jobs]: [
    { key: { userId: 1, createdAt: -1 }, name: "userId_createdAt" },
    { key: { userId: 1, status: 1 }, name: "userId_status" },
    {
      key: { magicHourId: 1 },
      name: "magicHourId_unique",
      unique: true,
      partialFilterExpression: { magicHourId: { $type: "string" } },
    },
    {
      key: { userId: 1, idempotencyKey: 1 },
      name: "userId_idempotencyKey_unique",
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: "string" } },
    },
  ],
  [COLLECTIONS.sources]: [{ key: { userId: 1, createdAt: -1 }, name: "userId_createdAt" }],
  [COLLECTIONS.rateLimitHits]: [
    { key: { key: 1, createdAt: 1 }, name: "key_createdAt" },
    { key: { createdAt: 1 }, name: "createdAt_ttl", expireAfterSeconds: RATE_LIMIT_WINDOW_SECONDS },
  ],
};

export async function ensureIndexes(db: Db): Promise<void> {
  for (const [collection, indexes] of Object.entries(INDEXES)) {
    await db.collection(collection).createIndexes(indexes);
  }
}
