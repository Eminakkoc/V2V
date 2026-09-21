import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Two Figma components share one implementation because they differ only in scale; neither carries
// meaning in colour alone, which is why the status sizes always render an icon.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-pill border [&>svg]:pointer-events-none [&>svg]:size-3.5 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-neutral-100 text-neutral-800",
        accent: "border-transparent bg-accent-100 text-accent-800",
        accent2: "border-transparent bg-accent2-100 text-accent2-800",
        error: "border-transparent bg-accent-200 text-accent-900",
        // An outline rather than a fill, so a job that is still running never reads as finished.
        waiting: "border-accent-strong text-accent-strong",
      },
      size: {
        tag: "px-(--tag-px) py-(--tag-py) type-tag whitespace-nowrap",
        status: "px-(--badge-px) py-(--badge-py) type-caption",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "tag",
    },
  }
)

function Badge({
  className,
  tone = "neutral",
  size = "tag",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-tone={tone}
      className={cn(badgeVariants({ tone, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
