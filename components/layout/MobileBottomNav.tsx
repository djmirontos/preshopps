"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CirclePlus, Home, MessageCircle, Search, UserCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "#", label: "Sell", icon: CirclePlus },
  { href: "#", label: "Messages", icon: MessageCircle },
  { href: "#", label: "Account", icon: UserCircle },
];

/**
 * Fixed bottom nav for mobile/tablet (<1024px). Hidden on desktop, where
 * navigation lives entirely in the header. Exactly the 5 canonical tabs —
 * cart and notifications intentionally live in the header instead.
 */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex h-16">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? pathname === "/" : href !== "#" && pathname?.startsWith(href);

          return (
            <li key={label} className="flex-1">
              <Link
                href={href}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                className="flex h-full flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <Icon
                  className={cn("h-6 w-6", isActive ? "text-brand-hover" : "text-ink-muted")}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    isActive ? "text-brand-hover" : "text-ink-muted",
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
