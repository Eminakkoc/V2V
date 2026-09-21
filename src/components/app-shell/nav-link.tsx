"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavLinkProps = { href: string; children: React.ReactNode };

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isCurrent = href === "/" ? pathname === "/" : pathname.startsWith(href);
  // Read at click time from the address bar rather than from useSearchParams:
  // this link sits in the root layout, and subscribing there to the query
  // string would re-render the whole shell on every filter change.
  //
  // The comparison includes the search string on purpose. `isCurrent` above is
  // deliberately loose -- /history?tab=sources still underlines History -- but
  // on such a page the link genuinely does something: it clears the filters.
  // Only an exact address match is a click with nothing to do.
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
        // The current page is marked three ways, never by colour alone (1.4.1):
        // accent-strong, SemiBold and underlined, plus aria-current.
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
