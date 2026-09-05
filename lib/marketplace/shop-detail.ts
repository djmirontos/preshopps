import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/browse-listings";

/**
 * Row shape exactly matching public.get_shop_detail's RETURNS TABLE,
 * confirmed live via pg_get_functiondef immediately before writing this
 * module. requested_slug/current_slug/is_current_slug together implement
 * the canonical "old slugs redirect forever" rule -- the RPC resolves
 * through shop_slugs (historical slugs included) itself, so no separate
 * slug-history query is ever needed here.
 */
export type GetShopDetailRow = {
  shop_id: string;
  requested_slug: string;
  current_slug: string;
  is_current_slug: boolean;
  name: string;
  description: string | null;
  logo_storage_path: string | null;
  messenger_link: string | null;
  shop_status: "active" | "away";
  is_trusted_seller: boolean;
  member_since: string;
  province_name: string;
  city_name: string;
  barangay_name: string | null;
  review_count: number;
  average_rating: number | null;
  completed_order_count: number;
  active_listing_count: number;
  featured_listing_id: string | null;
};

export type ShopStatus = GetShopDetailRow["shop_status"];

export type ShopDetail = {
  id: string;
  /** Always the canonical slug, regardless of which slug was requested --
   * use this (not the requested one) for any link built from this DTO. */
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | undefined;
  messengerLink: string | null;
  status: ShopStatus;
  isTrustedSeller: boolean;
  memberSinceLabel: string;
  locationLabel: string;
  reviewCount: number;
  averageRating: number | null;
  completedOrderCount: number;
  activeListingCount: number;
  featuredListingId: string | null;
};

/** Barangay, City/Municipality, Province -- omitting any missing level
 * cleanly, mirroring the listing-detail location composition. */
function composeLocationLabel(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(", ");
}

export function mapShopDetailRow(row: GetShopDetailRow): ShopDetail {
  return {
    id: row.shop_id,
    slug: row.current_slug,
    name: row.name,
    description: row.description,
    logoUrl: getListingImageUrl(row.logo_storage_path),
    messengerLink: row.messenger_link,
    status: row.shop_status,
    isTrustedSeller: row.is_trusted_seller,
    memberSinceLabel: new Date(row.member_since).toLocaleDateString("en-PH", {
      month: "long",
      year: "numeric",
    }),
    locationLabel: composeLocationLabel([row.barangay_name, row.city_name, row.province_name]),
    reviewCount: row.review_count,
    averageRating: row.average_rating,
    completedOrderCount: row.completed_order_count,
    activeListingCount: row.active_listing_count,
    featuredListingId: row.featured_listing_id,
  };
}

export type ShopDetailResult =
  | { status: "found"; shop: ShopDetail; isCurrentSlug: boolean }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Client creation happens before any RPC-specific error handling begins,
 * mirroring the locked pattern in listing-detail.ts -- only the
 * get_shop_detail invocation itself is wrapped, and only to catch a
 * genuine transport-level failure. The RPC's own SHOP_NOT_FOUND signal
 * (raised identically for a nonexistent slug or a suspended-seller shop --
 * the backend never distinguishes these) is read from the Postgrest
 * error's `details` field and mapped to "not_found"; any other error is a
 * genuine failure and must never collapse into that same outcome.
 */
export async function getShopDetail(slug: string): Promise<ShopDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_shop_detail", { p_slug: slug }));
  } catch (err) {
    console.error("get_shop_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "SHOP_NOT_FOUND") {
      return { status: "not_found" };
    }
    console.error("get_shop_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetShopDetailRow[];
  if (rows.length === 0) {
    return { status: "not_found" };
  }

  const row = rows[0];
  return { status: "found", shop: mapShopDetailRow(row), isCurrentSlug: row.is_current_slug };
}
