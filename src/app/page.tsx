import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { CreateFlow } from "@/components/create/create-flow";
import { posterUrl } from "@/lib/cloudinary-urls";
import type { HistoryJobView } from "@/lib/history-contract";
import type { UploadResponse } from "@/lib/upload-contract";
import { getServerDeps, type ServerDeps } from "@/server/deps";
import type { Source } from "@/server/repositories/sources";
import { listHistory, parseHistoryQuery } from "@/server/services/history";
import { IDENTITY_COOKIE, verifyIdentity } from "@/server/services/identity";
import { ReuseCard } from "./reuse-card";

export const metadata: Metadata = { title: "Create" };

type CreatePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toUploadResponse(source: Source, cloudName: string): UploadResponse {
  return {
    sourceId: source.id,
    sourceVideo: {
      cloudinaryPublicId: source.cloudinaryPublicId,
      cloudinaryUrl: source.cloudinaryUrl,
      format: source.format,
      bytes: source.bytes,
      duration: source.duration,
      width: source.width,
      height: source.height,
    },
    posterUrl: posterUrl(cloudName, source.cloudinaryPublicId),
  };
}

// sourceId arrives on the URL, so it is re-read through the owner-scoped findById; an id that is
// missing, malformed, unknown or someone else's falls back to null, which every caller turns into
// the ordinary empty upload state rather than leaking whether it exists for another account.
async function resolveInitialSource(
  rawSourceId: string | string[] | undefined,
  deps: ServerDeps,
): Promise<UploadResponse | null> {
  const sourceId = Array.isArray(rawSourceId) ? rawSourceId.at(-1) : rawSourceId;
  if (!sourceId) return null;
  const userId = verifyIdentity(
    (await cookies()).get(IDENTITY_COOKIE)?.value,
    deps.config.sessionCookieSecret,
  )?.userId;
  if (!userId) return null;
  const source = await deps.sources.findById(userId, sourceId);
  return source ? toUploadResponse(source, deps.config.cloudinary.cloudName) : null;
}

// The newest job on the account: the shared poll carries only rows that can still change.
async function latestJob(deps: ServerDeps): Promise<HistoryJobView | null> {
  const userId = verifyIdentity(
    (await cookies()).get(IDENTITY_COOKIE)?.value,
    deps.config.sessionCookieSecret,
  )?.userId;
  if (!userId) return null;
  const data = await listHistory(parseHistoryQuery({ limit: "1" }), userId, deps);
  return "active" in data ? (data.items[0] ?? null) : null;
}

export default async function CreatePage({ searchParams }: CreatePageProps) {
  const deps = getServerDeps();
  const { uploadcare, upload, maxClipSeconds, cloudinary } = deps.config;
  const params = await searchParams;
  // Two independent reads, so they go out together rather than one after the other.
  const [initialSource, initialJob] = await Promise.all([
    resolveInitialSource(params.sourceId, deps),
    latestJob(deps),
  ]);

  return (
    <div className="page-shell pt-(--section-pt) pb-(--section-pb)">
      <CreateFlow
        settings={{
          publicKey: uploadcare.publicKey,
          allowedFormats: upload.allowedFormats,
          maxBytes: upload.maxBytes,
          maxClipSeconds,
          cloudName: cloudinary.cloudName,
        }}
        initialSource={initialSource}
        initialJob={initialJob}
        // No skeleton: the card often resolves to nothing at all, and reserving space would shift
        // the aside once the answer came back.
        reuseCard={
          <Suspense fallback={null}>
            <ReuseCard />
          </Suspense>
        }
      />
    </div>
  );
}
