// Read-only census of everything the app has stored across MongoDB, Cloudinary and Uploadcare.
// Deletes nothing: pnpm storage:inventory
import { UploadcareSimpleAuthSchema } from "@uploadcare/rest-client";
import { v2 as cloudinary } from "cloudinary";
import { getConfig } from "@/config/env";
import { COLLECTIONS } from "@/server/repositories/collections";
import { closeDbClient, createDbGetter } from "@/server/repositories/mongo-client";
import { cloudinaryVideos, folderOf, megabytes, storedUploadcareFiles } from "./storage-stores";

async function main() {
  const config = getConfig();
  console.log(`mongo db   : ${config.mongodb.dbName}`);
  console.log(`cloudinary : ${config.cloudinary.cloudName}\n`);

  const getDb = await createDbGetter(config.mongodb.uri, config.mongodb.dbName);
  const db = await getDb();
  console.log("== MongoDB ==");
  for (const name of Object.values(COLLECTIONS)) {
    console.log(`  ${name.padEnd(16)} ${await db.collection(name).countDocuments()}`);
  }
  const byStatus = await db
    .collection(COLLECTIONS.jobs)
    .aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  if (byStatus.length > 0) {
    console.log(`  jobs by status : ${byStatus.map((r) => `${String(r._id)}=${r.n}`).join(", ")}`);
  }
  console.log(
    `  distinct users : ${(await db.collection(COLLECTIONS.sources).distinct("userId")).length}`,
  );

  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
  console.log("\n== Cloudinary (video resources) ==");
  const { ours, others } = await cloudinaryVideos();
  const perFolder = new Map<string, { count: number; bytes: number }>();
  for (const video of ours) {
    const entry = perFolder.get(folderOf(video.publicId)) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += video.bytes;
    perFolder.set(folderOf(video.publicId), entry);
  }
  for (const [folder, entry] of [...perFolder].sort()) {
    console.log(
      `  ${folder.padEnd(16)} ${entry.count} file(s), ${megabytes(entry.bytes)}  <- ours`,
    );
  }
  for (const [folder, entry] of [...others].sort()) {
    console.log(`  ${folder.padEnd(16)} ${entry.count} file(s), ${megabytes(entry.bytes)}`);
  }
  console.log(
    `  ours total       ${ours.length} file(s), ${megabytes(ours.reduce((sum, v) => sum + v.bytes, 0))}`,
  );
  const usage = await cloudinary.api.usage();
  console.log(
    `  plan usage: storage ${megabytes(Number(usage.storage?.usage ?? 0))}, ` +
      `credits ${usage.credits?.usage ?? "?"} / ${usage.credits?.limit ?? "?"} ` +
      `(Cloudinary recomputes this periodically, so it lags a delete)`,
  );

  console.log("\n== Uploadcare ==");
  const files = await storedUploadcareFiles(new UploadcareSimpleAuthSchema(config.uploadcare));
  console.log(
    `  stored files     ${files.length}, ${megabytes(files.reduce((sum, f) => sum + f.bytes, 0))}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDbClient());
