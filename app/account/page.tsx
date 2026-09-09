import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Heart, List, Package, Settings, Store } from "lucide-react";
import { getAuthUser } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";

export const metadata = { title: "Account | Preshopps" };

/**
 * Minimal account page: signed-in email, a Favorites entry, and Sign out,
 * per the approved MVP scope -- no profile editing yet. Guarded server-side
 * (getAuthUser() runs before anything renders), not by a hidden client
 * check, so no account data is ever sent to an unauthenticated request.
 *
 * Favorites, Orders, My Shop, My Listings, and Seller Orders are reachable
 * here rather than as extra bottom-nav tabs -- the canonical mobile bottom
 * nav stays Home/Search/Sell/Messages/Account (see MobileBottomNav.tsx) --
 * so these links are mobile's only path to /favorites, /orders,
 * /seller/shop, /seller/listings, and /seller/orders (desktop also has the
 * header heart icon for Favorites in AppHeader.tsx; the others have no
 * header entry). My Shop, My Listings, and Seller Orders are all shown to
 * every signed-in account, not only accounts that already have a shop --
 * /seller/shop itself renders the setup form for an account with no shop
 * yet, and /seller/listings and /seller/orders each show their own
 * explanatory state, rather than hiding any entry point entirely.
 */
export default async function AccountPage() {
  const user = await getAuthUser();

  if (!user) {
    // Matches the encodeURIComponent(...) convention used everywhere else
    // a next= param is built (AccountEntry, MobileBottomNav, AuthGate).
    redirect(`/sign-in?next=${encodeURIComponent("/account")}`);
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-10 sm:py-16">
      <div className="rounded-[14px] border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-bold text-ink">Account</h1>
        <p className="mt-4 text-sm text-ink-secondary">Signed in as</p>
        <p className="text-sm font-medium text-ink">{user.email}</p>

        <Link
          href="/favorites"
          className="mt-6 flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
            Favorites
          </span>
          <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
        </Link>

        <Link
          href="/orders"
          className="mt-3 flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="flex items-center gap-2">
            <Package className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
            Orders
          </span>
          <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
        </Link>

        <Link
          href="/seller/shop"
          className="mt-3 flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
            My Shop
          </span>
          <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
        </Link>

        <Link
          href="/seller/listings"
          className="mt-3 flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="flex items-center gap-2">
            <List className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
            My Listings
          </span>
          <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
        </Link>

        <Link
          href="/seller/orders"
          className="mt-3 flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="flex items-center gap-2">
            <Store className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
            Seller Orders
          </span>
          <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
        </Link>

        <form action={signOutAction} className="mt-3">
          <button
            type="submit"
            className="h-11 w-full rounded-[10px] border border-border text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
