import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyFavorites } from "@/lib/favorites/get-my-favorites";
import { FavoritesListingsClient } from "@/components/favorites/FavoritesListingsClient";
import type { BrowseCursor } from "@/lib/marketplace/search-params";

export const metadata = { title: "Favorites | Preshopps" };

const LISTINGS_LIMIT = 20;

/**
 * Authenticated-only, server-guarded exactly like /account: getAuthUser()
 * runs before any favorite data is fetched, so a guest never triggers
 * get_my_favorites at all. Uses the existing get_my_favorites RPC plus the
 * same ListingCard/ListingGrid/Load-More pattern already used on /search
 * and /shop/[slug] -- no new backend, no direct table reads of listing
 * data (get_my_favorites already returns the safe public projection).
 */
export default async function FavoritesPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/favorites")}`);
  }

  const result = await getMyFavorites(LISTINGS_LIMIT);

  async function loadMoreAction(cursor: BrowseCursor) {
    "use server";
    return getMyFavorites(LISTINGS_LIMIT, cursor);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Favorites</h1>
      <p className="mt-1 text-sm text-ink-secondary">Items you&apos;ve saved while browsing.</p>

      <div className="mt-6">
        <FavoritesListingsClient
          initialListings={result.listings}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
        />
      </div>
    </div>
  );
}
