import "server-only";
import { AppError } from "@/server/errors/app-error";
import { RATE_LIMIT_WINDOW_SECONDS } from "@/server/repositories/indexes";
import type { RateLimitHitsRepository } from "@/server/repositories/rate-limit-hits";

export type RateLimitScope = "upload" | "signature";

export const RATE_LIMITS = { perUser: 10, perIp: 30 } as const;

export type RateLimiter = {
  check(scope: RateLimitScope, userId: string, ip: string): Promise<void>;
};

const WINDOW_MS = RATE_LIMIT_WINDOW_SECONDS * 1000;

export function createRateLimiter(
  hits: RateLimitHitsRepository,
  now: () => Date = () => new Date(),
): RateLimiter {
  return {
    async check(scope, userId, ip) {
      const at = now();
      const since = new Date(at.getTime() - WINDOW_MS);
      const counters = [
        { key: `${scope}:user:${userId}`, limit: RATE_LIMITS.perUser },
        { key: `${scope}:ip:${ip}`, limit: RATE_LIMITS.perIp },
      ];
      // Each request records its hit first and then checks its place in line, so two
      // simultaneous requests can never both take the last slot.
      const recorded = await Promise.all(
        counters.map(async (counter) => ({
          ...counter,
          hitId: await hits.record(counter.key, at),
        })),
      );
      const ranked = await Promise.all(
        recorded.map(async (counter) => ({
          ...counter,
          rank: await hits.rank(counter.key, counter.hitId, since),
        })),
      );
      const exceeded = ranked.find((counter) => counter.rank > counter.limit);
      if (!exceeded) return;

      await hits.remove(ranked.map((counter) => counter.hitId));
      const oldest = await hits.oldestSince(exceeded.key, since);
      const retryAfterSeconds = oldest
        ? Math.max(1, Math.ceil((oldest.getTime() + WINDOW_MS - at.getTime()) / 1000))
        : 1;
      throw new AppError("RATE_LIMITED", { retryAfterSeconds, details: { retryAfterSeconds } });
    },
  };
}
