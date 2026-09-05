import { createClient } from "@/lib/supabase/server";
import { mapBrowseRowToListingCard, type BrowseListingRow } from "@/lib/marketplace/browse-listings";
import type { BrowseCursor } from "@/lib/marketplace/search-params";
import type { ListingCardData } from "@/components/marketplace/ListingCard";

export type ShopListingsResult = {
  listings: ListingCardData[];
  hadError: boolean;
  nextCursor: BrowseCursor | null;
};

/**
 * Shop-scoped browse_listings call: p_shop_id set, sort fixed to newest
 * (canonical shop-page sort). browse_listings' own shop-scoped branch
 * admits status IN ('available', 'reserved') for that shop only -- sold/
 * archived are never returned here, so this module never needs to add
 * that filtering itself; it trusts the RPC's existing behavior. Same
 * narrow try/catch shape as browse-listings.ts/search-listings.ts:
 * client creation happens before any RPC-specific error handling.
 */
export async function getShopListings(
  shopId: string,
  limit: number,
  cursor?: BrowseCursor,
): Promise<ShopListingsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("browse_listings", {
      p_shop_id: shopId,
      p_sort: "newest",
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("browse_listings RPC threw:", err instanceof Error ? err.message : err);
    return { listings: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("browse_listings RPC failed:", error.message);
    return { listings: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as BrowseListingRow[];
  const listings = rows.map(mapBrowseRowToListingCard);
  const nextCursor =
    rows.length === limit
      ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].listing_id }
      : null;

  return { listings, hadError: false, nextCursor };
}
