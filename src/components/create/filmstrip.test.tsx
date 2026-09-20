// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Filmstrip } from "./filmstrip";

const SRC = "https://res.cloudinary.com/demo/video/upload/sources/a.mp4";

// Extraction advances one `await` at a time as each DOM event resolves a
// pending promise; the next event in a sequence must not fire until that
// continuation has actually run and registered its own listener.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom has no real canvas backend; each test controls what "extraction"
  // sees by stubbing the 2D context it gets back.
  getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,AAA");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Filmstrip", () => {
  it("renders the plain fallback track for a zero-length video without touching the canvas", () => {
    render(<Filmstrip src={SRC} duration={0} />);
    expect(screen.getByTestId("filmstrip-fallback")).toBeInTheDocument();
    expect(getContextSpy).not.toHaveBeenCalled();
  });

  it("draws extracted frames once the hidden video reports metadata and a seek", async () => {
    getContextSpy.mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const { container } = render(<Filmstrip src={SRC} duration={1} />);
    const video = container.querySelector("video");
    if (!video) throw new Error("expected a hidden <video>");

    fireEvent(video, new Event("loadedmetadata"));
    await flush();
    fireEvent(video, new Event("seeked"));

    expect(await screen.findAllByTestId("filmstrip-frame")).toHaveLength(1);
    expect(screen.queryByTestId("filmstrip-fallback")).not.toBeInTheDocument();
  });

  // The required case: extraction can fail for reasons entirely outside the
  // trimmer's control (no CORS headers, a mobile browser that refuses to
  // seek an off-screen video, ...). It must never do worse than showing the
  // plain track.
  it("falls back to the plain track when a thrown extraction error occurs", async () => {
    const drawImage = vi.fn(() => {
      throw new Error("canvas is tainted");
    });
    getContextSpy.mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const { container } = render(<Filmstrip src={SRC} duration={1} />);
    const video = container.querySelector("video");
    if (!video) throw new Error("expected a hidden <video>");

    fireEvent(video, new Event("loadedmetadata"));
    await flush();
    fireEvent(video, new Event("seeked"));
    await waitFor(() => expect(drawImage).toHaveBeenCalled());

    expect(screen.getByTestId("filmstrip-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("filmstrip-frame")).not.toBeInTheDocument();
  });

  it("falls back to the plain track when the video element errors instead of seeking", async () => {
    const drawImage = vi.fn();
    getContextSpy.mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const { container } = render(<Filmstrip src={SRC} duration={1} />);
    const video = container.querySelector("video");
    if (!video) throw new Error("expected a hidden <video>");

    fireEvent(video, new Event("loadedmetadata"));
    await flush();
    fireEvent(video, new Event("error"));
    await flush();

    expect(screen.getByTestId("filmstrip-fallback")).toBeInTheDocument();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("cancels outstanding seeks on unmount instead of updating state afterwards", async () => {
    getContextSpy.mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const { container, unmount } = render(<Filmstrip src={SRC} duration={1} />);
    const video = container.querySelector("video");
    if (!video) throw new Error("expected a hidden <video>");

    fireEvent(video, new Event("loadedmetadata"));
    await flush(); // now genuinely mid-seek, waiting on "seeked"
    unmount();

    // A seek that resolves after unmount must not throw or warn about
    // updating state on an unmounted component.
    expect(() => fireEvent(video, new Event("seeked"))).not.toThrow();
  });
});
