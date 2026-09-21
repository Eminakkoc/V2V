import Link from "next/link";
import { NavLink } from "./nav-link";

export function TopBar() {
  return (
    // Pinned, so the nav and -- on /history -- the filter row above the scrolling list stay in
    // reach; the height lives in --header-h because /history subtracts it from the viewport.
    // The box-shadow is a 2px slab of the page background sitting above the bar, and it is what
    // closes the hairline of scrolling content that otherwise shows through the top edge: a stuck
    // element is composited on whole device pixels while the content under it scrolls on
    // fractional ones, so at a fractional offset (trackpad momentum, or any browser zoom off
    // 100%) the bar lands up to a pixel short of the viewport edge. The slab travels with the bar
    // and fills whatever it leaves; every other moment it is off-screen above it.
    <header className="sticky top-0 z-40 h-(--header-h) w-full border-b border-divider bg-bg [box-shadow:0_-2px_0_0_var(--color-bg)]">
      <div className="page-shell flex h-full items-center gap-4 sm:gap-6">
        <Link
          href="/"
          className="min-w-0 flex-1 truncate rounded-pill font-display type-brand text-foreground focus-ring"
        >
          V2V Transform
        </Link>
        <nav aria-label="Main" className="shrink-0">
          <ul className="flex items-center gap-4 sm:gap-6">
            <li>
              <NavLink href="/">Create</NavLink>
            </li>
            <li>
              <NavLink href="/history">History</NavLink>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
