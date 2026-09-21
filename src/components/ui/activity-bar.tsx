import type * as React from "react";
import { cn } from "@/lib/utils";

// Figma "Activity bar" (16:406). Indeterminate on purpose: Magic Hour reports
// only queued/rendering, never a percentage, so there is no value to show and
// this is deliberately not a progressbar with aria-valuenow -- the phase is
// announced by the status badge instead.
//
// The segment loops continuously for as long as the job is running, so the bar
// keeps reading as "still working" rather than freezing after a few seconds.
// `motion-safe:` is what keeps this within WCAG 2.2.2: a reader who asks for
// reduced motion gets a static bar, never a perpetual animation.
// Decorative by default. The upload wait passes `role="progressbar"` and
// `aria-hidden={undefined}` to expose it as an indeterminate progress bar --
// there it is the only indicator of the wait, whereas on a job card the
// status badge already announces the phase.
export function ActivityBar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      {...props}
      className={cn("h-2 w-full overflow-hidden rounded-pill bg-neutral-300", className)}
    >
      <div className="h-full w-[30%] rounded-pill bg-accent-strong motion-safe:animate-[activity-slide_2.5s_ease-in-out_infinite_alternate]" />
    </div>
  );
}
