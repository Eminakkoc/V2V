import { MongoClient, MongoNetworkError, MongoOperationTimeoutError } from "mongodb";
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

  it("wraps the operation timeout a quiet server produces", async () => {
    const error = await withDb(
      async () => {
        throw new MongoOperationTimeoutError("Timed out during socket read");
      },
      async () => "never",
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "DATABASE_UNAVAILABLE" });
  });
});

// IR-004 / FND-007. The two outage shapes are NOT the same. A dead server
// refuses the connection, none is ever selected, and serverSelectionTimeoutMS
// catches it -- the test above covers that and it always worked. The shape
// that did not is a server already selected and holding a pooled socket that
// then goes quiet: server selection is long done, and nothing bounds the read.
//
// That second shape needs a real peer that answers once and then stops, which
// is a TCP proxy in front of a live mongod. Driven that way, against this
// module's own createDbGetter/withDb:
//
//   serverSelectionTimeoutMS: 1000                 still waiting at 12s
//   serverSelectionTimeoutMS: 1000, socket: 500    still waiting at 12s
//   serverSelectionTimeoutMS: 1000, timeoutMS:2000 AppError
//                                                  DATABASE_UNAVAILABLE at 2006ms
//
// The proxy harness does not reproduce under Vitest -- the operation hangs
// there even with timeoutMS set, which the standalone run shows is an artifact
// of the runner rather than of the driver -- so it is not carried here as a
// test. What IS carried is the two things whose removal would silently undo
// the fix: the option reaching the client, and the error it raises reaching
// DATABASE_UNAVAILABLE (covered above).
describe("createDbGetter timeouts", () => {
  it("bounds the whole operation, not just server selection", async () => {
    const getDb = createDbGetter(inject("mongoUri"), "mongo-client-timeout-test");
    try {
      const db = await getDb();
      // Without timeoutMS an operation on an already-pooled socket has no
      // bound at all; serverSelectionTimeoutMS does not give it one.
      expect(db.client.options.timeoutMS).toBeGreaterThan(0);
      // CSOT spends the same budget on selection, so a timeoutMS at or below
      // serverSelectionTimeoutMS would cut selection short and make a
      // genuinely-absent server report the wrong reason.
      expect(db.client.options.timeoutMS).toBeGreaterThan(
        db.client.options.serverSelectionTimeoutMS,
      );
    } finally {
      await closeDbClient();
    }
  });

  it("lets a caller widen the bound for a long operator command", async () => {
    // pnpm db:indexes builds indexes over a populated collection, which can
    // legitimately outrun the request-path bound.
    const getDb = createDbGetter(inject("mongoUri"), "mongo-client-timeout-test", {
      timeoutMS: 300_000,
    });
    try {
      const db = await getDb();
      expect(db.client.options.timeoutMS).toBe(300_000);
    } finally {
      await closeDbClient();
    }
  });
});
