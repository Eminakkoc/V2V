// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadError, UploadProgress } from "./upload-feedback";

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
