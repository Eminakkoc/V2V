import { VideoFrame } from "@/components/media/video-frame";
import { posterAtWidth, posterUrl } from "@/lib/cloudinary-urls";
import { cn } from "@/lib/utils";

type MediaProjection = { cloudinaryPublicId: string; cloudinaryUrl: string };

// Requested at the frame's own rendered width, not the viewport's.
const POSTER_WIDTH = 480;

type VideoPairProps = {
  name: string;
  cloudName: string;
  // `undefined` skips the Source column entirely -- used when this pair
  // belongs to a nested "Previous attempts" card, which shares its source
  // with the owning job and has no source data of its own (AttemptView
  // carries no `source` field). Repeating the owner's player there, or
  // worse claiming the source is unavailable, would misstate the data.
  // `null` is the real "gone" case: `job.source` came back null from the
  // API because the source record itself no longer exists.
  source: MediaProjection | null | undefined;
  output: MediaProjection | undefined;
  // Sizing for each frame. History cards use a fixed 200 x 124 thumbnail;
  // the create-page job card uses a pair of tall, equal-width players.
  frameClassName?: string;
};

function VideoPlayer({
  label,
  name,
  cloudName,
  media,
  className,
}: {
  label: string;
  name: string;
  cloudName: string;
  media: MediaProjection;
  className?: string;
}) {
  const poster = posterAtWidth(posterUrl(cloudName, media.cloudinaryPublicId), POSTER_WIDTH);

  return (
    <VideoFrame label={label} className={className}>
      <video
        aria-label={`${label}: ${name}`}
        src={media.cloudinaryUrl}
        poster={poster}
        controls
        playsInline
        muted
        preload="none"
      />
    </VideoFrame>
  );
}

export function VideoPair({
  name,
  cloudName,
  source,
  output,
  frameClassName = "h-[124px] w-full sm:w-[200px]",
}: VideoPairProps) {
  if (source === undefined && !output) return null;

  return (
    <div className="flex shrink-0 gap-3">
      {source === undefined ? null : source ? (
        <VideoPlayer
          label="Source"
          name={name}
          cloudName={cloudName}
          media={source}
          className={cn("flex-1", frameClassName)}
        />
      ) : (
        <div
          className={cn(
            "flex flex-1 items-center justify-center rounded-lg bg-neutral-300 p-3 text-center type-caption text-muted-foreground",
            frameClassName,
          )}
        >
          Source unavailable
        </div>
      )}
      {output ? (
        <VideoPlayer
          label="Result"
          name={name}
          cloudName={cloudName}
          media={output}
          className={cn("flex-1", frameClassName)}
        />
      ) : null}
    </div>
  );
}
