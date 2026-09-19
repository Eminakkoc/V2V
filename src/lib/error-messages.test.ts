import { describe, expect, it } from "vitest";
import { messageFor } from "./error-messages";

const limits = { maxBytes: 104857600, allowedFormats: ["video/mp4", "video/quicktime"] };
const error = (
  code: string,
  extra: Partial<{ retryable: boolean; retryAfterSeconds: number; message: string }> = {},
) => ({
  code,
  message: extra.message ?? "server message",
  retryable: extra.retryable ?? false,
  ...(extra.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: extra.retryAfterSeconds }),
});

describe("messageFor", () => {
  it("builds size and format copy from the configured limits", () => {
    expect(messageFor(error("FILE_TOO_LARGE"), limits)).toEqual({
      title: "This video is too large",
      description: "Maximum size is 100 MB.",
      action: "choose-another-file",
    });
    expect(messageFor(error("UNSUPPORTED_FORMAT"), limits).description).toBe(
      "Only MP4 or MOV videos are supported.",
    );
  });

  it("offers retry for a retryable storing failure and a new file otherwise", () => {
    expect(
      messageFor(error("CLOUDINARY_UPLOAD_FAILED", { retryable: true }), limits),
    ).toMatchObject({
      title: "We couldn't store your video",
      action: "retry",
    });
    expect(
      messageFor(error("CLOUDINARY_UPLOAD_FAILED", { retryable: false }), limits),
    ).toMatchObject({
      title: "Can't read the video",
      action: "choose-another-file",
    });
  });

  it("shows the wait time for rate limits", () => {
    expect(messageFor(error("RATE_LIMITED", { retryAfterSeconds: 42 }), limits)).toEqual({
      title: "Too many uploads",
      description: "Try again in 42 seconds.",
      action: "wait",
    });
    expect(messageFor(error("RATE_LIMITED", { retryAfterSeconds: 1 }), limits).description).toBe(
      "Try again in 1 second.",
    );
  });

  it("falls back to the server message for unknown codes", () => {
    expect(
      messageFor(error("SOMETHING_NEW", { retryable: true, message: "New failure" }), limits),
    ).toEqual({
      title: "Something went wrong",
      description: "New failure",
      action: "retry",
    });
  });
});
