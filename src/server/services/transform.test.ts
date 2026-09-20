import { describe, expect, it } from "vitest";
import { testConfig } from "@/test/env";
import { deadlineFor } from "./transform";

const now = new Date("2026-09-20T12:00:00Z");

describe("deadlineFor", () => {
  it("is base plus per-clip-second", () => {
    // 5 min base + 10 s clip x 30 s = 5 min + 300 s = 10 min
    expect(deadlineFor(10, testConfig, now)).toEqual(new Date("2026-09-20T12:10:00Z"));
  });

  it("caps at the configured maximum", () => {
    expect(deadlineFor(3600, testConfig, now)).toEqual(new Date("2026-09-20T12:30:00Z"));
  });

  it("still allows the base for a very short clip", () => {
    expect(deadlineFor(0.5, testConfig, now).getTime()).toBeGreaterThan(now.getTime());
  });
});
