"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavLinkProps = { href: string; children: React.ReactNode };

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isCurrent = href === "/" ? pathname === "/" : pathname.startsWith(href);
  // Read at click time rather than through useSearchParams, which would re-render the whole
  // root-layout shell on every filter change; the search string is included because only an exact
  // address match is a click with nothing to do.
  function suppressIfAlreadyHere(event: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof window === "undefined") return;
    const here = `${window.location.pathname}${window.location.search}`;
    if (here === href) event.preventDefault();
  }

  return (
    <Link
      href={href}
      onClick={suppressIfAlreadyHere}
      aria-current={isCurrent ? "page" : undefined}
      className={cn(
        // The current page is marked three ways, never by colour alone: accent-strong, SemiBold and
        // underlined, plus aria-current.
        "inline-flex min-h-11 items-center rounded-pill px-1 type-body focus-ring transition-colors sm:min-h-0",
        isCurrent
          ? "font-semibold text-accent-strong underline decoration-from-font"
          : "text-foreground hover:text-accent-strong",
      )}
    >
      {children}
    </Link>
  );
}
