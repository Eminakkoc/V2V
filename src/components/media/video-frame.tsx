import type * as React from "react";
import { cn } from "@/lib/utils";

// User media is deliberately shown unfiltered so colours can be judged.

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
  label?: string;
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
