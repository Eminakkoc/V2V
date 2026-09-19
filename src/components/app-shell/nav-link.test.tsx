// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavLink } from "./nav-link";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

describe("NavLink", () => {
  it("marks the current page", () => {
    pathname.value = "/history";
    render(
      <>
        <NavLink href="/">Create</NavLink>
        <NavLink href="/history">History</NavLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Create" })).not.toHaveAttribute("aria-current");
  });

  it("treats only the root path as Create", () => {
    pathname.value = "/";
    render(<NavLink href="/">Create</NavLink>);
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute("aria-current", "page");
  });
});
