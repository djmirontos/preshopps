import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { ListingCardData, ListingCondition } from "@/components/marketplace/ListingCard";

/**
 * Row shape exactly matching public.browse_listings' RETURNS TABLE, confirmed
 * live via pg_get_functiondef immediately before writing this module (no
 * generated Supabase DB types exist yet, so this is a deliberately narrow,
 * hand-written type rather than a broad Record<string, unknown>). Only the
 * fields the homepage cards actually need are consumed by the mapper below;
 * the rest exist for future use (search/filter UI, listing detail) and are
 * left untouched here.
 */
export type BrowseListingRow = {
  listing_id: string;
  public_code: string;
  slug: string;
  title: string;
  price_cents: number;
  original_price_cents: number | null;
  is_negotiable: boolean;
  listing_type: "preloved" | "brand_new";
  condition: "brand_new" | "like_new" | "very_good" | "good" | "fair";
  status: string;
  is_inquiry_only: boolean;
  created_at: string;
  category_id: number;
  category_name: string;
  province_name: string;
  city_name: string;
  barangay_name: string | null;
  cover_image_storage_path: string | null;
  shop_id: string;
  shop_slug: string;
  shop_name: string;
  shop_logo_storage_path: string | null;
  shop_status: string;
  is_trusted_seller: boolean;
};

export type BrowseSection = {
  listings: ListingCardData[];
  /** True when the RPC call itself failed (error or thrown) — distinct from
   * a genuinely empty result set, so the UI can show "unable to load" vs
   * "no listings yet" appropriately. */
  hadError: boolean;
};

type BrowseListingsArgs = {
  p_sort: "newest";
  p_limit: number;
  p_listing_type?: "preloved" | "brand_new";
};

const VALID_CARD_CONDITIONS: ReadonlySet<string> = new Set<ListingCondition>([
  "like_new",
  "very_good",
  "good",
  "fair",
]);

function mapCondition(raw: BrowseListingRow["condition"]): ListingCondition | undefined {
  return VALID_CARD_CONDITIONS.has(raw) ? (raw as ListingCondition) : undefined;
}

/** Matches the relative-time label style already used elsewhere on cards
 * (PRD §16.1: "Just now", "2 hours ago", "3 days ago", "2 weeks ago"). */
function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** No storage bucket exists live yet (confirmed read-only), so this path is
 * currently unexercised by any real row — but it follows the documented
 * Supabase public-storage URL shape and the exact project host only
 * (no wildcard remote host). */
function getListingImageUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  const { url } = getSupabaseEnv();
  return `${url}/storage/v1/object/public/${path}`;
}

export function mapBrowseRowToListingCard(row: BrowseListingRow): ListingCardData {
  return {
    id: row.listing_id,
    href: `/item/${row.slug}`,
    title: row.title,
    priceCents: row.price_cents,
    originalPriceCents: row.original_price_cents ?? undefined,
    isNegotiable: row.is_negotiable,
    listingType: row.listing_type,
    condition: row.listing_type === "preloved" ? mapCondition(row.condition) : undefined,
    locationLabel: row.city_name,
    postedLabel: formatRelativeTime(row.created_at),
    shopName: row.shop_name,
    imageUrl: getListingImageUrl(row.cover_image_storage_path),
  };
}

/**
 * Client creation (and the cookies() read inside it) happens before any
 * RPC-specific error handling begins, so ordinary Next.js server/runtime
 * behavior around that call is never caught or reinterpreted here — it
 * simply propagates like any other server-side call in this codebase.
 * Only the browse_listings invocation itself is wrapped, and only to catch
 * a genuine transport-level failure (e.g. the fetch to PostgREST rejecting);
 * a normal { data, error } response from a reachable RPC is handled
 * explicitly below without needing the catch at all.
 */
async function browseListingsSection(args: BrowseListingsArgs): Promise<BrowseSection> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("browse_listings", args));
  } catch (err) {
    console.error("browse_listings RPC threw:", err instanceof Error ? err.message : err);
    return { listings: [], hadError: true };
  }

  if (error) {
    console.error("browse_listings RPC failed:", error.message);
    return { listings: [], hadError: true };
  }

  const rows = (data ?? []) as BrowseListingRow[];
  return { listings: rows.map(mapBrowseRowToListingCard), hadError: false };
}

export type HomepageMarketplaceData = {
  freshFinds: BrowseSection;
  preLoved: BrowseSection;
  brandNew: BrowseSection;
};

/**
 * Fetches all three homepage rails concurrently via the public
 * browse_listings RPC only (no raw table access, no service role). Global
 * marketplace visibility ("All Philippines") is simply every location
 * filter left at its RPC default (null) — the location selector isn't
 * wired yet, so no province/city/barangay args are ever passed here.
 */
export async function getHomepageMarketplaceData(): Promise<HomepageMarketplaceData> {
  const [freshFinds, preLoved, brandNew] = await Promise.all([
    browseListingsSection({ p_sort: "newest", p_limit: 10 }),
    browseListingsSection({ p_sort: "newest", p_limit: 5, p_listing_type: "preloved" }),
    browseListingsSection({ p_sort: "newest", p_limit: 5, p_listing_type: "brand_new" }),
  ]);

  return { freshFinds, preLoved, brandNew };
}
