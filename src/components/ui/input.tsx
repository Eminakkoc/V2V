import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "focus-ring-flush w-full min-w-0 rounded-pill border border-input bg-surface px-(--input-px) py-(--input-py) type-input text-foreground transition-colors any-pointer-coarse:min-h-11 placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-accent-900",
        className
      )}
      {...props}
    />
  )
}

export { Input }
