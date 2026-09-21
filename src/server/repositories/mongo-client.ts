import "server-only";
import {
  MongoClient,
  MongoNetworkError,
  MongoOperationTimeoutError,
  MongoServerSelectionError,
  MongoTopologyClosedError,
  type Db,
} from "mongodb";
import { AppError } from "@/server/errors/app-error";

export type DbGetter = () => Promise<Db>;

type CachedClient = { uri: string; client: Promise<MongoClient> };

const globalForMongo = globalThis as typeof globalThis & { __v2vMongo?: CachedClient };

// Two different outages, two different bounds.
//
// serverSelectionTimeoutMS bounds *finding* a server, which covers a server
// that is gone: the connection is refused, none is ever selected, and the
// request fails in ~5s. It does nothing once a server HAS been selected and
// handed a pooled socket. A server that then goes quiet without closing that
// socket -- a hung or overloaded node, or one that was SIGSTOPped -- leaves
// the driver waiting on the read with nothing to stop it, and FND-007's 503
// is never reached: the request hangs until the platform's own function limit
// kills it and serves an error page instead.
//
// timeoutMS is what bounds that read. Measured against a proxied mongod that
// accepts a query and then stops answering:
//   serverSelectionTimeoutMS alone   still waiting at 12s
//   + socketTimeoutMS = 500          still waiting at 12s
//   + timeoutMS = 2000               MongoOperationTimeoutError at 2003ms,
//                                    "Timed out during socket read"
// socketTimeoutMS is therefore not the fix here despite its name, and CSOT
// ignores it whenever timeoutMS is set, so it is deliberately not plumbed.
// MongoOperationTimeoutError is already carried to DATABASE_UNAVAILABLE by
// isConnectionError below.
//
// timeoutMS bounds the whole operation, server selection included, so it is
// set above serverSelectionTimeoutMS -- below it, selection would be cut
// short and the gone-server case would report the wrong reason.
//
// It is marked @experimental in driver 7.6.0. That is the stability of the
// API surface, not of the behaviour; it is the only option that bounds this,
// and the alternative is a hang.
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export type DbGetterOptions = {
  serverSelectionTimeoutMS?: number;
  timeoutMS?: number;
};

export function createDbGetter(
  uri: string,
  dbName: string,
  {
    serverSelectionTimeoutMS = DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
    timeoutMS = DEFAULT_TIMEOUT_MS,
  }: DbGetterOptions = {},
): DbGetter {
  return async () => (await connect(uri, { serverSelectionTimeoutMS, timeoutMS })).db(dbName);
}

function connect(uri: string, options: Required<DbGetterOptions>): Promise<MongoClient> {
  const cached = globalForMongo.__v2vMongo;
  if (cached?.uri === uri) return cached.client;
  const client: Promise<MongoClient> = new MongoClient(uri, options)
    .connect()
    .catch((error: unknown) => {
      if (globalForMongo.__v2vMongo?.client === client) globalForMongo.__v2vMongo = undefined;
      throw error;
    });
  globalForMongo.__v2vMongo = { uri, client };
  return client;
}

function isConnectionError(error: unknown): boolean {
  return (
    error instanceof MongoServerSelectionError ||
    error instanceof MongoNetworkError ||
    error instanceof MongoTopologyClosedError ||
    error instanceof MongoOperationTimeoutError
  );
}

export async function withDb<T>(getDb: DbGetter, run: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await run(await getDb());
  } catch (error) {
    if (isConnectionError(error)) throw new AppError("DATABASE_UNAVAILABLE", { cause: error });
    throw error;
  }
}

export async function closeDbClient(): Promise<void> {
  const cached = globalForMongo.__v2vMongo;
  globalForMongo.__v2vMongo = undefined;
  if (cached) await (await cached.client).close();
}
