import { describe, expect, it } from "vitest";
import { thumbnailTimes } from "./filmstrip";

describe("thumbnailTimes", () => {
  it("spreads 8-12 thumbnails evenly, avoiding the exact first and last frame", () => {
    const times = thumbnailTimes(10, 10);
    expect(times).toHaveLength(10);
    expect(times[0]).toBeGreaterThan(0);
    expect(times.at(-1)).toBeLessThan(10);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("never asks for more thumbnails than there are whole seconds", () => {
    expect(thumbnailTimes(3, 12).length).toBeLessThanOrEqual(12);
  });

  it("returns an empty list for a zero-length video rather than dividing by zero", () => {
    expect(thumbnailTimes(0, 10)).toEqual([]);
  });
});
