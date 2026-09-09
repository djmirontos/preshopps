import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Heart, MapPin, MessageCircle, Plus, Search } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { AccountEntry } from "@/components/auth/AccountEntry";
import { SellGate } from "@/components/auth/SellGate";
import { CartIconLink } from "@/components/cart/CartIconLink";
import { NotificationBellLink } from "@/components/notifications/NotificationBellLink";
import type { AuthUser } from "@/lib/auth/session";

type Props = {
  user: AuthUser | null;
  /** Sourced from one root-layout-level get_my_notification_unread_count
   * call (lib/notifications/get-my-notification-unread-count.ts) -- never
   * fetched here, so this component adds no query of its own. Defaults to
   * 0 so every existing call site (and every existing test) that doesn't
   * pass it keeps rendering exactly as before. */
  unreadNotificationCount?: number;
  /** Sourced from one root-layout-level getMyShop() call, same convention
   * as unreadNotificationCount above -- defaults to false. */
  hasShop?: boolean;
};

/**
 * Single responsive header for guest/buyer/seller alike. Desktop
 * (>=1024px) renders one row with a fused search+location control and a
 * right-hand icon cluster. Below 1024px, a compact two-row mobile header
 * is shown instead.
 *
 * Account, Favorites, Cart, Messages, and Notifications are all real.
 * Messages/Notifications link directly to their own routes (matching the
 * Favorites icon's own convention) -- those pages themselves redirect a
 * guest to sign-in, so no auth branching is needed here. Notifications
 * carries an unread-count badge, since get_my_notification_unread_count
 * is a single efficient scalar RPC already supported cleanly by the
 * backend (see NotificationBellLink) -- unlike Messages, which has no
 * equivalent cheap count RPC and therefore stays badge-less.
 */
export function AppHeader({ user, unreadNotificationCount = 0, hasShop = false }: Props) {
  const isAuthenticated = Boolean(user);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link
          href="/"
          aria-label="Preshopps"
          className="flex shrink-0 items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:gap-2"
        >
          <Image
            src="/images/brand/Preshopps Logo.png"
            alt=""
            width={64}
            height={64}
            priority
            className="h-7 w-7 lg:h-9 lg:w-9"
          />
          <Image
            src="/images/brand/preshopps_text.png"
            alt=""
            width={1116}
            height={224}
            priority
            className="h-6 w-auto lg:h-7"
          />
        </Link>

        {/* Desktop: fused search + location, centered. Plain GET form --
            Enter submits to /search?q=... with no client JS required. */}
        <div className="hidden flex-1 justify-center lg:flex">
          <form
            action="/search"
            className="flex w-full max-w-xl items-center rounded-full border border-border bg-canvas pl-3 pr-1.5"
          >
            <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              type="text"
              name="q"
              placeholder="Search for anything…"
              aria-label="Search for anything"
              className="w-full bg-transparent px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
            <Link
              href="/search"
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-2.5 text-sm text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              All Philippines
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </form>
        </div>

        {/* Desktop right-hand actions */}
        <nav aria-label="Account actions" className="ml-auto hidden items-center gap-0.5 lg:flex">
          <IconButton href="/favorites" label="Favorites" icon={Heart} />
          <IconButton href="/messages" label="Messages" icon={MessageCircle} />
          <NotificationBellLink unreadCount={unreadNotificationCount} />
          <CartIconLink />
          <AccountEntry isAuthenticated={isAuthenticated} email={user?.email ?? null} />
          <SellGate
            isAuthenticated={isAuthenticated}
            hasShop={hasShop}
            className="ml-2 inline-flex h-10 items-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Sell
          </SellGate>
        </nav>

        {/* Mobile right-hand icons */}
        <div className="ml-auto flex items-center gap-0.5 lg:hidden">
          <NotificationBellLink unreadCount={unreadNotificationCount} />
          <CartIconLink />
        </div>
      </div>

      {/* Mobile row 2: search + location -- same plain GET form pattern. */}
      <div className="border-t border-divider px-4 py-2.5 sm:px-6 lg:hidden">
        <form
          action="/search"
          className="flex items-center gap-1.5 rounded-full border border-border bg-canvas py-1 pl-3 pr-1.5"
        >
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            type="text"
            name="q"
            placeholder="Search for anything…"
            aria-label="Search for anything"
            className="w-full bg-transparent py-1.5 text-base text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <Link
            href="/search"
            className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-1.5 text-xs font-medium text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            All PH
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </Link>
        </form>
      </div>
    </header>
  );
}
