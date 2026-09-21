import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { CreateFlow } from "@/components/create/create-flow";
import { posterUrl } from "@/lib/cloudinary-urls";
import type { UploadResponse } from "@/lib/upload-contract";
import { getServerDeps, type ServerDeps } from "@/server/deps";
import type { Source } from "@/server/repositories/sources";
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

// sourceId arrives on the URL (the History page's "Transform" link), so it is
// unproven user input -- never trusted directly. Identity is resolved the
// same read-only way the History page does (verifyIdentity, not
// hasFreshIdentity: a cookie past its 30-day renewal still names a real user,
// and a Server Component render cannot write the renewed cookie itself), and
// the source is re-read through the owner-scoped sourcesRepository.findById.
// An id that doesn't resolve -- missing, malformed, unknown or belonging to
// someone else -- falls back to null here, which every caller below turns
// into the ordinary empty upload state with no error: a stale or shared link
// looks like a fresh visit, never a failure that would also leak whether the
// id exists for another account.
//
// This is the page's only blocking read, and it touches the database only
// when the URL actually carries a sourceId -- on an ordinary visit it settles
// without a round trip. The aside's "does this account have uploads" read,
// which has no such escape, streams in separately below.
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

export default async function CreatePage({ searchParams }: CreatePageProps) {
  const deps = getServerDeps();
  const { uploadcare, upload, maxClipSeconds, cloudinary } = deps.config;
  const params = await searchParams;
  const initialSource = await resolveInitialSource(params.sourceId, deps);

  return (
    // The page gutter and vertical rhythm of the Figma Create frames; the page
    // title itself belongs to CreateFlow, which shows it only while nothing
    // has been uploaded (the configure screen's heading is the file name).
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
        // No skeleton: the card is an optional extra that often resolves to
        // nothing at all, and reserving space for something that may never
        // arrive would shift the aside once the answer came back.
        reuseCard={
          <Suspense fallback={null}>
            <ReuseCard />
          </Suspense>
        }
      />
    </div>
  );
}
