// Removes the sources a live manual-test run left behind, in the live providers and in
// MongoDB: pnpm cleanup:manual [--since <ISO date>] [--delete]
//
// Deleting a source is a product non-goal, so nothing in the app can clear these; without
// this script every live run adds permanently to the Uploadcare and Cloudinary projects.
//
// Dry run by default — it only prints. Pass --delete to actually remove anything.
import { deleteFile, UploadcareSimpleAuthSchema } from "@uploadcare/rest-client";
import { v2 as cloudinary } from "cloudinary";
import type { ObjectId } from "mongodb";
import { getConfig } from "@/config/env";
import { COLLECTIONS } from "@/server/repositories/collections";
import { closeDbClient, createDbGetter } from "@/server/repositories/mongo-client";

const DEFAULT_SINCE_HOURS = 24;

type Candidate = {
  _id: ObjectId;
  id: string;
  createdAt: Date;
  uploadcareUuid: string;
  cloudinaryPublicId: string;
};

type Args = { since: Date; apply: boolean };

export function parseArgs(argv: string[], now: () => number = Date.now): Args {
  const apply = argv.includes("--delete");
  const index = argv.indexOf("--since");
  if (index === -1) {
    return { since: new Date(now() - DEFAULT_SINCE_HOURS * 60 * 60 * 1000), apply };
  }
  const raw = argv[index + 1];
  const since = new Date(raw ?? "");
  if (!raw || Number.isNaN(since.getTime())) {
    throw new Error(`--since needs a date I can parse, for example --since 2026-09-19`);
  }
  return { since, apply };
}

async function main() {
  const { since, apply } = parseArgs(process.argv.slice(2));
  const config = getConfig();

  if (config.providerMode !== "real") {
    // Only a real run creates assets worth deleting, and the credentials in a fake-mode
    // environment may well point somewhere else entirely.
    throw new Error(`PROVIDER_MODE is "${config.providerMode}"; run this against a real one.`);
  }

  const getDb = await createDbGetter(config.mongodb.uri, config.mongodb.dbName);
  const db = await getDb();
  const documents = await db
    .collection(COLLECTIONS.sources)
    .find({ createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .toArray();

  const candidates: Candidate[] = documents.map((document) => ({
    _id: document._id,
    id: String(document._id),
    createdAt: document.createdAt as Date,
    uploadcareUuid: String(document.uploadcareUuid),
    cloudinaryPublicId: String(document.cloudinaryPublicId),
  }));

  console.log(
    `${candidates.length} source(s) in "${config.mongodb.dbName}" created since ${since.toISOString()}:`,
  );
  for (const candidate of candidates) {
    console.log(
      `  ${candidate.createdAt.toISOString()}  ${candidate.id}  uploadcare=${candidate.uploadcareUuid}  cloudinary=${candidate.cloudinaryPublicId}`,
    );
  }
  if (candidates.length === 0) return;

  if (!apply) {
    console.log("\nDry run — nothing was deleted. Re-run with --delete to remove these.");
    return;
  }

  const authSchema = new UploadcareSimpleAuthSchema(config.uploadcare);
  // The adapter passes credentials per call to keep the server runtime free of global
  // state; a one-shot script has no such concern, and destroy() takes no credentials.
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
  // Re-sending the same upload reuses one Uploadcare file across several sources (the
  // behaviour F.2 covers), so its uuid is not ours to delete while any source we are
  // keeping still points at it. Cloudinary public ids are one per source, so they need no
  // such check.
  const shared = await db.collection(COLLECTIONS.sources).distinct("uploadcareUuid", {
    uploadcareUuid: { $in: [...new Set(candidates.map((c) => c.uploadcareUuid))] },
    _id: { $nin: candidates.map((c) => c._id) },
  });
  const keep = new Set(shared.map(String));
  const done = new Set<string>();

  let removed = 0;
  for (const candidate of candidates) {
    // Providers first, database row last: a failure part-way leaves the row behind as the
    // only remaining record of what still needs clearing. Dropping the row first would
    // strand the provider assets with nothing pointing at them.
    try {
      await cloudinary.uploader.destroy(candidate.cloudinaryPublicId, {
        resource_type: "video",
        invalidate: true,
      });
      const uuid = candidate.uploadcareUuid;
      if (keep.has(uuid)) {
        console.log(`  keeping uploadcare ${uuid} — a source outside this window uses it`);
      } else if (!done.has(uuid)) {
        await deleteFile({ uuid }, { authSchema });
        done.add(uuid);
      }
      await db.collection(COLLECTIONS.sources).deleteOne({ _id: candidate._id });
      removed += 1;
      console.log(`removed ${candidate.id}`);
    } catch (error: unknown) {
      console.error(`failed on ${candidate.id} — stopping so nothing is half-removed:`, error);
      break;
    }
  }
  console.log(`\nRemoved ${removed} of ${candidates.length} source(s).`);
}

// Guarded so the argument parser above can be imported by a test without the script
// connecting to the database and talking to both providers on import.
if (process.argv[1] === import.meta.filename) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => closeDbClient());
}
