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
  // Per-thumb overrides (aria-label, aria-valuetext, onKeyDown, ...), indexed
  // to match `value`/`defaultValue`. A generic multi-thumb slider has no way
  // to know what each handle means, so callers with named handles (start/end)
  // supply that here instead of forking the primitive.
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
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-muted data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full"
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
              "relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring transition-[color,box-shadow] select-none after:absolute after:-inset-4 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50",
              thumbClassName
            )}
          />
        )
      })}
    </SliderPrimitive.Root>
  )
}

export { Slider }
