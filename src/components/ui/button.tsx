import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Figma "Button" (4:32): an organic pill with a Caprasimo label. Primary is an
// accent-strong fill with a cream label (5.72:1), secondary a divider outline,
// ghost accent-strong text on its own. The vertical padding comes from
// --btn-py, which globals.css swaps at the tablet breakpoint so phone buttons
// clear 44px without making desktop ones tall.
const buttonVariants = cva(
  "focus-ring group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill border bg-clip-padding font-display whitespace-nowrap transition-colors select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent-strong text-bg hover:bg-accent-800",
        outline: "border-divider text-foreground hover:bg-neutral-100",
        secondary: "border-divider bg-neutral-100 text-foreground hover:bg-neutral-200",
        ghost: "border-transparent text-accent-strong hover:bg-accent-100",
        // The design has no red; a blocked or undoing action is carried by the
        // lighter end of the same terracotta ramp.
        destructive: "border-transparent bg-accent-200 text-accent-900 hover:bg-accent-300",
        link: "border-transparent text-accent-strong underline decoration-from-font underline-offset-4",
      },
      size: {
        default: "px-(--btn-px) py-(--btn-py) type-button",
        lg: "px-(--btn-lg-px) py-(--btn-lg-py) type-button-lg",
        sm: "px-3 py-1.5 type-button any-pointer-coarse:min-h-11",
        xs: "px-2.5 py-1 type-tag any-pointer-coarse:min-h-11",
        // Ghost buttons sit flush with the text around them, so they carry the
        // label's own padding rather than a button's.
        ghost: "px-(--btn-ghost-px) py-(--btn-py) type-button",
        icon: "size-11 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-9 [&_svg:not([class*='size-'])]:size-4 any-pointer-coarse:size-11",
      },
    },
    compoundVariants: [
      // A ghost button never has a box to pad, in any size.
      { variant: "ghost", size: "default", className: "px-(--btn-ghost-px)" },
      { variant: "link", size: "default", className: "px-(--btn-ghost-px)" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
