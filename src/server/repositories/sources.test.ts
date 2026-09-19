import { describe, expect, it } from "vitest";
import { useTestDb } from "@/test/mongo";
import { createSourcesRepository, type NewSource } from "./sources";

const { getDb } = useTestDb();
const sources = createSourcesRepository(getDb);

const input: NewSource = {
  uploadcareUuid: "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a",
  uploadcareCdnUrl: "https://ucarecdn.com/3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a/",
  cloudinaryPublicId: "sources/abc",
  cloudinaryUrl: "https://res.cloudinary.com/test-cloud/video/upload/v1/sources/abc.mov",
  format: "mov",
  bytes: 1000,
  duration: 12.5,
  width: 1080,
  height: 1920,
};

describe("sources repository", () => {
  it("inserts and reads back a plain record for its owner", async () => {
    const created = await sources.insert("user-1", input);
    expect(created).toMatchObject({ ...input, userId: "user-1", schemaVersion: 1 });
    expect(typeof created.id).toBe("string");
    expect(created).not.toHaveProperty("_id");
    expect(await sources.findById("user-1", created.id)).toEqual(created);
  });

  it("scopes reads by user", async () => {
    const created = await sources.insert("user-1", input);
    expect(await sources.findById("user-2", created.id)).toBeNull();
  });

  it("returns null for a malformed id", async () => {
    expect(await sources.findById("user-1", "not-an-id")).toBeNull();
  });

  it("refuses an invalid record on write", async () => {
    await expect(sources.insert("user-1", { ...input, bytes: -1 })).rejects.toThrow();
  });

  it("fails loudly when a stored document does not match the schema", async () => {
    const db = await getDb();
    const { insertedId } = await db
      .collection("sources")
      .insertOne({ schemaVersion: 1, userId: "user-1", bytes: "lots" });
    await expect(sources.findById("user-1", insertedId.toHexString())).rejects.toThrow(
      /sources document .* failed validation/,
    );
  });

  it("treats an unknown schema version as invalid", async () => {
    const db = await getDb();
    const created = await sources.insert("user-1", input);
    const { ObjectId } = await import("mongodb");
    await db
      .collection("sources")
      .updateOne({ _id: new ObjectId(created.id) }, { $set: { schemaVersion: 2 } });
    await expect(sources.findById("user-1", created.id)).rejects.toThrow(/failed validation/);
  });
});
