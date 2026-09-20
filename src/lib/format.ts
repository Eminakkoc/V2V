const FORMAT_LABELS: Record<string, string> = {
  "video/mp4": "MP4",
  "video/quicktime": "MOV",
  "video/webm": "WebM",
};

function trimmed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${trimmed(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${trimmed(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${trimmed(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

// Fixed locale and fixed UTC timezone, not the runtime's own -- an absolute
// timestamp formatted from the runtime's locale/timezone would render
// differently on the server (SSR) than in the browser (hydration) depending
// on where each happens to run, and a relative form ("8s ago") would need
// the live-region-and-never-tick discipline docs/design-findings.md W5
// requires. This sidesteps both by being the same string everywhere.
//
// `timeZoneName: "short"` is what makes pinning the zone to UTC acceptable
// rather than misleading: without a visible "UTC" label the string reads as
// the reader's own local time, and on a History page that can misstate
// which calendar day a job belongs to. Do not strip it as noise -- it is
// the fix for that, not decoration. (It also forces the explicit
// year/month/day/hour/minute fields below: `Intl.DateTimeFormat` rejects
// `timeZoneName` combined with `dateStyle`/`timeStyle`.)
const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function formatTimestamp(iso: string): string {
  return TIMESTAMP_FORMATTER.format(new Date(iso));
}

export function describeFormats(mimeTypes: readonly string[]): string {
  const labels = mimeTypes.map(
    (type) => FORMAT_LABELS[type] ?? (type.split("/")[1] ?? type).toUpperCase(),
  );
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}
