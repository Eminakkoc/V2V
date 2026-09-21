import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// The vertical padding comes from --btn-py, which globals.css swaps at the tablet breakpoint so
// phone buttons clear 44px without making desktop ones tall.
const buttonVariants = cva(
  "focus-ring group/button inline-flex shrink-0 items-center justify-center gap-1.5 cursor-pointer rounded-pill border bg-clip-padding font-display whitespace-nowrap transition-colors select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent-strong text-bg hover:bg-accent-800",
        outline: "border-input text-foreground hover:bg-neutral-100",
        secondary: "border-input bg-neutral-100 text-foreground hover:bg-neutral-200",
        // --input, the border every select and text field already carries, rather than the lighter
        // --divider that rules and card edges use: at 16% alpha the outline read as bare text
        // beside a filled button, which is what made "Restyle again" look unpadded next to
        // "Download". One border colour now covers every bordered control on the page.
        ghost: "border-input text-accent-strong hover:bg-accent-100",
        // The design has no red; a blocked or undoing action is carried by the lighter end of the
        // same terracotta ramp.
        destructive: "border-transparent bg-accent-200 text-accent-900 hover:bg-accent-300",
        link: "border-transparent text-accent-strong underline decoration-from-font underline-offset-4",
      },
      size: {
        default: "px-(--btn-px) py-(--btn-py) type-button",
        lg: "px-(--btn-lg-px) py-(--btn-lg-py) type-button-lg",
        sm: "px-3 py-1.5 type-button any-pointer-coarse:min-h-11",
        xs: "px-2.5 py-1 type-tag any-pointer-coarse:min-h-11",
        icon: "size-11 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-9 [&_svg:not([class*='size-'])]:size-4 any-pointer-coarse:size-11",
      },
    },
    compoundVariants: [
      // Only the link variant still sits flush with the text around it, which is what
      // --btn-ghost-px is now for; a ghost button takes a border and a button's own padding.
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
