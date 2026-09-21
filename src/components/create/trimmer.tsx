"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { clampRange, trimLimit, type TrimRange } from "@/lib/trim-range";
import { Filmstrip } from "./filmstrip";

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
  // The preview video's own URL and ref, for the filmstrip thumbnails and
  // for looping playback inside the trimmed range. Both are optional: a
  // trimmer with neither still works, just without those two extras.
  src?: string;
  previewRef?: React.RefObject<HTMLVideoElement | null>;
};

function valueText(seconds: number): string {
  return `${seconds.toFixed(1)} seconds`;
}

// The preview <video> lives one level up (in CreateFlow), so looping is done
// by listening to it directly rather than by owning playback here. The
// listener is attached once per video element; `useEffectEvent` reads the
// live `range`/`looping` on every tick without making either a dependency
// that would tear the listener down and re-add it on every trim change.
function useLoopPlayback(
  previewRef: React.RefObject<HTMLVideoElement | null> | undefined,
  range: TrimRange,
  looping: boolean,
) {
  const onTimeUpdate = useEffectEvent((video: HTMLVideoElement) => {
    if (!looping) return;
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
  src,
  previewRef,
}: TrimmerProps) {
  const startInputId = useId();
  const endInputId = useId();
  const loopToggleId = useId();
  const bounds = { duration, minGap: MIN_GAP_SECONDS, maxClipSeconds };
  // The track stops at the last two-decimal second of the source, because
  // that is the finest value the payload may carry. Reading it here as well
  // as inside clampRange is what keeps the control from ever *offering* a
  // position the committed range cannot represent.
  const limit = trimLimit(duration);
  const seek = useThrottledSeek(onSeek);
  const [looping, setLooping] = useState(true);
  useLoopPlayback(previewRef, value, looping);
  const selectedSeconds = value.endSeconds - value.startSeconds;

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

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex h-10 items-center">
        {src ? (
          <Filmstrip src={src} duration={limit} className="pointer-events-none absolute inset-0" />
        ) : null}
        <Slider
          min={0}
          max={limit}
          step={STEP_SECONDS}
          minStepsBetweenThumbs={Math.round(MIN_GAP_SECONDS / STEP_SECONDS)}
          value={[value.startSeconds, value.endSeconds]}
          disabled={disabled}
          onValueChange={handleSliderChange}
          className="relative"
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
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {selectedSeconds.toFixed(2)}s selected
        </p>
        <label
          htmlFor={loopToggleId}
          className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
        >
          <input
            id={loopToggleId}
            type="checkbox"
            checked={looping}
            disabled={disabled}
            onChange={(event) => setLooping(event.target.checked)}
          />
          Loop preview
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={startInputId}>Clip start</Label>
          <Input
            id={startInputId}
            type="number"
            inputMode="decimal"
            min={0}
            max={limit}
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
            max={limit}
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
