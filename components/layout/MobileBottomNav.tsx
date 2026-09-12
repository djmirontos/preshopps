"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CirclePlus, Home, MessageCircle, Search, UserCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { SellGate } from "@/components/auth/SellGate";
import { useUnreadMessageCount } from "@/components/notifications/NotificationsProvider";
import type { AuthUser } from "@/lib/auth/session";

type Props = {
  user: AuthUser | null;
  /** Sourced from one root-layout-level getMyShop() call, same convention
   * as AppHeader's unreadNotificationCount -- defaults to false so every
   * existing call site/test that doesn't pass it keeps rendering exactly
   * as before for a guest (the only case that default is ever visible in,
   * since SellGate ignores hasShop entirely when signed out). */
  hasShop?: boolean;
};

const TAB_CLASS =
  "flex h-full w-full flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

const LABEL_CLASS = "text-[11px] font-medium leading-none";

/**
 * Every tab (Sell included) reserves the same h-9 icon slot so all 5
 * labels sit at an identical baseline regardless of whether that slot
 * holds a bare icon or Sell's filled circle -- fixes the previous
 * misalignment where Sell's icon block was a different height than the
 * other four. `badgeCount` is optional and only ever passed for the
 * Messages tab -- every other tab renders exactly as before (no layout
 * shift: the icon slot's own size is unchanged, the badge is an
 * absolutely-positioned overlay on top of it).
 */
function tabContent(Icon: LucideIcon, label: string, isActive: boolean, badgeCount?: number) {
  return (
    <>
      <span className="relative flex h-9 w-9 items-center justify-center">
        <Icon className={cn("h-6 w-6", isActive ? "text-brand-link" : "text-ink-muted")} aria-hidden="true" />
        {Boolean(badgeCount) && badgeCount! > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-action px-1 text-[10px] font-semibold leading-none text-brand-action-text"
          >
            {badgeCount! > 99 ? "99+" : badgeCount}
          </span>
        )}
      </span>
      <span className={cn(LABEL_CLASS, isActive ? "text-brand-link" : "text-ink-muted")}>{label}</span>
    </>
  );
}

/**
 * Fixed bottom nav for mobile/tablet (<1024px). Hidden on desktop, where
 * navigation lives entirely in the header. Exactly the 5 canonical tabs —
 * cart and notifications intentionally live in the header instead.
 *
 * Sell and Account are auth-aware. Messages now links to /messages
 * (matching Search's own always-linked convention) -- the page itself
 * redirects a guest to sign-in, so no auth branching is needed here.
 */
export function MobileBottomNav({ user, hasShop = false }: Props) {
  const pathname = usePathname();
  const isAuthenticated = Boolean(user);
  const currentPath = pathname || "/";
  const unreadMessageCount = useUnreadMessageCount();

  const isHomeActive = pathname === "/";
  const isSearchActive = pathname?.startsWith("/search") ?? false;
  const isMessagesActive = pathname?.startsWith("/messages") ?? false;
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
          <SellGate isAuthenticated={isAuthenticated} hasShop={hasShop} className={TAB_CLASS}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-action text-brand-action-text">
              <CirclePlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className={cn(LABEL_CLASS, "text-ink-muted")}>Sell</span>
          </SellGate>
        </li>

        <li className="flex-1">
          <Link
            href="/messages"
            aria-label={unreadMessageCount > 0 ? `Messages, ${unreadMessageCount} unread` : "Messages"}
            aria-current={isMessagesActive ? "page" : undefined}
            className={TAB_CLASS}
          >
            {tabContent(MessageCircle, "Messages", isMessagesActive, unreadMessageCount)}
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
