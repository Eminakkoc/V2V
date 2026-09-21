"use client";

import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// --touch-row-py is what gives the row a 44px target on phones without padding it out on desktop.
export function Checkbox({
  className,
  children,
  ...props
}: React.ComponentProps<"input"> & { children: React.ReactNode }) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 py-(--touch-row-py) type-body text-foreground",
        props.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative inline-flex size-[18px] shrink-0 items-center justify-center">
        <input
          type="checkbox"
          {...props}
          className="focus-ring peer absolute inset-0 size-full cursor-[inherit] appearance-none rounded-xs border-[length:var(--stroke-control)] border-input transition-colors checked:border-accent-strong checked:bg-accent-strong"
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none relative size-3 text-bg opacity-0 peer-checked:opacity-100"
        />
      </span>
      {children}
    </label>
  );
}
