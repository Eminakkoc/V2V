import "server-only";
import { posterUrl } from "@/lib/cloudinary-urls";
import type { UploadResponse } from "@/lib/upload-contract";
import { createVideoRules } from "@/lib/video-rules";
import type { ServerDeps } from "@/server/deps";
import { AppError } from "@/server/errors/app-error";

export const COPY_BUDGET_MS = 50_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUploadcareCdnHost(host: string): boolean {
  return host === "ucarecdn.com" || host.endsWith(".ucarecdn.com") || host.endsWith(".ucarecd.net");
}

export function parseUploadcareCdnUrl(cdnUrl: string): { uuid: string; canonicalUrl: string } {
  let url: URL;
  try {
    url = new URL(cdnUrl);
  } catch {
    throw new AppError("INVALID_VIDEO_URL");
  }
  const uuid = url.pathname.split("/")[1] ?? "";
  const valid =
    url.protocol === "https:" &&
    isUploadcareCdnHost(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.port &&
    UUID_PATTERN.test(uuid);
  if (!valid) throw new AppError("INVALID_VIDEO_URL");
  const normalized = uuid.toLowerCase();
  return { uuid: normalized, canonicalUrl: `https://${url.hostname}/${normalized}/` };
}

type UploadSourceDeps = Pick<ServerDeps, "config" | "uploadcare" | "cloudinary" | "sources">;

export async function uploadSource(
  { cdnUrl }: { cdnUrl: string },
  userId: string,
  deps: UploadSourceDeps,
  now: () => number = Date.now,
): Promise<UploadResponse> {
  // Anchored before any provider call, so a slow getFileInfo eats into the
  // budget instead of leaving the Cloudinary copy the full COPY_BUDGET_MS
  // regardless of how long the request has already been running.
  const deadline = now() + COPY_BUDGET_MS;
  const { uuid, canonicalUrl } = parseUploadcareCdnUrl(cdnUrl);
  const file = await deps.uploadcare.getFileInfo(uuid);
  const check = createVideoRules(deps.config.upload).checkFile({
    mimeType: file.mimeType,
    size: file.size,
  });
  if (!check.ok) throw new AppError(check.code);

  const video = await deps.cloudinary.copyVideoFromUrl(file.originalFileUrl, {
    expectedBytes: file.size,
    deadline,
  });
  const source = await deps.sources.insert(userId, {
    uploadcareUuid: uuid,
    uploadcareCdnUrl: canonicalUrl,
    cloudinaryPublicId: video.publicId,
    cloudinaryUrl: video.secureUrl,
    format: video.format,
    bytes: video.bytes,
    duration: video.duration,
    width: video.width,
    height: video.height,
  });
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
    posterUrl: posterUrl(deps.config.cloudinary.cloudName, source.cloudinaryPublicId),
  };
}
