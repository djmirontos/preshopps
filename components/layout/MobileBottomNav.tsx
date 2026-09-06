"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CirclePlus, Home, MessageCircle, Search, UserCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { SellGate } from "@/components/auth/SellGate";
import type { AuthUser } from "@/lib/auth/session";

type Props = {
  user: AuthUser | null;
};

const TAB_CLASS =
  "flex h-full w-full flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

const LABEL_CLASS = "text-[11px] font-medium leading-none";

/**
 * Every tab (Sell included) reserves the same h-9 icon slot so all 5
 * labels sit at an identical baseline regardless of whether that slot
 * holds a bare icon or Sell's filled circle -- fixes the previous
 * misalignment where Sell's icon block was a different height than the
 * other four.
 */
function tabContent(Icon: LucideIcon, label: string, isActive: boolean) {
  return (
    <>
      <span className="flex h-9 w-9 items-center justify-center">
        <Icon className={cn("h-6 w-6", isActive ? "text-brand-hover" : "text-ink-muted")} aria-hidden="true" />
      </span>
      <span className={cn(LABEL_CLASS, isActive ? "text-brand-hover" : "text-ink-muted")}>{label}</span>
    </>
  );
}

/**
 * Fixed bottom nav for mobile/tablet (<1024px). Hidden on desktop, where
 * navigation lives entirely in the header. Exactly the 5 canonical tabs —
 * cart and notifications intentionally live in the header instead.
 *
 * Sell and Account are auth-aware; Home/Search/Messages are unchanged
 * (Messages remains the existing non-functional placeholder -- its real
 * backend isn't in scope yet).
 */
export function MobileBottomNav({ user }: Props) {
  const pathname = usePathname();
  const isAuthenticated = Boolean(user);
  const currentPath = pathname || "/";

  const isHomeActive = pathname === "/";
  const isSearchActive = pathname?.startsWith("/search") ?? false;
  const isAccountActive = pathname?.startsWith("/account") ?? false;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex h-16">
        <li className="flex-1">
          <Link href="/" aria-label="Home" aria-current={isHomeActive ? "page" : undefined} className={TAB_CLASS}>
            {tabContent(Home, "Home", isHomeActive)}
          </Link>
        </li>

        <li className="flex-1">
          <Link
            href="/search"
            aria-label="Search"
            aria-current={isSearchActive ? "page" : undefined}
            className={TAB_CLASS}
          >
            {tabContent(Search, "Search", isSearchActive)}
          </Link>
        </li>

        <li className="flex-1">
          <SellGate isAuthenticated={isAuthenticated} className={TAB_CLASS}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-hover text-white">
              <CirclePlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className={cn(LABEL_CLASS, "text-ink-muted")}>Sell</span>
          </SellGate>
        </li>

        <li className="flex-1">
          <Link href="#" aria-label="Messages" className={TAB_CLASS}>
            {tabContent(MessageCircle, "Messages", false)}
          </Link>
        </li>

        <li className="flex-1">
          <Link
            href={isAuthenticated ? "/account" : `/sign-in?next=${encodeURIComponent(currentPath)}`}
            aria-label="Account"
            aria-current={isAuthenticated && isAccountActive ? "page" : undefined}
            className={TAB_CLASS}
          >
            {tabContent(UserCircle, "Account", isAuthenticated && isAccountActive)}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
