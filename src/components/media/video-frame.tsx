import type * as React from "react";
import { cn } from "@/lib/utils";

// Figma "Poster" (5:31) and "Inline player" (16:458). Both are the same frame:
// radius/lg, a neutral-300 bed while the poster loads, and pills pinned over
// it. User media is deliberately shown unfiltered so colours can be judged
// (F23).

function Pill({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-10 inline-flex items-center rounded-pill bg-scrim px-2 py-0.5 type-tag text-bg",
        className,
      )}
      {...props}
    />
  );
}

type VideoFrameProps = {
  className?: string;
  // Shown top-left; names which video this is ("Source", "Result").
  label?: string;
  // Shown bottom-right as m:ss.
  duration?: string;
  children: React.ReactNode;
};

export function VideoFrame({ className, label, duration, children }: VideoFrameProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-lg bg-neutral-300 [&>video]:size-full [&>video]:object-cover",
        className,
      )}
    >
      {label ? <Pill className="top-2.5 left-2.5 px-3 py-[3px]">{label}</Pill> : null}
      {children}
      {duration ? <Pill className="right-2 bottom-2">{duration}</Pill> : null}
    </div>
  );
}
