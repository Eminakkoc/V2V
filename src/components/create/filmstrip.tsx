"use client";

import { useEffect, useRef, useState } from "react";
import { thumbnailTimes } from "@/lib/filmstrip";
import { cn } from "@/lib/utils";

const THUMBNAIL_COUNT = 10;
const THUMBNAIL_WIDTH = 80;
const THUMBNAIL_HEIGHT = 45;

export type FilmstripProps = {
  src: string;
  duration: number;
  className?: string;
};

function waitForEvent(target: EventTarget, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${event} did not fire before the video errored`));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    function cleanup() {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    }
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// A filmstrip behind the trim handles is a progressive enhancement, not part
// of the trimmer's contract: it seeks a hidden, CORS-enabled <video> and
// draws each frame to a <canvas>, which fails outright on some mobile
// browsers and whenever the CDN omits CORS headers. Any failure here -- a
// rejected seek, a missing 2D context, a thrown draw -- just leaves the
// plain fallback track in place; it never surfaces an error or blocks the
// trimmer's own seeking or handles.
export function Filmstrip({ src, duration, className }: FilmstripProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    // A source/duration change starts a brand new extraction; the previous
    // clip's frames must not stay on screen while it runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrames([]);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Cancelled on unmount and on every src/duration change, so a rapid
    // source replace can't leave a stale seek loop writing frames for a clip
    // that is no longer on screen.
    const controller = new AbortController();

    async function extract() {
      try {
        const times = thumbnailTimes(duration, THUMBNAIL_COUNT);
        if (times.length === 0) return;

        if (video!.readyState < HTMLMediaElement.HAVE_METADATA) {
          await waitForEvent(video!, "loadedmetadata", controller.signal);
        }
        const ctx = canvas!.getContext("2d");
        if (!ctx) return;

        const collected: string[] = [];
        for (const time of times) {
          video!.currentTime = time;
          await waitForEvent(video!, "seeked", controller.signal);
          ctx.drawImage(video!, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
          collected.push(canvas!.toDataURL("image/jpeg", 0.6));
        }
        if (!controller.signal.aborted && collected.length > 0) setFrames(collected);
      } catch {
        // Swallowed deliberately -- see the function comment above.
      }
    }

    void extract();
    return () => controller.abort();
  }, [src, duration]);

  return (
    <div className={cn("flex h-full w-full overflow-hidden rounded-md", className)}>
      <video
        ref={videoRef}
        src={src}
        crossOrigin="anonymous"
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        aria-hidden
        className="hidden"
      />
      <canvas
        ref={canvasRef}
        width={THUMBNAIL_WIDTH}
        height={THUMBNAIL_HEIGHT}
        className="hidden"
      />
      {frames.length > 0 ? (
        frames.map((frame, index) => (
          <div
            key={index}
            data-testid="filmstrip-frame"
            className="h-full flex-1 bg-cover bg-center"
            style={{ backgroundImage: `url(${frame})` }}
          />
        ))
      ) : (
        <div data-testid="filmstrip-fallback" className="h-full w-full bg-muted" />
      )}
    </div>
  );
}
