"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { posterAtWidth } from "@/lib/cloudinary-urls";
import { formatBytes, formatDuration } from "@/lib/format";
import type { UploadResponse } from "@/lib/upload-contract";

const posterLoader = ({ src, width }: ImageLoaderProps) => posterAtWidth(src, width);

type SourceSummaryProps = { result: UploadResponse; onReplace: () => void };

export function SourceSummary({ result, onReplace }: SourceSummaryProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const { sourceVideo } = result;
  const details = [
    ["Format", sourceVideo.format.toUpperCase()],
    ["Size", formatBytes(sourceVideo.bytes)],
    ["Length", formatDuration(sourceVideo.duration)],
    ["Resolution", `${sourceVideo.width} × ${sourceVideo.height}`],
  ] as const;
  return (
    <section
      aria-labelledby="source-summary-title"
      className="flex flex-col gap-4 rounded-xl border p-4"
    >
      <h2 id="source-summary-title" className="text-lg font-medium">
        Uploaded
      </h2>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        {posterFailed ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Preview not available
          </p>
        ) : (
          <Image
            src={result.posterUrl}
            alt="First frame of your video"
            loader={posterLoader}
            fill
            sizes="(min-width: 768px) 736px, 100vw"
            className="object-contain"
            onError={() => setPosterFailed(true)}
          />
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {details.map(([term, value]) => (
          <div key={term}>
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <Button type="button" variant="outline" className="min-h-11 self-start" onClick={onReplace}>
        Upload a different video
      </Button>
    </section>
  );
}
