"use client"

import * as React from "react"
import { cn } from "cn"
import { Slider as SliderPrimitive } from "radix-ui"

type ThumbProps = React.ComponentProps<typeof SliderPrimitive.Thumb>

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbProps,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  // Per-thumb overrides indexed to match `value`, so callers with named handles can say what each
  // one means without forking the primitive.
  thumbProps?: ThumbProps[]
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-45",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-full w-full grow rounded-sm"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full rounded-sm border-[length:var(--stroke-emphasis)] border-accent-strong bg-selection select-none"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => {
        const { className: thumbClassName, ...thumbOverrides } = thumbProps?.[index] ?? {}
        return (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            {...thumbOverrides}
            className={cn(
              // Height comes from the track token, not 100%: Radix wraps each thumb in an
              // absolutely positioned, auto-height span, against which a percentage collapses the
              // pill to its own borders.
              "focus-ring relative block h-[calc(var(--trim-track-height)+6px)] w-[18px] shrink-0 rounded-pill border-[length:var(--stroke-rule)] border-bg bg-accent-strong shadow-sm select-none after:absolute after:-inset-x-[13px] after:-inset-y-1.5 disabled:pointer-events-none",
              thumbClassName
            )}
          />
        )
      })}
    </SliderPrimitive.Root>
  )
}

export { Slider }
