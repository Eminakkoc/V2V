import { describe, expect, it } from "vitest";
import { createVideoRules } from "./video-rules";

const rules = createVideoRules({
  allowedFormats: ["video/mp4", "video/quicktime", "video/webm"],
  maxBytes: 100,
});

describe("video rules", () => {
  it.each(["video/mp4", "video/quicktime", "video/webm", "VIDEO/MP4", "video/mp4; codecs=avc1"])(
    "accepts %s",
    (mimeType) => expect(rules.checkFile({ mimeType, size: 10 })).toMatchObject({ ok: true }),
  );

  it("rejects formats outside the allowlist", () => {
    expect(rules.checkFile({ mimeType: "video/x-msvideo", size: 10 })).toEqual({
      ok: false,
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("rejects files over the size cap and accepts the exact cap", () => {
    expect(rules.checkFile({ mimeType: "video/mp4", size: 101 })).toEqual({
      ok: false,
      code: "FILE_TOO_LARGE",
    });
    expect(rules.checkFile({ mimeType: "video/mp4", size: 100 })).toMatchObject({ ok: true });
  });

  it("maps the extension when the browser reports no type or a generic one", () => {
    expect(rules.checkFile({ mimeType: "", size: 10, name: "beach.MOV" })).toEqual({
      ok: true,
      mimeType: "video/quicktime",
    });
    expect(
      rules.checkFile({ mimeType: "application/octet-stream", size: 10, name: "clip.m4v" }),
    ).toEqual({ ok: true, mimeType: "video/mp4" });
  });

  it("never trusts the extension when a specific type is reported", () => {
    expect(rules.checkFile({ mimeType: "image/png", size: 10, name: "clip.mp4" })).toMatchObject({
      ok: false,
    });
  });

  it("rejects a generic type without a file name (the server path)", () => {
    expect(rules.checkFile({ mimeType: "application/octet-stream", size: 10 })).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("builds the accept attribute from the allowlist", () => {
    const mp4Only = createVideoRules({ allowedFormats: ["video/mp4"], maxBytes: 100 });
    expect(mp4Only.accept).toBe("video/mp4,.mp4,.m4v");
    expect(rules.accept).toContain(".mov");
    expect(rules.accept).toContain(".webm");
  });
});
