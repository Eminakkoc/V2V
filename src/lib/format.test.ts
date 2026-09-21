import { describe, expect, it } from "vitest";
import { describeFormats, formatBytes, formatDuration, formatTimestamp } from "./format";

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [2048, "2 KB"],
    [104857600, "100 MB"],
    [44669337, "42.6 MB"],
    [2147483648, "2 GB"],
  ])("%d → %s", (bytes, text) => expect(formatBytes(bytes)).toBe(text));
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [9.6, "0:10"],
    [65, "1:05"],
    [3723, "1:02:03"],
  ])("%d → %s", (seconds, text) => expect(formatDuration(seconds)).toBe(text));
});

describe("formatTimestamp", () => {
  it("renders an absolute, UTC date and time regardless of the runtime's own locale/timezone", () => {
    expect(formatTimestamp("2026-01-01T00:05:00.000Z")).toBe("Jan 1, 2026, 12:05 AM UTC");
  });

  it("does not shift across a UTC day boundary the way a local-timezone format could", () => {
    expect(formatTimestamp("2026-03-15T23:45:00.000Z")).toBe("Mar 15, 2026, 11:45 PM UTC");
  });

  it("labels the timezone, so the string is never mistaken for the reader's own local time", () => {
    // The assertions above would still pass by prefix coincidence if `timeZoneName` were dropped;
    // this pins the label itself.
    expect(formatTimestamp("2026-01-01T00:05:00.000Z")).toMatch(/\bUTC$/);
  });
});

describe("describeFormats", () => {
  it("names known formats and joins with or", () => {
    expect(describeFormats(["video/mp4"])).toBe("MP4");
    expect(describeFormats(["video/mp4", "video/quicktime"])).toBe("MP4 or MOV");
    expect(describeFormats(["video/mp4", "video/quicktime", "video/webm"])).toBe(
      "MP4, MOV or WebM",
    );
  });

  it("falls back to the upper-cased subtype", () => {
    expect(describeFormats(["video/x-matroska"])).toBe("X-MATROSKA");
  });
});
