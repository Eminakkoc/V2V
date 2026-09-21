"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { clampRange, trimLimit, type TrimRange } from "@/lib/trim-range";
import { Filmstrip } from "./filmstrip";

// A shorter trim reads as a mis-click rather than an intended clip, and this keeps the two handles
// from ever landing on the same value.
const MIN_GAP_SECONDS = 0.1;
// Keyboard granularity for one Arrow press; Home/End and PageUp/PageDown are overridden below,
// because Radix hardwires them to thumb 0 / the last thumb and to 10 * step.
const STEP_SECONDS = 0.1;
const PAGE_STEP_SECONDS = 5;

export type TrimmerProps = {
  duration: number;
  maxClipSeconds: number;
  value: TrimRange;
  onChange: (next: TrimRange) => void;
  onSeek: (second: number) => void;
  disabled?: boolean;
  src?: string;
  previewRef?: React.RefObject<HTMLVideoElement | null>;
};

function valueText(seconds: number): string {
  return `${seconds.toFixed(1)} seconds`;
}

// The preview <video> lives one level up in CreateFlow, so looping listens to it directly;
// `useEffectEvent` reads the live range without making it a dependency that would tear the listener
// down on every trim change.
function useLoopPlayback(
  previewRef: React.RefObject<HTMLVideoElement | null> | undefined,
  range: TrimRange,
  looping: boolean,
) {
  const onTimeUpdate = useEffectEvent((video: HTMLVideoElement) => {
    if (!looping) return;
    // Only while actually playing: seeking fires timeupdate too, so without this a drag of the end
    // handle reads as "reached the end" and is rewound.
    if (video.paused) return;
    if (video.currentTime >= range.endSeconds) {
      video.currentTime = range.startSeconds;
    }
  });

  useEffect(() => {
    const video = previewRef?.current;
    if (!video) return;
    const handleTimeUpdate = () => onTimeUpdate(video);
    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [previewRef]);
}

// Dragging fires far more pointermove events than the video needs currentTime updates for, so this
// keeps only the latest second and flushes once per animation frame.
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

// Deliberately NOT memo()-wrapped: under React 19.2 a memo component's useEffectEvent is not
// refreshed when it re-renders from its own state, so turning the loop off would silently stop
// working.
export function Trimmer({
  duration,
  maxClipSeconds,
  value,
  onChange,
  onSeek,
  disabled = false,
  src,
  previewRef,
}: TrimmerProps) {
  const startInputId = useId();
  const endInputId = useId();
  const loopToggleId = useId();
  const bounds = { duration, minGap: MIN_GAP_SECONDS, maxClipSeconds };
  // The track stops at the last two-decimal second of the source, so the control never offers a
  // position the committed range cannot represent.
  const limit = trimLimit(duration);
  const seek = useThrottledSeek(onSeek);
  const [looping, setLooping] = useState(true);
  useLoopPlayback(previewRef, value, looping);
  const selectedSeconds = value.endSeconds - value.startSeconds;

  // Which handle is being dragged is read off `next` against the still-uncommitted `value`, because
  // the clamped result alone cannot always tell the two apart.
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

  // Radix hardwires Home/End to thumb 0 and the last thumb and uses 10 * step for Page, so each key
  // is intercepted on the focused thumb and stopped from bubbling to the slider's own handler.
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
        // Propose the absolute boundary; clampRange pulls it back to the furthest valid position,
        // short of the other handle by minGap.
        const target = event.key === "Home" ? 0 : limit;
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

  // `limit` is never 0 here -- a source with no duration cannot reach the trimmer -- but the guard
  // keeps the division honest.
  const selectionCentre =
    limit > 0 ? ((value.startSeconds + value.endSeconds) / 2 / limit) * 100 : 50;

  return (
    <div className="flex flex-col gap-3 rounded-panel bg-surface px-4 py-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <p className="type-body font-semibold">Trim</p>
        <p className="flex-1 text-right type-caption text-muted-foreground">
          Drag the handles or type exact times · clips up to {maxClipSeconds} s
        </p>
      </div>

      <div className="relative h-(--trim-track-height)">
        {src ? (
          <Filmstrip
            src={src}
            duration={limit}
            className="pointer-events-none absolute inset-0 rounded-sm opacity-50"
          />
        ) : null}
        <Slider
          min={0}
          max={limit}
          step={STEP_SECONDS}
          minStepsBetweenThumbs={Math.round(MIN_GAP_SECONDS / STEP_SECONDS)}
          value={[value.startSeconds, value.endSeconds]}
          disabled={disabled}
          onValueChange={handleSliderChange}
          className="h-full"
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
        {/* The live length rides on the selection itself, as in the design.
            aria-live carries the same figure for readers who cannot see it. */}
        <p
          aria-live="polite"
          style={{ left: `${selectionCentre}%` }}
          className="pointer-events-none absolute -top-[13px] -translate-x-1/2 rounded-pill bg-accent-strong px-3 py-0.5 type-tag whitespace-nowrap text-bg"
        >
          {selectedSeconds.toFixed(2)}s selected
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor={startInputId}>Start</Label>
          <Input
            id={startInputId}
            aria-label="Clip start"
            type="number"
            inputMode="decimal"
            min={0}
            max={limit}
            step={0.01}
            disabled={disabled}
            value={value.startSeconds}
            onChange={handleNumberChange("start")}
            className="w-[90px] text-center"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={endInputId}>End</Label>
          <Input
            id={endInputId}
            aria-label="Clip end"
            type="number"
            inputMode="decimal"
            min={0}
            max={limit}
            step={0.01}
            disabled={disabled}
            value={value.endSeconds}
            onChange={handleNumberChange("end")}
            className="w-[90px] text-center"
          />
        </div>
        {/* Styled from aria-pressed rather than a parallel class, so the fill can never disagree
            with what a reader is told. It starts on, and without the fill a click moved nothing a
            viewer could see -- the only other evidence is the playhead not rewinding, minutes of
            clip away. The `on` treatment is the segmented control's, this being the same question:
            which of two states is live. The hover repeat is deliberate: the variant's own
            hover:bg-neutral-100 otherwise wins on the pressed button, depending only on the order
            Tailwind emits the two variants. */}
        <Button
          type="button"
          variant="outline"
          id={loopToggleId}
          aria-pressed={looping}
          disabled={disabled}
          onClick={() => setLooping((on) => !on)}
          className="aria-pressed:border-accent-strong aria-pressed:bg-accent-strong aria-pressed:text-bg aria-pressed:hover:bg-accent-strong"
        >
          <RotateCcw aria-hidden />
          Loop selection
        </Button>
      </div>
    </div>
  );
}
