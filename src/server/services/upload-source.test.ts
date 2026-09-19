import { describe, expect, it } from "vitest";
import { parseUploadcareCdnUrl } from "./upload-source";

const uuid = "3f1b8c9e-4d2a-4b6e-9a1c-2e5f7d8b9c0a";

describe("parseUploadcareCdnUrl", () => {
  it.each([
    `https://ucarecdn.com/${uuid}/`,
    `https://ucarecdn.com/${uuid}/beach.mov`,
    `https://abc123xyz.ucarecd.net/${uuid}/`,
    `https://ucarecdn.com/${uuid.toUpperCase()}/-/preview/`,
  ])("accepts %s", (url) => {
    expect(parseUploadcareCdnUrl(url).uuid).toBe(uuid);
  });

  it("returns the canonical CDN URL", () => {
    expect(parseUploadcareCdnUrl(`https://ucarecdn.com/${uuid}/beach.mov`).canonicalUrl).toBe(
      `https://ucarecdn.com/${uuid}/`,
    );
  });

  it.each([
    `http://ucarecdn.com/${uuid}/`,
    `https://evil.com/${uuid}/`,
    `https://ucarecdn.com.evil.com/${uuid}/`,
    `https://user:pass@ucarecdn.com/${uuid}/`,
    `https://ucarecdn.com:8443/${uuid}/`,
    "https://ucarecdn.com/not-a-uuid/",
    "not a url",
  ])("rejects %s with INVALID_VIDEO_URL", (url) => {
    let caught: unknown;
    try {
      parseUploadcareCdnUrl(url);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "INVALID_VIDEO_URL" });
  });
});
