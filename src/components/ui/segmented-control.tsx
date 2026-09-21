"use client";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  name: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  className?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
};

// Built on native radio inputs rather than a roving-tabindex widget, so arrow-key navigation,
// radiogroup semantics and form participation all come from the platform.
export function SegmentedControl<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled = false,
  className,
  "aria-labelledby": labelledBy,
  "aria-label": label,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={label}
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-pill border border-divider",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative flex flex-1 items-center justify-center border-l border-divider px-(--seg-px) py-(--seg-py) type-body-sm whitespace-nowrap transition-colors first:border-l-0",
              selected ? "bg-accent-strong text-bg" : "text-foreground hover:bg-neutral-100",
              disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            {/* The segmented control's focus ring is inset rather than
                detached, so it never overlaps the neighbouring option. */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 border-2 border-transparent",
                selected ? "peer-focus-visible:border-bg" : "peer-focus-visible:border-accent-strong",
              )}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
