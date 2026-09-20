import { describe, expect, it } from "vitest";
import { clampRange } from "./trim-range";

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
