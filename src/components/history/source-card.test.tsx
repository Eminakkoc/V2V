// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SourceView } from "@/lib/history-contract";
import { SourceCard } from "./source-card";

function buildSource(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: "source-1",
    cloudinaryPublicId: "sources/abc123",
    cloudinaryUrl: "https://res.cloudinary.com/demo/video/upload/v1/sources/abc123.mp4",
    format: "video/mp4",
    duration: 42,
    width: 1080,
    height: 1920,
    bytes: 12_000_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    transformCount: 0,
    ...overrides,
  };
}

describe("SourceCard", () => {
  it("shows the duration, upload date and transformation count", () => {
    render(<SourceCard source={buildSource({ transformCount: 3 })} cloudName="demo" />);

    expect(screen.getByText("0:42")).toBeInTheDocument();
    expect(screen.getByText("Jan 1, 2026", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("3 transformations")).toBeInTheDocument();
  });

  it("uses singular copy for exactly one transformation and a distinct copy for zero", () => {
    const { rerender } = render(
      <SourceCard source={buildSource({ transformCount: 1 })} cloudName="demo" />,
    );
    expect(screen.getByText("1 transformation")).toBeInTheDocument();

    rerender(<SourceCard source={buildSource({ transformCount: 0 })} cloudName="demo" />);
    expect(screen.getByText("No transformations yet")).toBeInTheDocument();
  });

  it("links Transform to the create page carrying this source's id, with no delete affordance", () => {
    render(<SourceCard source={buildSource({ id: "source-42" })} cloudName="demo" />);

    expect(screen.getByRole("link", { name: "Transform" })).toHaveAttribute(
      "href",
      "/?sourceId=source-42",
    );
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("gives the poster an alt description derived from the upload rather than leaving it decorative", () => {
    render(<SourceCard source={buildSource()} cloudName="demo" />);

    const poster = screen.getByRole("img");
    expect(poster.getAttribute("alt")).toMatch(/2026/);
    expect(poster.getAttribute("alt")).toMatch(/0:42/);
  });

  it("builds the poster URL from the source's own public id and the given cloud name", () => {
    render(
      <SourceCard
        source={buildSource({ cloudinaryPublicId: "sources/xyz" })}
        cloudName="my-cloud"
      />,
    );

    const poster = screen.getByRole("img");
    expect(poster.getAttribute("src")).toContain("my-cloud");
    expect(poster.getAttribute("src")).toContain("sources/xyz");
  });
});
