import { describe, expect, it } from "vitest";
import { nextDelayMs } from "./polling-schedule";

const none = { processing: 0, finalizing: 0, timedOut: 0, superseded: 0 };

describe("nextDelayMs", () => {
  it("polls fast at first, then backs off", () => {
    expect(nextDelayMs({ ...none, processing: 1 }, 0)).toBe(3_000);
    expect(nextDelayMs({ ...none, processing: 1 }, 31_000)).toBe(10_000);
    expect(nextDelayMs({ ...none, processing: 1 }, 121_000)).toBe(30_000);
  });

  it("polls slowly when only timed-out or superseded work remains", () => {
    expect(nextDelayMs({ ...none, timedOut: 1 }, 0)).toBe(30_000);
    expect(nextDelayMs({ ...none, superseded: 1 }, 0)).toBe(30_000);
  });

  it("stops entirely when nothing is active", () => {
    expect(nextDelayMs(none, 0)).toBeNull();
  });

  it("treats finalizing as active", () => {
    expect(nextDelayMs({ ...none, finalizing: 1 }, 0)).toBe(3_000);
  });
});
