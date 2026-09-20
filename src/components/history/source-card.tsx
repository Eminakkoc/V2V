import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { posterAtWidth, posterUrl } from "@/lib/cloudinary-urls";
import { formatDuration, formatTimestamp } from "@/lib/format";
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

// One row of the Uploaded videos tab (section 7): poster, duration, upload
// date and how many transformations exist from this source, plus a
// "Transform" button that hands the source straight to Create (no
// re-upload). Deliberately no delete affordance -- deletion is out of
// scope this cycle, and the Figma design's disabled delete button is not
// built here even though the design shows one.
export function SourceCard({ source, cloudName }: SourceCardProps) {
  const poster = posterUrl(cloudName, source.cloudinaryPublicId);

  return (
    <div className="@container flex flex-col gap-3 rounded-xl border p-4 @sm:flex-row @sm:items-center">
      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-muted @sm:w-48">
        <Image
          src={poster}
          loader={posterLoader}
          fill
          sizes="(min-width: 640px) 192px, 100vw"
          className="object-cover"
          // Derived from the upload itself (1.1.1): duration and date are
          // repeated as text below, so this isn't purely decorative, but it
          // also isn't the reader's only way to reach that information.
          alt={`Video uploaded ${formatTimestamp(source.createdAt)}, ${formatDuration(source.duration)} long`}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <p className="text-sm text-foreground">{formatDuration(source.duration)}</p>
        <p className="text-sm text-muted-foreground">
          Uploaded <time dateTime={source.createdAt}>{formatTimestamp(source.createdAt)}</time>
        </p>
        <p className="text-sm text-muted-foreground">
          {transformCountLabel(source.transformCount)}
        </p>
      </div>
      <Link
        href={`/?sourceId=${source.id}`}
        className={buttonVariants({ variant: "outline", className: "shrink-0" })}
      >
        Transform
      </Link>
    </div>
  );
}
