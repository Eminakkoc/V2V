import { describe, expect, it } from "vitest";
import { parseArgs } from "./cleanup-manual-test-assets";

const now = () => Date.parse("2026-09-20T12:00:00Z");

describe("cleanup-manual-test-assets argument parsing", () => {
  it("is a dry run unless --delete is passed", () => {
    expect(parseArgs([], now).apply).toBe(false);
    expect(parseArgs(["--delete"], now).apply).toBe(true);
  });

  it("looks back 24 hours by default", () => {
    expect(parseArgs([], now).since.toISOString()).toBe("2026-09-19T12:00:00.000Z");
  });

  it("accepts an explicit --since", () => {
    expect(parseArgs(["--since", "2026-09-01"], now).since.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it.each([["--since"], ["--since", "not-a-date"]])("rejects %s", (...argv) => {
    expect(() => parseArgs(argv, now)).toThrow(/--since/);
  });

  it("keeps --delete alongside --since", () => {
    const args = parseArgs(["--since", "2026-09-01", "--delete"], now);
    expect(args).toMatchObject({ apply: true });
    expect(args.since.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
