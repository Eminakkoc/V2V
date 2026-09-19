import { beforeEach, describe, expect, it } from "vitest";
import { createRateLimitHitsRepository } from "@/server/repositories/rate-limit-hits";
import { setupTestDb } from "@/test/mongo";
import { createRateLimiter, RATE_LIMITS } from "./rate-limit";

const { getDb } = setupTestDb();
const hits = createRateLimitHitsRepository(getDb);

let clock = new Date("2026-09-19T12:00:00Z");
const tick = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
const limiter = createRateLimiter(hits, () => clock);

beforeEach(async () => {
  clock = new Date("2026-09-19T12:00:00Z");
  await (await getDb()).collection("rateLimitHits").deleteMany({});
});

async function checks(
  count: number,
  scope: "upload" | "signature",
  user: (i: number) => string,
  ip: string,
) {
  for (let i = 0; i < count; i += 1) {
    await limiter.check(scope, user(i), ip);
    tick(1);
  }
}

describe("rate limiter", () => {
  it("allows 10 uploads per user and rejects the 11th with a truthful wait", async () => {
    await checks(RATE_LIMITS.perUser, "upload", () => "user-1", "ip-1");
    const error = await limiter
      .check("upload", "user-1", "ip-1")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 590 });
  });

  it("does not count rejected requests", async () => {
    await checks(RATE_LIMITS.perUser, "upload", () => "user-1", "ip-1");
    await expect(limiter.check("upload", "user-1", "ip-1")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(limiter.check("upload", "user-1", "ip-1")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    clock = new Date(Date.parse("2026-09-19T12:10:00Z") + 1000);
    await expect(limiter.check("upload", "user-1", "ip-1")).resolves.toBeUndefined();
  });

  it("limits one IP to 30 uploads across users", async () => {
    await checks(RATE_LIMITS.perIp, "upload", (i) => `user-${i}`, "shared-ip");
    await expect(limiter.check("upload", "user-new", "shared-ip")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(limiter.check("upload", "user-new", "other-ip")).resolves.toBeUndefined();
  });

  it("keeps separate counters per scope", async () => {
    await checks(RATE_LIMITS.perUser, "upload", () => "user-1", "ip-1");
    await expect(limiter.check("signature", "user-1", "ip-1")).resolves.toBeUndefined();
  });

  it("never lets two simultaneous requests both take the last slot", async () => {
    for (let i = 0; i < 20; i += 1) {
      clock = new Date("2026-09-19T12:00:00Z");
      await (await getDb()).collection("rateLimitHits").deleteMany({});
      await checks(RATE_LIMITS.perUser - 1, "upload", () => "user-1", "ip-1");
      const results = await Promise.allSettled([
        limiter.check("upload", "user-1", "ip-1"),
        limiter.check("upload", "user-1", "ip-1"),
      ]);
      expect(results.filter((result) => result.status === "fulfilled").length).toBeLessThanOrEqual(
        1,
      );
      for (const result of results) {
        if (result.status === "rejected") {
          expect(result.reason).toMatchObject({ code: "RATE_LIMITED" });
        }
      }
    }
  });

  it("admits exactly the 10th sequential request", async () => {
    await checks(RATE_LIMITS.perUser - 1, "upload", () => "user-1", "ip-1");
    await expect(limiter.check("upload", "user-1", "ip-1")).resolves.toBeUndefined();
    await expect(limiter.check("upload", "user-1", "ip-1")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("reports the longer wait when both the per-user and per-ip limits are exceeded", async () => {
    // user-1 fills its own 10-hit budget first, on a private IP, at t=0..9.
    await checks(RATE_LIMITS.perUser, "upload", () => "user-1", "own-ip");
    // 30 other users then fill the shared IP's budget afterwards, at t=10..39, so the
    // IP counter's oldest surviving hit (t=10) is newer than the user counter's (t=0)
    // and therefore has longer left to live in the window: 570s vs 560s.
    await checks(RATE_LIMITS.perIp, "upload", (i) => `user-${i + 2}`, "shared-ip");
    const error = await limiter
      .check("upload", "user-1", "shared-ip")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 570 });
  });
});
