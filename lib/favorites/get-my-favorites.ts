import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/browse-listings";
import type { BrowseCursor } from "@/lib/marketplace/search-params";
import type { ListingCardData } from "@/components/marketplace/ListingCard";

/**
 * Row shape exactly matching public.get_my_favorites' RETURNS TABLE
 * (0037_favorites_cart_rls_and_rpcs.sql) -- confirmed by reading the
 * migration immediately before writing this module. Deliberately narrower
 * than browse_listings' projection: no listing_type/condition/
 * is_negotiable/original_price_cents, since the RPC was designed as a
 * lightweight bookmarks projection, not a full card feed. See
 * mapFavoriteRowToListingCard for how that gap is handled without
 * fabricating data.
 */
export type FavoriteRow = {
  favorite_id: string;
  favorited_at: string;
  listing_id: string;
  status: "available" | "reserved" | "sold" | "archived" | "unavailable";
  public_code: string | null;
  slug: string | null;
  title: string | null;
  price_cents: number | null;
  cover_image_storage_path: string | null;
  province_name: string | null;
  city_name: string | null;
  shop_id: string | null;
  shop_slug: string | null;
  shop_name: string | null;
};

export type GetMyFavoritesResult = {
  listings: ListingCardData[];
  hadError: boolean;
  nextCursor: BrowseCursor | null;
};

function mapCardStatus(status: FavoriteRow["status"]): ListingCardData["status"] {
  return status === "reserved" || status === "sold" || status === "archived" ? status : undefined;
}

/**
 * get_my_favorites never reveals a hidden/private listing's real fields --
 * a paused/draft listing, or one whose shop is currently suspended,
 * collapses server-side to status="unavailable" with every other field
 * null. There is nothing safe to render as a card for that row (no
 * public_code to link to, no title), so it's filtered out here rather than
 * rendered as a broken card -- the favorite row itself still exists and
 * remains removable from get_my_favorites' own future calls or from the
 * favorite state elsewhere; this module only decides what's displayable.
 */
function mapFavoriteRowToListingCard(row: FavoriteRow): ListingCardData | null {
  if (row.status === "unavailable" || !row.public_code || !row.title || row.price_cents === null) {
    return null;
  }

  return {
    id: row.listing_id,
    href: `/item/${row.public_code}`,
    title: row.title,
    priceCents: row.price_cents,
    // Not returned by get_my_favorites (a deliberately lightweight
    // bookmarks projection, unlike browse_listings/get_listing_detail) --
    // left undefined rather than guessed. ListingCard omits the Pre-
    // loved/Brand New + condition line entirely when this is undefined,
    // it never fabricates a value. See report for the product-decision
    // writeup on this backend/frontend boundary.
    listingType: undefined,
    locationLabel: row.city_name ?? "",
    shopName: row.shop_name ?? "",
    imageUrl: getListingImageUrl(row.cover_image_storage_path),
    status: mapCardStatus(row.status),
  };
}

/**
 * Client creation happens before any RPC-specific error handling, mirroring
 * every other marketplace data module (browse-listings.ts, shop-listings.ts,
 * search-listings.ts) -- only the get_my_favorites invocation itself is
 * wrapped, and only to catch a genuine transport-level failure.
 */
export async function getMyFavorites(limit: number, cursor?: BrowseCursor): Promise<GetMyFavoritesResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_favorites", {
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_my_favorites RPC threw:", err instanceof Error ? err.message : err);
    return { listings: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_my_favorites RPC failed:", error.message);
    return { listings: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as FavoriteRow[];
  const listings = rows.map(mapFavoriteRowToListingCard).filter((card): card is ListingCardData => card !== null);
  const nextCursor =
    rows.length === limit
      ? { createdAt: rows[rows.length - 1].favorited_at, id: rows[rows.length - 1].favorite_id }
      : null;

  return { listings, hadError: false, nextCursor };
}
