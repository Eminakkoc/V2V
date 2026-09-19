// @vitest-environment jsdom
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadError, UploadProgress, UploadWaitRetry } from "./upload-feedback";

describe("UploadProgress", () => {
  it("shows real upload progress", () => {
    render(<UploadProgress state={{ status: "uploading", progress: 42 }} />);
    expect(screen.getByRole("progressbar", { name: "Uploading your video" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
  });

  it("names the storing wait", () => {
    render(<UploadProgress state={{ status: "storing" }} />);
    expect(screen.getByRole("progressbar", { name: "Storing your video" })).not.toHaveAttribute(
      "aria-valuenow",
    );
  });

  it("forwards a focusable ref to the label, for focus management after Try again", () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<UploadProgress state={{ status: "storing" }} labelRef={ref} />);
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(screen.getByText("Storing your video"));
  });
});

describe("UploadError", () => {
  const handlers = () => ({ onRetry: vi.fn(), onChooseAnother: vi.fn() });

  it("offers Try again for a retry action", () => {
    const actions = handlers();
    render(
      <UploadError
        id="upload-error"
        message={{ title: "We couldn't store your video", description: "d", action: "retry" }}
        {...actions}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't store your video");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.onRetry).toHaveBeenCalledOnce();
  });

  it("offers Choose another file for a file problem", () => {
    const actions = handlers();
    render(
      <UploadError
        id="upload-error"
        message={{
          title: "This video is too large",
          description: "Maximum size is 100 MB.",
          action: "choose-another-file",
        }}
        {...actions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(actions.onChooseAnother).toHaveBeenCalledOnce();
  });

  it("shows no button while waiting out a rate limit", () => {
    render(
      <UploadError
        id="upload-error"
        message={{
          title: "Too many uploads",
          description: "Try again in 42 seconds.",
          action: "wait",
        }}
        {...handlers()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("UploadWaitRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("disables Try again until the wait elapses, then enables it and calls onRetry", () => {
    const onRetry = vi.fn();
    render(
      <UploadWaitRetry
        id="upload-error"
        message={{
          title: "Too many uploads",
          description: "Try again in 5 seconds.",
          action: "wait-retry",
        }}
        retryAfterSeconds={5}
        onRetry={onRetry}
      />,
    );
    const button = screen.getByRole("button", { name: "Try again" });
    expect(button).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(button).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("starts disabled again on a fresh mount for a later wait", () => {
    // The caller only renders this component while failed, so a second rate
    // limit after a retry is a new mount (it unmounts during "storing"
    // between attempts), never a prop change on the same instance.
    const { unmount } = render(
      <UploadWaitRetry
        id="upload-error"
        message={{ title: "Too many uploads", description: "d", action: "wait-retry" }}
        retryAfterSeconds={5}
        onRetry={vi.fn()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    unmount();

    render(
      <UploadWaitRetry
        id="upload-error"
        message={{ title: "Too many uploads", description: "d", action: "wait-retry" }}
        retryAfterSeconds={10}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  });
});
