"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavLinkProps = { href: string; children: React.ReactNode };

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isCurrent = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
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
