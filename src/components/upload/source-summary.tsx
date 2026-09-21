"use client";

import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration } from "@/lib/format";
import type { UploadResponse } from "@/lib/upload-contract";

type SourceSummaryProps = {
  result: UploadResponse;
  // The picked file's own name. Absent when the source was restored from
  // History rather than uploaded in this session, in which case the format
  // stands in for it.
  fileName?: string | null;
  onReplace: () => void;
};

// Figma "File header" (55:1822): the selected source's name is the page's own
// heading on the configure screen, with its metadata beneath and Replace video
// aligned to the right.
export function SourceSummary({ result, fileName, onReplace }: SourceSummaryProps) {
  const { sourceVideo } = result;
  const meta = [
    sourceVideo.format.toUpperCase(),
    formatBytes(sourceVideo.bytes),
    `${sourceVideo.width} × ${sourceVideo.height}`,
    formatDuration(sourceVideo.duration),
  ].join(" · ");

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <h2 id="source-summary-title" className="truncate type-h3">
          {fileName ?? `${sourceVideo.format.toUpperCase()} video`}
        </h2>
        <p className="type-caption text-muted-foreground">{meta}</p>
      </div>
      <Button type="button" variant="ghost" size="ghost" onClick={onReplace}>
        Replace video
      </Button>
    </div>
  );
}
