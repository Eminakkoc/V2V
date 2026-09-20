"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { clampRange, type TrimRange } from "@/lib/trim-range";

// A trim shorter than this reads as a mis-click rather than an intended clip,
// and it keeps the two handles from ever landing on the same value.
const MIN_GAP_SECONDS = 0.1;
// Keyboard granularity for a single Arrow press; Shift+Arrow uses the
// vendored slider's own multiplier on top of this. PageUp/PageDown and
// Home/End are overridden below: Radix's Home/End always target thumb 0 and
// the last thumb respectively, regardless of which one has focus, and its
// PageUp/PageDown jump is 10 * step rather than the fixed figure below.
const STEP_SECONDS = 0.1;
const PAGE_STEP_SECONDS = 5;

export type TrimmerProps = {
  duration: number;
  maxClipSeconds: number;
  value: TrimRange;
  onChange: (next: TrimRange) => void;
  onSeek: (second: number) => void;
  disabled?: boolean;
};

function valueText(seconds: number): string {
  return `${seconds.toFixed(1)} seconds`;
}

// Dragging fires far more pointermove events than a video element needs
// currentTime updates for; this keeps only the latest requested second and
// flushes at most once per animation frame.
function useThrottledSeek(onSeek: (second: number) => void) {
  const frame = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const latestOnSeek = useRef(onSeek);

  useEffect(() => {
    latestOnSeek.current = onSeek;
  }, [onSeek]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return useCallback((second: number) => {
    pending.current = second;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current !== null) latestOnSeek.current(pending.current);
    });
  }, []);
}

export function Trimmer({
  duration,
  maxClipSeconds,
  value,
  onChange,
  onSeek,
  disabled = false,
}: TrimmerProps) {
  const startInputId = useId();
  const endInputId = useId();
  const bounds = { duration, minGap: MIN_GAP_SECONDS, maxClipSeconds };
  const seek = useThrottledSeek(onSeek);

  // Which handle the proposal is dragging is read off `next` (compared to the
  // current, still-uncommitted `value`), before clampRange resolves it -- the
  // clamped result alone can't always tell the two apart (e.g. a cap moves
  // the same field `next` moved).
  function commit(next: TrimRange) {
    const startMoved = next.startSeconds !== value.startSeconds;
    const clamped = clampRange(next, value, bounds);
    onChange(clamped);
    seek(startMoved ? clamped.startSeconds : clamped.endSeconds);
  }

  function handleSliderChange(values: number[]) {
    const [start, end] = values;
    if (start === undefined || end === undefined) return;
    commit({ startSeconds: start, endSeconds: end });
  }

  // PageUp/PageDown and Home/End all need to act on whichever thumb is
  // actually focused, which Radix's own handling doesn't do (its Home/End are
  // hardwired to thumb 0 / the last thumb, and its Page step is 10 * step).
  // Each is intercepted here, on the focused thumb itself, and stopped from
  // bubbling to the slider's internal handler before it can also fire.
  function handleBoundaryKeys(which: "start" | "end") {
    return (event: React.KeyboardEvent) => {
      if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        event.stopPropagation();
        const delta = (event.key === "PageUp" ? 1 : -1) * PAGE_STEP_SECONDS;
        commit(
          which === "start"
            ? { startSeconds: value.startSeconds + delta, endSeconds: value.endSeconds }
            : { startSeconds: value.startSeconds, endSeconds: value.endSeconds + delta },
        );
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        // Propose the absolute boundary in that direction; clampRange pulls
        // it back to the furthest valid position (short of the other handle
        // by minGap) exactly as it does for an over-long Page/drag proposal.
        const target = event.key === "Home" ? 0 : duration;
        commit(
          which === "start"
            ? { startSeconds: target, endSeconds: value.endSeconds }
            : { startSeconds: value.startSeconds, endSeconds: target },
        );
      }
    };
  }

  function handleNumberChange(which: "start" | "end") {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = Number(event.target.value);
      if (Number.isNaN(parsed)) return;
      commit(
        which === "start"
          ? { startSeconds: parsed, endSeconds: value.endSeconds }
          : { startSeconds: value.startSeconds, endSeconds: parsed },
      );
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <Slider
        min={0}
        max={duration}
        step={STEP_SECONDS}
        minStepsBetweenThumbs={Math.round(MIN_GAP_SECONDS / STEP_SECONDS)}
        value={[value.startSeconds, value.endSeconds]}
        disabled={disabled}
        onValueChange={handleSliderChange}
        thumbProps={[
          {
            "aria-label": "Clip start",
            "aria-valuetext": valueText(value.startSeconds),
            onKeyDown: handleBoundaryKeys("start"),
          },
          {
            "aria-label": "Clip end",
            "aria-valuetext": valueText(value.endSeconds),
            onKeyDown: handleBoundaryKeys("end"),
          },
        ]}
      />
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={startInputId}>Clip start</Label>
          <Input
            id={startInputId}
            type="number"
            inputMode="decimal"
            min={0}
            max={duration}
            step={0.01}
            disabled={disabled}
            value={value.startSeconds}
            onChange={handleNumberChange("start")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={endInputId}>Clip end</Label>
          <Input
            id={endInputId}
            type="number"
            inputMode="decimal"
            min={0}
            max={duration}
            step={0.01}
            disabled={disabled}
            value={value.endSeconds}
            onChange={handleNumberChange("end")}
          />
        </div>
      </div>
    </div>
  );
}
