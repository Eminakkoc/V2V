// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropZone } from "./drop-zone";

function renderZone(overrides: Partial<Parameters<typeof DropZone>[0]> = {}) {
  const props = {
    hint: "MP4 or MOV · up to 100 MB",
    invalid: false,
    onFile: vi.fn(),
    onChoose: vi.fn(),
    onRecord: vi.fn(),
    ...overrides,
  };
  render(<DropZone {...props} />);
  return props;
}

describe("DropZone", () => {
  it("hands a dropped file to onFile", () => {
    const props = renderZone();
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    fireEvent.drop(screen.getByRole("group", { name: "Drop a video here" }), {
      dataTransfer: { files: [file] },
    });
    expect(props.onFile).toHaveBeenCalledWith(file);
  });

  it("offers Choose and Record buttons", () => {
    const props = renderZone();
    fireEvent.click(screen.getByRole("button", { name: /choose a video/i }));
    fireEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(props.onChoose).toHaveBeenCalledOnce();
    expect(props.onRecord).toHaveBeenCalledOnce();
  });

  it("points at the error message when invalid", () => {
    renderZone({ invalid: true, describedBy: "upload-error" });
    expect(screen.getByRole("group", { name: "Drop a video here" })).toHaveAttribute(
      "aria-describedby",
      "upload-error",
    );
  });
});
