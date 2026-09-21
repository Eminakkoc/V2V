import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobView } from "@/lib/transform-contract";

const STEPS = ["Uploaded", "Queued", "Rendering", "Saving result", "Complete"] as const;

// Figma "Stepper" (57:2335): Uploaded → Queued → Rendering → Saving result →
// Complete. Returns null for the statuses the design does not step through --
// a failed or abandoned job has no position on this line, and showing one
// would claim progress that is not happening.
function activeStep(job: Pick<JobView, "status" | "phase">): number | null {
  switch (job.status) {
    case "processing":
      return job.phase === "rendering" ? 2 : 1;
    case "finalizing":
      return 3;
    case "complete":
      return 4;
    default:
      return null;
  }
}

export function Stepper({ job }: { job: Pick<JobView, "status" | "phase"> }) {
  const active = activeStep(job);
  if (active === null) return null;

  // A complete job has finished its last step, not merely arrived at it, so
  // "Complete" takes the same green check as the four before it. Without this
  // the line ends on a bare current-step disc and reads as still in progress.
  const finished = job.status === "complete";

  return (
    <ol className="flex max-w-(--card-max) flex-col gap-3 sm:flex-row sm:gap-6">
      {STEPS.map((label, index) => {
        const done = index < active || finished;
        const current = index === active;
        return (
          <li key={label} className="flex flex-1 items-center gap-3">
            <span
              aria-hidden
              className={cn(
                "flex size-[26px] shrink-0 items-center justify-center rounded-pill",
                done && "bg-accent2-700 text-bg",
                current && !done && "bg-accent-strong text-bg",
                !done && !current && "border border-divider",
              )}
            >
              {done ? (
                // translate-y: lucide's check spans y 6..17 of a 24 viewBox, so
                // its ink centre is 11.5, not 12. Centring the icon's box would
                // leave the glyph sitting high in the disc; this re-centres the
                // ink, in the icon's own units so it tracks the icon size.
                <Check className="size-3.5 translate-y-[2.08%]" strokeWidth={2.75} aria-hidden />
              ) : null}
            </span>
            <span
              className={cn(
                "type-body-sm",
                current ? "font-semibold text-foreground" : "text-foreground",
                !done && !current && "text-muted-foreground",
              )}
            >
              {label}
              {current ? <span className="sr-only"> (current step)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
