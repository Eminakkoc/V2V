// Creates the MongoDB indexes. Run once per environment: pnpm db:indexes
import { getConfig } from "@/config/env";
import { ensureIndexes } from "@/server/repositories/indexes";
import { closeDbClient, createDbGetter } from "@/server/repositories/mongo-client";

async function main() {
  const { mongodb } = getConfig();
  // Building an index over a populated collection can legitimately outrun the
  // request-path operation timeout, which exists to fail a hung server fast.
  // This is a one-off operator command with nobody waiting on it, so it gets
  // room.
  await ensureIndexes(await createDbGetter(mongodb.uri, mongodb.dbName, { timeoutMS: 300_000 })());
  console.log(`Indexes are ready in "${mongodb.dbName}".`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDbClient());
