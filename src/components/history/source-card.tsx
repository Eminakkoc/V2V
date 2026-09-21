import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { VideoFrame } from "@/components/media/video-frame";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { posterAtWidth, posterUrl } from "@/lib/cloudinary-urls";
import { formatBytes, formatDuration, formatTimestamp } from "@/lib/format";
import type { SourceView } from "@/lib/history-contract";

// Same pattern as source-summary.tsx: a custom loader hands the request to
// Cloudinary's own resize transformation instead of Next's image optimizer,
// so no remotePatterns entry is needed for the Cloudinary delivery domain.
const posterLoader = ({ src, width }: ImageLoaderProps) => posterAtWidth(src, width);

function transformCountLabel(count: number): string {
  if (count === 0) return "No transformations yet";
  return count === 1 ? "1 transformation" : `${count} transformations`;
}

export type SourceCardProps = {
  source: SourceView;
  cloudName: string;
};

// Figma "Upload card" (57:2496): one tile of the Uploaded videos grid --
// poster with its duration pill, title, metadata, transformation count and
// Transform. The design also shows a delete button; deletion is out of scope
// this cycle, so it is not built here.
//
// The design titles each card with the original file name. Sources do not
// store one (only the container format), so the format stands in -- the same
// fallback the create page's file header uses.
export function SourceCard({ source, cloudName }: SourceCardProps) {
  const poster = posterUrl(cloudName, source.cloudinaryPublicId);
  const uploaded = formatTimestamp(source.createdAt);

  return (
    <article className="flex h-full flex-col gap-3 rounded-card bg-surface p-4 shadow-sm">
      <VideoFrame duration={formatDuration(source.duration)} className="h-[150px] w-full">
        <Image
          src={poster}
          loader={posterLoader}
          fill
          sizes="(min-width: 1024px) 380px, (min-width: 640px) 470px, 100vw"
          className="object-cover"
          // Derived from the upload itself (1.1.1): duration and date are
          // repeated as text below, so this isn't purely decorative, but it
          // also isn't the reader's only way to reach that information.
          alt={`Video uploaded ${uploaded}, ${formatDuration(source.duration)} long`}
        />
      </VideoFrame>

      <h3 className="truncate type-h5">{source.format.toUpperCase()} video</h3>
      <p className="type-tag text-muted-foreground">
        Uploaded <time dateTime={source.createdAt}>{uploaded}</time> · {formatBytes(source.bytes)} ·{" "}
        {source.width} × {source.height}
      </p>
      <Badge tone={source.transformCount > 0 ? "accent2" : "neutral"}>
        {transformCountLabel(source.transformCount)}
      </Badge>

      <Link
        href={`/?sourceId=${source.id}`}
        className={buttonVariants({ className: "mt-auto w-full" })}
      >
        Transform
      </Link>
    </article>
  );
}
