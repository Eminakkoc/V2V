import "server-only";
import { getConfig, type AppConfig } from "@/config/env";
import { createCloudinaryAdapter } from "@/server/providers/cloudinary";
import { createFakeProviders } from "@/server/providers/fakes";
import type { CloudinaryAdapter, Providers, UploadcareAdapter } from "@/server/providers/types";
import { createUploadcareAdapter } from "@/server/providers/uploadcare";
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
  uploadcare: UploadcareAdapter;
  cloudinary: CloudinaryAdapter;
};

type BuildOptions = { getDb?: DbGetter; providers?: Providers };

let deps: ServerDeps | undefined;

function createProviders(config: AppConfig): Providers {
  if (config.providerMode === "fake") return createFakeProviders(config.cloudinary.cloudName);
  return {
    uploadcare: createUploadcareAdapter(config.uploadcare),
    cloudinary: createCloudinaryAdapter(config.cloudinary),
  };
}

export function buildServerDeps(config: AppConfig, options: BuildOptions = {}): ServerDeps {
  const getDb = options.getDb ?? createDbGetter(config.mongodb.uri, config.mongodb.dbName);
  const providers = options.providers ?? createProviders(config);
  return {
    config,
    sources: createSourcesRepository(getDb),
    jobs: createJobsRepository(getDb),
    rateLimiter: createRateLimiter(createRateLimitHitsRepository(getDb)),
    uploadcare: providers.uploadcare,
    cloudinary: providers.cloudinary,
  };
}

export function getServerDeps(): ServerDeps {
  deps ??= buildServerDeps(getConfig());
  return deps;
}

export function setServerDepsForTests(value: ServerDeps | undefined): void {
  deps = value;
}
