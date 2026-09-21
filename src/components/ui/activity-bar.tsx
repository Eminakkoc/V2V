import type * as React from "react";
import { cn } from "@/lib/utils";

// Indeterminate on purpose -- Magic Hour reports no percentage -- and decorative by default, with
// `motion-safe:` keeping the looping segment within WCAG 2.2.2; the upload wait opts into
// `role="progressbar"` because there it is the only indicator.
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
