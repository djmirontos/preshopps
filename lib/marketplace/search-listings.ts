import { createClient } from "@/lib/supabase/server";
import { mapBrowseRowToListingCard, type BrowseListingRow } from "@/lib/marketplace/browse-listings";
import {
  toBrowseListingsArgs,
  type BrowseCursor,
  type ResolvedSearchFilters,
} from "@/lib/marketplace/search-params";
import type { ListingCardData } from "@/components/marketplace/ListingCard";

export type SearchListingsResult = {
  listings: ListingCardData[];
  hadError: boolean;
  nextCursor: BrowseCursor | null;
};

function computeNextCursor(row: BrowseListingRow, sort: ResolvedSearchFilters["sort"]): BrowseCursor {
  return sort === "newest"
    ? { createdAt: row.created_at, id: row.listing_id }
    : { priceCents: row.price_cents, id: row.listing_id };
}

/**
 * The /search equivalent of browse-listings.ts's homepage sections: same
 * browse_listings-only, narrow-try/catch shape -- client creation happens
 * before any RPC-specific error handling, exactly per the locked homepage
 * pattern, so ordinary Next.js server/runtime behavior around cookies()
 * is never caught or reinterpreted here -- but with the full filter
 * surface and keyset pagination instead of a fixed set of homepage args.
 */
export async function searchListings(
  filters: ResolvedSearchFilters,
  limit: number,
  cursor?: BrowseCursor,
): Promise<SearchListingsResult> {
  const supabase = await createClient();
  const args = toBrowseListingsArgs(filters, limit, cursor);

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("browse_listings", args));
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
  const nextCursor = rows.length === limit ? computeNextCursor(rows[rows.length - 1], filters.sort) : null;

  return { listings, hadError: false, nextCursor };
}
