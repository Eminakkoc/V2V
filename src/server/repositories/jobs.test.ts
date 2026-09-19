import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "@/test/mongo";
import { createJobsRepository, type NewJob } from "./jobs";

const { getDb } = setupTestDb();
const jobs = createJobsRepository(getDb);

const input: NewJob = {
  sourceId: "65f000000000000000000001",
  params: { style: "watercolour" },
  status: "processing",
  phase: "submitting",
  deadlineAt: new Date("2026-09-19T12:00:00Z"),
};

describe("jobs repository", () => {
  it("creates a job with only the always-present fields", async () => {
    const created = await jobs.insert("user-1", input);
    const raw = await (await getDb()).collection("jobs").findOne({ _id: new ObjectId(created.id) });
    expect(raw).not.toBeNull();
    expect(raw).not.toHaveProperty("magicHourId");
    expect(raw).not.toHaveProperty("completedAt");
    expect(created.createdAt).toEqual(created.updatedAt);
    expect(await jobs.findById("user-1", created.id)).toEqual(created);
  });

  it("rejects null for optional fields", async () => {
    await expect(
      jobs.insert("user-1", { ...input, magicHourId: null } as unknown as NewJob),
    ).rejects.toThrow();
  });

  it("rejects an unknown status", async () => {
    await expect(
      jobs.insert("user-1", { ...input, status: "done" } as unknown as NewJob),
    ).rejects.toThrow();
  });

  it("scopes reads by user", async () => {
    const created = await jobs.insert("user-1", input);
    expect(await jobs.findById("user-2", created.id)).toBeNull();
  });
});
