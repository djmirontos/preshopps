import Link from "next/link";
import {
  Bell,
  ChevronDown,
  Heart,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  ShoppingBag,
  UserCircle,
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";

/**
 * Single responsive header for guest/buyer/seller alike (Phase 1: no
 * auth-aware behavior yet). Desktop (>=1024px) renders one row with a
 * fused search+location control and a right-hand icon cluster. Below
 * 1024px, a compact two-row mobile header is shown instead.
 *
 * All action icons/links are non-functional placeholders in this task —
 * no auth, no backend calls, no routing to unbuilt pages.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link
          href="/"
          className="shrink-0 rounded text-xl font-bold tracking-tight text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:text-2xl"
        >
          Preshopps
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
          <IconButton href="#" label="Favorites" icon={Heart} />
          <IconButton href="#" label="Messages" icon={MessageCircle} />
          <IconButton href="#" label="Notifications" icon={Bell} />
          <IconButton href="#" label="Cart" icon={ShoppingBag} />
          <IconButton href="#" label="Account" icon={UserCircle} />
          <Link
            href="#"
            className="ml-2 inline-flex h-10 items-center rounded-[10px] bg-brand-hover px-4 text-sm font-semibold text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Sell
          </Link>
        </nav>

        {/* Mobile right-hand icons */}
        <div className="ml-auto flex items-center gap-0.5 lg:hidden">
          <IconButton href="#" label="Notifications" icon={Bell} />
          <IconButton href="#" label="Cart" icon={ShoppingBag} />
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
