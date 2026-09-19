import Link from "next/link";
import { NavLink } from "./nav-link";

export function TopBar() {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-1">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          V2V Transform
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1">
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
