import Link from "next/link";
import { NavLink } from "./nav-link";

export function TopBar() {
  return (
    <header className="w-full">
      <div className="page-shell flex h-[60px] items-center gap-4 sm:gap-6">
        <Link
          href="/"
          className="flex-1 rounded-pill font-display type-brand text-foreground focus-ring"
        >
          Restyle
        </Link>
        <nav aria-label="Main">
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
