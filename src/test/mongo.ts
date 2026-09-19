import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { afterAll, inject } from "vitest";
import type { DbGetter } from "@/server/repositories/mongo-client";

export function useTestDb(): { getDb: DbGetter } {
  const client = new MongoClient(inject("mongoUri"));
  const db = client.db(`test_${randomUUID().replaceAll("-", "")}`);
  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });
  return { getDb: async () => db };
}
