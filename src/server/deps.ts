import "server-only";
import { getConfig, type AppConfig } from "@/config/env";
import { createJobsRepository, type JobsRepository } from "@/server/repositories/jobs";
import { createDbGetter, type DbGetter } from "@/server/repositories/mongo-client";
import { createRateLimitHitsRepository } from "@/server/repositories/rate-limit-hits";
import { createSourcesRepository, type SourcesRepository } from "@/server/repositories/sources";
import { createRateLimiter, type RateLimiter } from "@/server/services/rate-limit";

export type ServerDeps = {
  config: AppConfig;
  sources: SourcesRepository;
  jobs: JobsRepository;
  rateLimiter: RateLimiter;
};

type BuildOptions = { getDb?: DbGetter };

let deps: ServerDeps | undefined;

export function buildServerDeps(config: AppConfig, options: BuildOptions = {}): ServerDeps {
  const getDb = options.getDb ?? createDbGetter(config.mongodb.uri, config.mongodb.dbName);
  return {
    config,
    sources: createSourcesRepository(getDb),
    jobs: createJobsRepository(getDb),
    rateLimiter: createRateLimiter(createRateLimitHitsRepository(getDb)),
  };
}

export function getServerDeps(): ServerDeps {
  deps ??= buildServerDeps(getConfig());
  return deps;
}

export function setServerDepsForTests(value: ServerDeps | undefined): void {
  deps = value;
}
