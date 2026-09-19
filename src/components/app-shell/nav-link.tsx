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
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-hidden",
        isCurrent && "bg-muted text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
