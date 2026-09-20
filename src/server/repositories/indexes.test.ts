import { describe, expect, it } from "vitest";
import { setupTestDb } from "@/test/mongo";
import { COLLECTIONS } from "./collections";
import { ensureIndexes, INDEXES, RATE_LIMIT_WINDOW_SECONDS } from "./indexes";

const { getDb } = setupTestDb();

async function indexNames(collection: string) {
  const db = await getDb();
  return (await db.collection(collection).listIndexes().toArray()).map((index) => index.name);
}

describe("ensureIndexes", () => {
  it("creates every index and is safe to re-run", async () => {
    const db = await getDb();
    await ensureIndexes(db);
    await ensureIndexes(db);
    expect(await indexNames(COLLECTIONS.jobs)).toEqual(
      expect.arrayContaining(["userId_createdAt", "userId_status", "magicHourId_unique"]),
    );
    expect(await indexNames(COLLECTIONS.sources)).toEqual(
      expect.arrayContaining(["userId_createdAt"]),
    );
    expect(await indexNames(COLLECTIONS.rateLimitHits)).toEqual(
      expect.arrayContaining(["key_createdAt", "createdAt_ttl"]),
    );
  });

  it("expires rate-limit hits after the window", async () => {
    const db = await getDb();
    await ensureIndexes(db);
    const ttl = (await db.collection(COLLECTIONS.rateLimitHits).listIndexes().toArray()).find(
      (index) => index.name === "createdAt_ttl",
    );
    expect(ttl?.expireAfterSeconds).toBe(RATE_LIMIT_WINDOW_SECONDS);
  });

  it("allows many jobs without a Magic Hour ID but not two with the same one", async () => {
    const db = await getDb();
    await ensureIndexes(db);
    const jobs = db.collection(COLLECTIONS.jobs);
    await jobs.insertOne({ userId: "u" });
    await jobs.insertOne({ userId: "u" });
    await jobs.insertOne({ userId: "u", magicHourId: "mh_1" });
    await expect(jobs.insertOne({ userId: "u", magicHourId: "mh_1" })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("indexes jobs by user and idempotency key, uniquely and partially", () => {
    const index = INDEXES.jobs.find((i) => i.name === "userId_idempotencyKey_unique");
    expect(index).toBeDefined();
    expect(index?.key).toEqual({ userId: 1, idempotencyKey: 1 });
    expect(index?.unique).toBe(true);
    // Partial, so jobs written before this field existed do not collide on null.
    expect(index?.partialFilterExpression).toEqual({ idempotencyKey: { $type: "string" } });
  });
});
