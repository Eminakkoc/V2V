import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "focus-ring-flush flex field-sizing-content min-h-20 w-full rounded-lg border border-input bg-surface px-(--input-px) py-(--input-py) type-input text-foreground transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-accent-900",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
