import { posterAtWidth, posterUrl } from "@/lib/cloudinary-urls";
import { CopyableUrl } from "./copyable-url";

type MediaProjection = { cloudinaryPublicId: string; cloudinaryUrl: string };

// Requested at the card's own container width (v2v-tailwind's @container
// history-card example), not the viewport's.
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
};

function VideoPlayer({
  label,
  name,
  cloudName,
  media,
}: {
  label: string;
  name: string;
  cloudName: string;
  media: MediaProjection;
}) {
  const poster = posterAtWidth(posterUrl(cloudName, media.cloudinaryPublicId), POSTER_WIDTH);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <video
        aria-label={`${label}: ${name}`}
        className="aspect-video w-full rounded-lg bg-muted"
        src={media.cloudinaryUrl}
        poster={poster}
        controls
        playsInline
        muted
        preload="none"
      />
      <CopyableUrl kind={label.toLowerCase()} url={media.cloudinaryUrl} />
    </div>
  );
}

export function VideoPair({ name, cloudName, source, output }: VideoPairProps) {
  return (
    <div className="grid gap-4 @sm:grid-cols-2">
      {source === undefined ? null : source ? (
        <VideoPlayer label="Source" name={name} cloudName={cloudName} media={source} />
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Source</span>
          <p className="text-sm text-muted-foreground">Source unavailable</p>
        </div>
      )}
      {output ? (
        <VideoPlayer label="Result" name={name} cloudName={cloudName} media={output} />
      ) : null}
    </div>
  );
}
