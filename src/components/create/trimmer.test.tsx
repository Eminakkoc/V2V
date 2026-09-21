// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrimRange } from "@/lib/trim-range";
import { Trimmer, type TrimmerProps } from "./trimmer";

const DURATION = 60;
const MAX_CLIP_SECONDS = 30;

// clampRange's math only lines up with the hand-picked clientX values when one pixel of track maps
// to one second.
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

// A real controlled usage: onChange feeds back into `value`, so repeated interactions build on the
// previous result.
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

    // The end handle's own minimum is the start handle plus the gap, not the slider's overall
    // minimum, which is thumb 0's Home target.
    expect(props.onChange).toHaveBeenCalledWith({ startSeconds: 5, endSeconds: 5.1 });
  });

  it("End on the focused start handle moves only the start handle to its own maximum", () => {
    const props = renderTrimmer({ value: { startSeconds: 5, endSeconds: 20 } });
    const startThumb = screen.getByRole("slider", { name: "Clip start" });
    fireEvent.focus(startThumb);
    fireEvent.keyDown(startThumb, { key: "End" });

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

  it("announces the selected duration to two decimals in a polite live region", () => {
    const { container } = render(
      <Trimmer
        duration={DURATION}
        maxClipSeconds={MAX_CLIP_SECONDS}
        value={{ startSeconds: 2.5, endSeconds: 9 }}
        onChange={vi.fn()}
        onSeek={vi.fn()}
      />,
    );
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent("6.50s selected");
  });

  describe("loop playback", () => {
    function renderWithPreview(value: TrimRange) {
      function Wrapper() {
        const videoRef = useRef<HTMLVideoElement>(null);
        return (
          <>
            <video ref={videoRef} muted data-testid="preview" />
            <Trimmer
              duration={DURATION}
              maxClipSeconds={MAX_CLIP_SECONDS}
              value={value}
              onChange={vi.fn()}
              onSeek={vi.fn()}
              previewRef={videoRef}
            />
          </>
        );
      }
      render(<Wrapper />);
      return screen.getByTestId("preview") as HTMLVideoElement;
    }

    // jsdom has no playback engine, so `paused` is an always-true getter and has to be overridden
    // here.
    function setPlaying(video: HTMLVideoElement, playing: boolean) {
      Object.defineProperty(video, "paused", { value: !playing, configurable: true });
    }

    it("seeks the preview back to the start once it passes the end while looping is on", () => {
      const video = renderWithPreview({ startSeconds: 5, endSeconds: 10 });
      setPlaying(video, true);
      video.currentTime = 10.2;
      fireEvent(video, new Event("timeupdate"));
      expect(video.currentTime).toBe(5);
    });

    it("leaves the preview alone once looping is turned off", () => {
      const video = renderWithPreview({ startSeconds: 5, endSeconds: 10 });
      setPlaying(video, true);
      fireEvent.click(screen.getByRole("button", { name: "Loop selection" }));

      video.currentTime = 10.2;
      fireEvent(video, new Event("timeupdate"));
      expect(video.currentTime).toBe(10.2);
    });

    // The fill is drawn from this attribute, so it is the whole of what a viewer is told: the
    // toggle reported nothing at all until it was styled from here.
    it("reports the live state on the toggle, starting on", () => {
      renderWithPreview({ startSeconds: 5, endSeconds: 10 });
      const toggle = screen.getByRole("button", { name: "Loop selection" });
      expect(toggle).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    });

    // Seeking fires timeupdate too, so a loop that ignored `paused` would read the parked end frame
    // as "reached the end" and rewind it.
    it("holds a paused preview on the end frame instead of rewinding it", () => {
      const video = renderWithPreview({ startSeconds: 5, endSeconds: 10 });
      setPlaying(video, false);
      video.currentTime = 10;
      fireEvent(video, new Event("timeupdate"));
      expect(video.currentTime).toBe(10);
    });
  });

  describe("filmstrip failure", () => {
    afterEach(() => vi.restoreAllMocks());

    // Thumbnail extraction can throw for reasons outside the trimmer's control, and the slider and
    // its handles must stay usable regardless.
    it("keeps the slider handles usable when filmstrip extraction throws", () => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage: () => {
          throw new Error("canvas is tainted");
        },
      } as unknown as CanvasRenderingContext2D);

      const onChange = vi.fn();
      const { container } = render(
        <Trimmer
          duration={DURATION}
          maxClipSeconds={MAX_CLIP_SECONDS}
          value={{ startSeconds: 0, endSeconds: 10 }}
          onChange={onChange}
          onSeek={vi.fn()}
          src="https://res.cloudinary.com/demo/video/upload/sources/a.mp4"
        />,
      );

      const hiddenVideo = container.querySelector("video[src]");
      if (!hiddenVideo) throw new Error("expected the filmstrip's hidden <video>");
      fireEvent(hiddenVideo, new Event("loadedmetadata"));
      fireEvent(hiddenVideo, new Event("seeked"));

      const endThumb = screen.getByRole("slider", { name: "Clip end" });
      fireEvent.focus(endThumb);
      fireEvent.keyDown(endThumb, { key: "ArrowRight" });
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
