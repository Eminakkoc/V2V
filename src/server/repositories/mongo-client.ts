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

// timeoutMS is the only option that bounds a read on an already-selected socket
// (serverSelectionTimeoutMS covers finding a server, and CSOT ignores socketTimeoutMS), and it is
// set above serverSelectionTimeoutMS so selection is not cut short.
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
