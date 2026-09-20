// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopyableUrl } from "./copyable-url";

const URL = "https://res.cloudinary.com/demo/video/upload/v1700000000/clip.mp4";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

describe("CopyableUrl", () => {
  it("renders the URL as a real link that opens in a new tab", () => {
    render(<CopyableUrl kind="source" url={URL} />);
    const link = screen.getByRole("link", { name: URL });
    expect(link).toHaveAttribute("href", URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("names the copy button after which URL it copies", () => {
    render(<CopyableUrl kind="result" url={URL} />);
    expect(screen.getByRole("button", { name: "Copy result URL" })).toBeInTheDocument();
  });

  it("writes the exact URL to the clipboard when the copy button is pressed", async () => {
    let received: string | undefined;
    stubClipboard(async (text) => {
      received = text;
    });
    render(<CopyableUrl kind="result" url={URL} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy result URL" }));

    await waitFor(() => expect(received).toBe(URL));
  });

  it("confirms a successful copy through the polite live region, not just visually", async () => {
    stubClipboard(async () => {});
    const { container } = render(<CopyableUrl kind="result" url={URL} />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "Copy result URL" }));

    await waitFor(() => expect(region).toHaveTextContent(/result url/i));
  });

  it("reports failure through the same live region when the clipboard write rejects", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const { container } = render(<CopyableUrl kind="result" url={URL} />);
    const region = container.querySelector('[aria-live="polite"]');

    fireEvent.click(screen.getByRole("button", { name: "Copy result URL" }));

    await waitFor(() => expect(region).toHaveTextContent(/couldn.?t copy/i));
  });
});
