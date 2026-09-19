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

export function createDbGetter(
  uri: string,
  dbName: string,
  { serverSelectionTimeoutMS = 5000 }: { serverSelectionTimeoutMS?: number } = {},
): DbGetter {
  return async () => (await connect(uri, serverSelectionTimeoutMS)).db(dbName);
}

function connect(uri: string, serverSelectionTimeoutMS: number): Promise<MongoClient> {
  const cached = globalForMongo.__v2vMongo;
  if (cached?.uri === uri) return cached.client;
  const client: Promise<MongoClient> = new MongoClient(uri, { serverSelectionTimeoutMS })
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
