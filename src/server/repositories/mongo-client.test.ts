import { MongoClient, MongoNetworkError } from "mongodb";
import { describe, expect, inject, it, vi } from "vitest";
import { AppError } from "@/server/errors/app-error";
import { closeDbClient, createDbGetter, withDb } from "./mongo-client";

describe("withDb", () => {
  it("turns an unreachable database into DATABASE_UNAVAILABLE", async () => {
    const getDb = createDbGetter("mongodb://127.0.0.1:1", "v2v", { serverSelectionTimeoutMS: 200 });
    const error = await withDb(getDb, async (db) => db.collection("sources").findOne({})).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "DATABASE_UNAVAILABLE", status: 503, retryable: true });
  });

  it("wraps connection errors raised during a query", async () => {
    const error = await withDb(
      async () => {
        throw new MongoNetworkError("connection reset");
      },
      async () => "never",
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "DATABASE_UNAVAILABLE" });
  });

  it("passes other errors through", async () => {
    const boom = new Error("boom");
    await expect(
      withDb(
        async () => {
          throw boom;
        },
        async () => "never",
      ),
    ).rejects.toBe(boom);
  });

  it("keeps a newer cached client when an older failed attempt settles later", async () => {
    const failing = createDbGetter("mongodb://127.0.0.1:1", "v2v", {
      serverSelectionTimeoutMS: 200,
    });
    const failingAttempt = withDb(failing, async (db) =>
      db.collection("sources").findOne({}),
    ).catch((caught: unknown) => caught);

    const reachable = createDbGetter(inject("mongoUri"), "mongo-client-race-test");
    await withDb(reachable, async (db) => db.collection("sources").findOne({}));

    expect(await failingAttempt).toBeInstanceOf(AppError);

    const connectSpy = vi.spyOn(MongoClient.prototype, "connect");
    await withDb(reachable, async (db) => db.collection("sources").findOne({}));
    expect(connectSpy).not.toHaveBeenCalled();

    connectSpy.mockRestore();
    await closeDbClient();
  });
});
