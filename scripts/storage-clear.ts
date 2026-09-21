// Clears everything this app stored, in both providers and in MongoDB. Enumerates the providers
// themselves rather than the database, so a file orphaned by a half-finished upload goes too.
// Dry run by default; pass --delete to remove anything: pnpm storage:clear [--delete]
//
// Only the Cloudinary folders this app writes are touched. Anything else in the account -- the
// `samples/` assets a new one ships with, for instance -- is left alone.
import { deleteFiles, UploadcareSimpleAuthSchema } from "@uploadcare/rest-client";
import { v2 as cloudinary } from "cloudinary";
import { getConfig } from "@/config/env";
import { COLLECTIONS } from "@/server/repositories/collections";
import { closeDbClient, createDbGetter } from "@/server/repositories/mongo-client";
import { cloudinaryVideos, megabytes, storedUploadcareFiles } from "./storage-stores";

// Both providers cap a batch delete at 100 ids per call.
const BATCH = 100;

async function main() {
  const apply = process.argv.includes("--delete");
  const config = getConfig();
  if (config.providerMode !== "real") {
    throw new Error(`PROVIDER_MODE is "${config.providerMode}"; run this against a real one.`);
  }

  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
  const authSchema = new UploadcareSimpleAuthSchema(config.uploadcare);

  const { ours, others } = await cloudinaryVideos();
  const files = await storedUploadcareFiles(authSchema);
  const getDb = await createDbGetter(config.mongodb.uri, config.mongodb.dbName);
  const db = await getDb();

  console.log(`cloudinary ${config.cloudinary.cloudName}: ${ours.length} video(s) in our folders`);
  for (const video of ours) console.log(`  ${video.publicId}  ${megabytes(video.bytes)}`);
  for (const [folder, entry] of [...others].sort()) {
    console.log(`  leaving ${entry.count} file(s) in ${folder} alone -- not written by this app`);
  }
  console.log(`\nuploadcare: ${files.length} stored file(s)`);
  console.log(`\nmongo ${config.mongodb.dbName}:`);
  for (const name of Object.values(COLLECTIONS)) {
    console.log(`  ${name.padEnd(16)} ${await db.collection(name).countDocuments()} document(s)`);
  }

  if (!apply) {
    console.log("\nDry run -- nothing was deleted. Re-run with --delete to clear all of it.");
    return;
  }

  console.log("\ndeleting...");
  // Providers first, database last: a failure part-way through leaves the rows as the record of
  // what is still out there, which is the order cleanup-manual-test-assets.ts uses too.
  for (let i = 0; i < ours.length; i += BATCH) {
    const batch = ours.slice(i, i + BATCH).map((video) => video.publicId);
    await cloudinary.api.delete_resources(batch, { resource_type: "video", invalidate: true });
    console.log(`  cloudinary: deleted ${batch.length}`);
  }
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH).map((file) => file.uuid);
    await deleteFiles({ uuids: batch }, { authSchema });
    console.log(`  uploadcare: deleted ${batch.length}`);
  }
  for (const name of Object.values(COLLECTIONS)) {
    const { deletedCount } = await db.collection(name).deleteMany({});
    console.log(`  mongo ${name}: deleted ${deletedCount}`);
  }
  console.log("\nDone. The indexes are untouched, so nothing needs re-creating.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDbClient());
