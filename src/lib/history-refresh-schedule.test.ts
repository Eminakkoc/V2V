import { describe, expect, it } from "vitest";
import { nextRefreshDelayMs } from "./history-refresh-schedule";

const rows = (...statuses: string[]) => statuses.map((status) => ({ status })) as never;

describe("history refresh schedule", () => {
  it("stops when the changeable set is empty", () => {
    expect(nextRefreshDelayMs(rows(), 0)).toBeNull();
  });

  it("uses the live ladder while anything is processing or finalizing", () => {
    expect(nextRefreshDelayMs(rows("processing"), 0)).toBe(3_000);
    expect(nextRefreshDelayMs(rows("processing"), 60_000)).toBe(10_000);
    expect(nextRefreshDelayMs(rows("finalizing"), 300_000)).toBe(30_000);
  });

  it("falls back to 30s for timed_out or superseded only", () => {
    expect(nextRefreshDelayMs(rows("timed_out"), 0)).toBe(30_000);
    expect(nextRefreshDelayMs(rows("superseded"), 999_999)).toBe(30_000);
  });

  it("backs right off when only abandoned jobs remain", () => {
    expect(nextRefreshDelayMs(rows("abandoned"), 0)).toBe(300_000);
  });

  it("prefers the liveliest row present", () => {
    expect(nextRefreshDelayMs(rows("abandoned", "timed_out", "processing"), 0)).toBe(3_000);
  });
});
