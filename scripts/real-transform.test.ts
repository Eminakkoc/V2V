import { describe, expect, it } from "vitest";
import { buildParams, formatElapsed, parseArgs, statusLabel } from "./real-transform";

const env = (over: Record<string, string> = {}) => ({
  V2V_COOKIE: "v2v_uid=signed-value",
  ...over,
});

describe("real-transform argument parsing", () => {
  it("requires both the base URL and the sourceId", () => {
    expect(() => parseArgs([], env())).toThrow(/usage: pnpm transform:real/);
    expect(() => parseArgs(["https://app.example.com"], env())).toThrow(/usage/);
  });

  it("rejects a base URL it cannot parse", () => {
    expect(() => parseArgs(["not-a-url", "source-1"], env())).toThrow(/not a valid URL/);
  });

  it("requires V2V_COOKIE", () => {
    expect(() => parseArgs(["https://app.example.com", "source-1"], {})).toThrow(/V2V_COOKIE/);
  });

  it("normalizes the base URL down to its origin", () => {
    const args = parseArgs(["https://app.example.com/create?x=1", "source-1"], env());
    expect(args).toEqual({
      baseUrl: "https://app.example.com",
      sourceId: "source-1",
      cookie: "v2v_uid=signed-value",
    });
  });
});

describe("real-transform param overrides", () => {
  it("falls back to a short default clip and art style", () => {
    const params = buildParams({});
    expect(params).toMatchObject({ startSeconds: 0, endSeconds: 8, artStyle: "Cyberpunk" });
  });

  it("accepts overrides via env", () => {
    const params = buildParams({
      TRANSFORM_START_SECONDS: "1",
      TRANSFORM_END_SECONDS: "6",
      TRANSFORM_ART_STYLE: "Ghibli Anime",
    });
    expect(params).toMatchObject({ startSeconds: 1, endSeconds: 6, artStyle: "Ghibli Anime" });
  });

  it("fails fast and clearly on an invalid override", () => {
    expect(() => buildParams({ TRANSFORM_ART_STYLE: "Not A Real Style" })).toThrow(
      /transform params are invalid/,
    );
  });
});

describe("real-transform status and time formatting", () => {
  it("shows the phase while processing, and only the status otherwise", () => {
    expect(statusLabel({ status: "processing", phase: "rendering" })).toBe(
      "processing (rendering)",
    );
    expect(statusLabel({ status: "complete", phase: "queued" })).toBe("complete");
  });

  it("formats elapsed milliseconds as minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0m00s");
    expect(formatElapsed(65_000)).toBe("1m05s");
    expect(formatElapsed(600_000)).toBe("10m00s");
  });
});
