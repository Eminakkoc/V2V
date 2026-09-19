import { describe, expect, it } from "vitest";
import { posterAtWidth, posterUrl, videoUrl } from "./cloudinary-urls";

describe("Cloudinary URLs", () => {
  it("builds the so_0 poster frame as a jpg", () => {
    expect(posterUrl("demo", "sources/ab12")).toBe(
      "https://res.cloudinary.com/demo/video/upload/so_0/sources/ab12.jpg",
    );
  });

  it("serves the stored original for playback", () => {
    expect(videoUrl("demo", "sources/ab12", "mov")).toBe(
      "https://res.cloudinary.com/demo/video/upload/sources/ab12.mov",
    );
  });

  it("encodes each public-id segment", () => {
    expect(posterUrl("demo", "sources/a b")).toBe(
      "https://res.cloudinary.com/demo/video/upload/so_0/sources/a%20b.jpg",
    );
  });

  it("requests a poster at display width", () => {
    expect(posterAtWidth(posterUrl("demo", "sources/ab12"), 640)).toBe(
      "https://res.cloudinary.com/demo/video/upload/so_0,w_640,c_limit,q_auto/sources/ab12.jpg",
    );
  });
});
