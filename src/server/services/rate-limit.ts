import "server-only";
import { AppError } from "@/server/errors/app-error";
import { RATE_LIMIT_WINDOW_SECONDS } from "@/server/repositories/indexes";
import type { RateLimitHitsRepository } from "@/server/repositories/rate-limit-hits";

export type RateLimitScope = "upload" | "signature" | "transform";

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
      // A request passes a counter when the count of every hit visible for its key in the
      // window (its own insert included) is within the limit; whichever of two racing
      // requests counts second also sees the other's hit, so both cannot pass.
      const recorded = await Promise.all(
        counters.map(async (counter) => ({
          ...counter,
          hitId: await hits.record(counter.key, at),
        })),
      );
      const counted = await Promise.all(
        recorded.map(async (counter) => ({
          ...counter,
          count: await hits.countSince(counter.key, since),
        })),
      );
      const exceeded = counted.filter((counter) => counter.count > counter.limit);
      if (exceeded.length === 0) return;

      await hits.remove(counted.map((counter) => counter.hitId));
      // When both the user and IP counters are exceeded at once, Retry-After must be
      // truthful for both, so report the longer of the two waits, not just the first.
      const waits = await Promise.all(
        exceeded.map(async (counter) => {
          const oldest = await hits.oldestSince(counter.key, since);
          return oldest
            ? Math.max(1, Math.ceil((oldest.getTime() + WINDOW_MS - at.getTime()) / 1000))
            : 1;
        }),
      );
      const retryAfterSeconds = Math.max(...waits);
      throw new AppError("RATE_LIMITED", { retryAfterSeconds, details: { retryAfterSeconds } });
    },
  };
}
