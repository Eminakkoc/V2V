// @vitest-environment jsdom
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropZone } from "./drop-zone";

function renderZone(overrides: Partial<Parameters<typeof DropZone>[0]> = {}) {
  const props = {
    formatsHint: "MP4 or MOV · up to 100 MB",
    clipHint: "Any length. You will pick a clip of up to 60 seconds next.",
    invalid: false,
    onFile: vi.fn(),
    onChoose: vi.fn(),
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

  it("offers a single Choose button and no recording affordance", () => {
    const props = renderZone();
    fireEvent.click(screen.getByRole("button", { name: /choose a video/i }));
    expect(props.onChoose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("points at the error message when invalid", () => {
    renderZone({ invalid: true, describedBy: "upload-error" });
    expect(screen.getByRole("group", { name: "Drop a video here" })).toHaveAttribute(
      "aria-describedby",
      "upload-error",
    );
  });

  it("forwards a focusable ref to the title, for focus management after replacing a video", () => {
    const ref = createRef<HTMLParagraphElement>();
    renderZone({ titleRef: ref });
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(screen.getByText("Drop a video here"));
  });
});
