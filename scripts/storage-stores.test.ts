import { describe, expect, it } from "vitest";
import { cursorFrom, folderOf, isOurs } from "./storage-stores";

describe("folderOf", () => {
  it("reads the folder a public id sits in", () => {
    expect(folderOf("sources/abc")).toBe("sources");
    expect(folderOf("results/abc")).toBe("results");
  });

  it("names the root when there is no folder at all", () => {
    expect(folderOf("loose-file")).toBe("(root)");
  });

  it("keeps only the last segment as the folder", () => {
    expect(folderOf("samples/ecommerce/leather-bag")).toBe("samples/ecommerce");
  });
});

describe("isOurs", () => {
  it("claims the two folders this app writes", () => {
    expect(isOurs("sources/abc")).toBe(true);
    expect(isOurs("results/abc")).toBe(true);
  });

  // The account ships with `samples/`, and a delete that reached it would take assets no run of
  // this app ever created.
  it("refuses anything outside them", () => {
    expect(isOurs("samples/sea-turtle")).toBe(false);
    expect(isOurs("samples/ecommerce/leather-bag")).toBe(false);
    expect(isOurs("loose-file")).toBe(false);
    expect(isOurs("sources-backup/abc")).toBe(false);
  });
});

// A second page was silently dropped before: `next` carries the cursor as an ISO datetime and the
// client's own option is a Date.
describe("cursorFrom", () => {
  it("parses the from cursor out of a next link", () => {
    const next = "https://api.uploadcare.com/files/?from=2026-09-20T12%3A00%3A00.000Z&limit=1000";
    expect(cursorFrom(next)).toEqual(new Date("2026-09-20T12:00:00.000Z"));
  });

  it("ends the walk when there is no next page", () => {
    expect(cursorFrom(null)).toBeUndefined();
    expect(cursorFrom(undefined)).toBeUndefined();
  });

  it("ends the walk rather than looping on a cursor it cannot read", () => {
    expect(cursorFrom("https://api.uploadcare.com/files/?limit=1000")).toBeUndefined();
    expect(cursorFrom("https://api.uploadcare.com/files/?from=not-a-date")).toBeUndefined();
  });
});
