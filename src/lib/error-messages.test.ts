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
    expect(
      messageFor(error("SOMETHING_NEW", { retryable: false, message: "New failure" }), limits)
        .action,
    ).toBe("none");
  });

  it("explains an invalid video URL", () => {
    expect(messageFor(error("INVALID_VIDEO_URL"), limits)).toEqual({
      title: "We couldn't find your upload",
      description: "This video address is not valid. Please upload again.",
      action: "choose-another-file",
    });
  });

  it("explains a check-your-upload failure for both Uploadcare branches", () => {
    expect(messageFor(error("UPLOADCARE_FAILED", { retryable: true }), limits)).toMatchObject({
      title: "We couldn't check your upload",
      action: "retry",
    });
    expect(messageFor(error("UPLOADCARE_FAILED", { retryable: false }), limits)).toMatchObject({
      title: "We couldn't check your upload",
      action: "choose-another-file",
    });
  });

  it("asks for the video again after an interrupted browser upload", () => {
    expect(messageFor(error("UPLOAD_INTERRUPTED"), limits)).toEqual({
      title: "The upload didn't finish",
      description: "Check your connection and choose the video again.",
      action: "choose-another-file",
    });
  });

  it("offers a retry for a database outage", () => {
    expect(messageFor(error("DATABASE_UNAVAILABLE"), limits)).toEqual({
      title: "Service unavailable",
      description: "Try again shortly.",
      action: "retry",
    });
  });

  it("offers a retry for a client-side network problem", () => {
    expect(messageFor(error("NETWORK_ERROR"), limits)).toMatchObject({
      title: "Connection problem",
      action: "retry",
    });
  });

  it("switches the rate-limit wait to minutes at 60 seconds and rounds up", () => {
    expect(messageFor(error("RATE_LIMITED", { retryAfterSeconds: 59 }), limits).description).toBe(
      "Try again in 59 seconds.",
    );
    expect(messageFor(error("RATE_LIMITED", { retryAfterSeconds: 60 }), limits).description).toBe(
      "Try again in 1 minute.",
    );
    expect(messageFor(error("RATE_LIMITED", { retryAfterSeconds: 119 }), limits).description).toBe(
      "Try again in 2 minutes.",
    );
    expect(messageFor(error("RATE_LIMITED", { retryAfterSeconds: 600 }), limits).description).toBe(
      "Try again in 10 minutes.",
    );
  });

  it("never offers a Try again that cannot work before anything has uploaded", () => {
    expect(messageFor(error("DATABASE_UNAVAILABLE"), limits, { stage: "rejected" })).toMatchObject({
      action: "choose-another-file",
    });
    expect(messageFor(error("NETWORK_ERROR"), limits, { stage: "rejected" })).toMatchObject({
      action: "choose-another-file",
    });
    expect(
      messageFor(error("CLOUDINARY_UPLOAD_FAILED", { retryable: true }), limits, {
        stage: "rejected",
      }),
    ).toMatchObject({ action: "choose-another-file" });
  });

  it("keeps the rate limit wait-only in the rejected stage", () => {
    expect(
      messageFor(error("RATE_LIMITED", { retryAfterSeconds: 30 }), limits, { stage: "rejected" }),
    ).toMatchObject({ action: "wait" });
  });

  it("offers a timed retry for a rate limit once bytes are already stored", () => {
    expect(
      messageFor(error("RATE_LIMITED", { retryAfterSeconds: 30 }), limits, { stage: "failed" }),
    ).toMatchObject({ action: "wait-retry" });
    expect(messageFor(error("RATE_LIMITED", { retryAfterSeconds: 30 }), limits)).toMatchObject({
      action: "wait",
    });
  });
});
