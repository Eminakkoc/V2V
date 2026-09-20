// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrimRange } from "@/lib/trim-range";
import { Trimmer, type TrimmerProps } from "./trimmer";

const DURATION = 60;
const MAX_CLIP_SECONDS = 30;

// clampRange's math only lines up with hand-picked clientX values (see the
// drag test) when a pixel of track maps to one second: rect.left = 0,
// rect.width = DURATION.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: DURATION,
    bottom: 20,
    width: DURATION,
    height: 20,
    toJSON() {
      return {};
    },
  });
});

function renderTrimmer(overrides: Partial<TrimmerProps> = {}) {
  const props: TrimmerProps = {
    duration: DURATION,
    maxClipSeconds: MAX_CLIP_SECONDS,
    value: { startSeconds: 0, endSeconds: 10 },
    onChange: vi.fn(),
    onSeek: vi.fn(),
    ...overrides,
  };
  render(<Trimmer {...props} />);
  return props;
}

// A real controlled usage: onChange feeds back into `value`, so repeated
// interactions (arrow-key presses, a drag) build on the previous result
// instead of always starting from the same initial props.
function ControlledTrimmer({
  initial,
  onChange,
  ...rest
}: Omit<TrimmerProps, "value" | "onChange"> & {
  initial: TrimRange;
  onChange: (next: TrimRange) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Trimmer
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("Trimmer", () => {
  it("gives each handle an accessible name and a seconds valuetext", () => {
    renderTrimmer({ value: { startSeconds: 1, endSeconds: 12.3 } });
    const start = screen.getByRole("slider", { name: "Clip start" });
    const end = screen.getByRole("slider", { name: "Clip end" });
    expect(start).toHaveAttribute("aria-valuetext", "1.0 seconds");
    expect(end).toHaveAttribute("aria-valuetext", "12.3 seconds");
  });

  it("keeps the two number inputs in sync with the handles", () => {
    renderTrimmer({ value: { startSeconds: 2.5, endSeconds: 15 } });
    expect(screen.getByRole("spinbutton", { name: "Clip start" })).toHaveValue(2.5);
    expect(screen.getByRole("spinbutton", { name: "Clip end" })).toHaveValue(15);
  });

  it("dragging the end handle past the clip cap moves only that handle, clamped and rounded", async () => {
    const props = renderTrimmer({ value: { startSeconds: 0, endSeconds: 10 } });
    const endThumb = screen.getByRole("slider", { name: "Clip end" });

    fireEvent.pointerDown(endThumb, { pointerId: 1, clientX: 10 });
    fireEvent.pointerMove(endThumb, { pointerId: 1, clientX: 59 });

    expect(props.onChange).toHaveBeenCalledWith({ startSeconds: 0, endSeconds: 30 });
    await waitFor(() => expect(props.onSeek).toHaveBeenCalledWith(30));
  });

  it("typing in the number inputs moves the handle and clamps the result", () => {
    const props = renderTrimmer({ value: { startSeconds: 0, endSeconds: 10 } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Clip end" }), {
      target: { value: "59" },
    });
    expect(props.onChange).toHaveBeenCalledWith({ startSeconds: 0, endSeconds: 30 });
  });

  it("typing the start past the end stops it short of crossing", () => {
    const props = renderTrimmer({ value: { startSeconds: 5, endSeconds: 10 } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Clip start" }), {
      target: { value: "20" },
    });
    expect(props.onChange).toHaveBeenCalledWith({ startSeconds: 9.9, endSeconds: 10 });
  });

  it("arrow keys move a focused thumb", () => {
    const onChange = vi.fn();
    render(
      <ControlledTrimmer
        initial={{ startSeconds: 5, endSeconds: 20 }}
        duration={DURATION}
        maxClipSeconds={MAX_CLIP_SECONDS}
        onSeek={vi.fn()}
        onChange={onChange}
      />,
    );
    const startThumb = screen.getByRole("slider", { name: "Clip start" });
    fireEvent.focus(startThumb);
    fireEvent.keyDown(startThumb, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [range] = onChange.mock.calls[0] as [TrimRange];
    expect(range.startSeconds).toBeCloseTo(5.1, 5);
  });

  it("Home on the focused end handle moves only the end handle to its own minimum", () => {
    const props = renderTrimmer({ value: { startSeconds: 5, endSeconds: 20 } });
    const endThumb = screen.getByRole("slider", { name: "Clip end" });
    fireEvent.focus(endThumb);
    fireEvent.keyDown(endThumb, { key: "Home" });

    // The end handle's own minimum is bounded by the start handle plus the
    // minimum gap, not the slider's overall minimum (0) -- that's thumb 0's
    // Home target, and pressing Home on the *end* handle must not reach it.
    expect(props.onChange).toHaveBeenCalledWith({ startSeconds: 5, endSeconds: 5.1 });
  });

  it("End on the focused start handle moves only the start handle to its own maximum", () => {
    const props = renderTrimmer({ value: { startSeconds: 5, endSeconds: 20 } });
    const startThumb = screen.getByRole("slider", { name: "Clip start" });
    fireEvent.focus(startThumb);
    fireEvent.keyDown(startThumb, { key: "End" });

    // Likewise, the start handle's own maximum is short of the end handle by
    // the minimum gap, not the slider's overall maximum (duration).
    expect(props.onChange).toHaveBeenCalledWith({ startSeconds: 19.9, endSeconds: 20 });
  });

  it("the handles cannot cross, no matter how many times the gap is pressed shut", () => {
    const onChange = vi.fn();
    render(
      <ControlledTrimmer
        initial={{ startSeconds: 9.5, endSeconds: 10 }}
        duration={DURATION}
        maxClipSeconds={MAX_CLIP_SECONDS}
        onSeek={vi.fn()}
        onChange={onChange}
      />,
    );
    const startThumb = screen.getByRole("slider", { name: "Clip start" });
    fireEvent.focus(startThumb);
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(startThumb, { key: "ArrowRight" });
    }

    for (const [range] of onChange.mock.calls as [TrimRange][]) {
      expect(range.startSeconds).toBeLessThan(range.endSeconds);
      expect(range.endSeconds - range.startSeconds).toBeGreaterThanOrEqual(0.1 - 1e-9);
    }
  });

  it("disables the slider and both inputs when disabled", () => {
    renderTrimmer({ disabled: true });
    expect(screen.getByRole("slider", { name: "Clip start" })).toHaveAttribute("data-disabled", "");
    expect(screen.getByRole("spinbutton", { name: "Clip start" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Clip end" })).toBeDisabled();
  });
});
