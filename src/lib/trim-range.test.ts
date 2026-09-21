import { describe, expect, it } from "vitest";
import { transformParamsSchema } from "./transform-contract";
import { clampRange, defaultRange, trimLimit } from "./trim-range";

const bounds = { duration: 60, minGap: 0.1, maxClipSeconds: 30 };

describe("clampRange", () => {
  it("stops the handles crossing instead of swapping them", () => {
    expect(
      clampRange({ startSeconds: 20, endSeconds: 10 }, { startSeconds: 5, endSeconds: 10 }, bounds),
    ).toEqual({ startSeconds: 9.9, endSeconds: 10 });
  });

  it("keeps at least the minimum gap", () => {
    expect(
      clampRange({ startSeconds: 10, endSeconds: 10 }, { startSeconds: 5, endSeconds: 10 }, bounds)
        .endSeconds,
    ).toBeGreaterThanOrEqual(10.1 - 0.001);
  });

  it("clamps to the clip cap by moving the handle being dragged", () => {
    // Dragging end far right with start at 0 must stop at the cap, not move start.
    expect(
      clampRange({ startSeconds: 0, endSeconds: 59 }, { startSeconds: 0, endSeconds: 10 }, bounds),
    ).toEqual({ startSeconds: 0, endSeconds: 30 });
  });

  it("clamps to the video duration", () => {
    expect(
      clampRange({ startSeconds: 55, endSeconds: 70 }, { startSeconds: 55, endSeconds: 60 }, bounds)
        .endSeconds,
    ).toBe(60);
  });

  it("rounds to two decimals so the schema accepts the result", () => {
    const r = clampRange(
      { startSeconds: 1.005, endSeconds: 9.999 },
      { startSeconds: 1, endSeconds: 9 },
      bounds,
    );
    expect(Math.round(r.startSeconds * 100) / 100).toBe(r.startSeconds);
    expect(Math.round(r.endSeconds * 100) / 100).toBe(r.endSeconds);
  });

  it("stops the dragged end handle rather than dragging start along when crossing", () => {
    expect(
      clampRange({ startSeconds: 20, endSeconds: 5 }, { startSeconds: 20, endSeconds: 25 }, bounds),
    ).toEqual({ startSeconds: 20, endSeconds: 20.1 });
  });

  it("leaves an already-valid range untouched (aside from rounding)", () => {
    expect(
      clampRange(
        { startSeconds: 12.5, endSeconds: 20.5 },
        { startSeconds: 10, endSeconds: 20.5 },
        bounds,
      ),
    ).toEqual({ startSeconds: 12.5, endSeconds: 20.5 });
  });
});

describe("trimLimit", () => {
  it("stops at the last two-decimal second the source actually contains", () => {
    // Never up: 2.70 is a frame the source does not have.
    expect(trimLimit(2.69973)).toBe(2.69);
  });

  it("leaves a duration that is already two decimals alone", () => {
    expect(trimLimit(12.5)).toBe(12.5);
    expect(trimLimit(60)).toBe(60);
  });
});

describe("defaultRange", () => {
  // The real .mov from the report: an untouched trimmer submitted 2.69973 and
  // the server refused it with "must have at most 2 decimals".
  it("rounds a real source duration into what the schema accepts", () => {
    const range = defaultRange(2.69973, 30);
    expect(range).toEqual({ startSeconds: 0, endSeconds: 2.69 });
    expect(
      transformParamsSchema.safeParse({
        name: "clip.mov",
        ...range,
        artStyle: "No Art Style",
      }).success,
    ).toBe(true);
  });

  it("caps at maxClipSeconds for a source longer than the cap", () => {
    expect(defaultRange(60, 30)).toEqual({ startSeconds: 0, endSeconds: 30 });
  });

  it("selects the whole clip when it is shorter than the cap", () => {
    expect(defaultRange(12.5, 30)).toEqual({ startSeconds: 0, endSeconds: 12.5 });
  });

  it("never returns a value the schema would reject, whatever the duration", () => {
    for (const duration of [0.37, 1.005, 2.69973, 9.999, 12.5, 29.999, 30.5, 60]) {
      const range = defaultRange(duration, 30);
      expect(Math.round(range.endSeconds * 100) / 100).toBe(range.endSeconds);
      expect(range.endSeconds).toBeGreaterThan(range.startSeconds);
      expect(range.endSeconds).toBeLessThanOrEqual(duration);
    }
  });
});

describe("clampRange at the track extremes", () => {
  // The source is 12.5s, so the track runs 0 .. 12.5 and both thumbs can
  // reach an edge. IR-003: a keyboard user could drive them onto the same
  // value, which a pointer drag cannot do (Radix's minStepsBetweenThumbs),
  // and the control then let an invalid clip be submitted.
  const short = { duration: 12.5, minGap: 0.1, maxClipSeconds: 30 };

  it("keeps the gap when End drives the start thumb onto the end thumb", () => {
    expect(
      clampRange(
        { startSeconds: 12.5, endSeconds: 12.5 },
        { startSeconds: 0, endSeconds: 12.5 },
        short,
      ),
    ).toEqual({ startSeconds: 12.4, endSeconds: 12.5 });
  });

  it("keeps the gap when Home drives the end thumb onto the start thumb", () => {
    expect(
      clampRange({ startSeconds: 0, endSeconds: 0 }, { startSeconds: 0, endSeconds: 12.5 }, short),
    ).toEqual({ startSeconds: 0, endSeconds: 0.1 });
  });

  it("never yields a zero-length clip from any single-handle proposal", () => {
    const steps = [-5, -0.1, 0, 0.1, 5, 12.4, 12.5, 12.6, 99];
    for (const value of steps) {
      for (const previous of [
        { startSeconds: 0, endSeconds: 12.5 },
        { startSeconds: 6, endSeconds: 6.1 },
        { startSeconds: 12.4, endSeconds: 12.5 },
      ]) {
        for (const proposal of [
          { startSeconds: value, endSeconds: previous.endSeconds },
          { startSeconds: previous.startSeconds, endSeconds: value },
        ]) {
          const r = clampRange(proposal, previous, short);
          expect(r.endSeconds - r.startSeconds).toBeGreaterThanOrEqual(short.minGap - 1e-9);
          expect(r.startSeconds).toBeGreaterThanOrEqual(0);
          expect(r.endSeconds).toBeLessThanOrEqual(short.duration);
        }
      }
    }
  });
});
