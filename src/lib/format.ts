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

export function describeFormats(mimeTypes: readonly string[]): string {
  const labels = mimeTypes.map(
    (type) => FORMAT_LABELS[type] ?? (type.split("/")[1] ?? type).toUpperCase(),
  );
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}
