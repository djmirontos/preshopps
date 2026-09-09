import { createClient } from "@/lib/supabase/server";
import type { MyListingStatus } from "@/lib/seller/get-my-listing";
import type { ListingTypeFilter } from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";

/**
 * Row shape exactly matching public.get_my_shop_listings' RETURNS TABLE
 * (0064_seller_listing_management_rpcs.sql).
 */
export type GetMyShopListingsRow = {
  listing_id: string;
  public_code: string;
  slug: string;
  title: string;
  status: MyListingStatus;
  price_cents: number | null;
  stock_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  cover_image_path: string | null;
  category_id: number | null;
  listing_type: ListingTypeFilter | null;
  condition: ListingCondition | "brand_new" | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type MyShopListingSummary = {
  listingId: string;
  publicCode: string;
  slug: string;
  title: string;
  status: MyListingStatus;
  priceCents: number | null;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  coverImagePath: string | null;
  categoryId: number | null;
  listingType: ListingTypeFilter | null;
  condition: ListingCondition | "brand_new" | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type MyShopListingsCursor = {
  createdAt: string;
  id: string;
};

export type GetMyShopListingsResult = {
  listings: MyShopListingSummary[];
  hadError: boolean;
  nextCursor: MyShopListingsCursor | null;
};

function mapRow(row: GetMyShopListingsRow): MyShopListingSummary {
  return {
    listingId: row.listing_id,
    publicCode: row.public_code,
    slug: row.slug,
    title: row.title,
    status: row.status,
    priceCents: row.price_cents,
    stockQuantity: row.stock_quantity,
    reservedQuantity: row.reserved_quantity,
    availableQuantity: row.available_quantity,
    coverImagePath: row.cover_image_path,
    categoryId: row.category_id,
    listingType: row.listing_type,
    condition: row.condition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

/**
 * get_my_shop_listings (0064) returns zero rows both when the caller has no
 * shop and when their shop simply has no listings (in that status, if
 * filtered) yet -- same "empty is normal, not an error" shape as
 * getMyShopOrders. `status` of `null`/omitted means every status ("All").
 */
export async function getMyShopListings(
  limit: number,
  status?: MyListingStatus | null,
  cursor?: MyShopListingsCursor,
): Promise<GetMyShopListingsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_shop_listings", {
      p_status: status ?? null,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_my_shop_listings RPC threw:", err instanceof Error ? err.message : err);
    return { listings: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_my_shop_listings RPC failed:", error.message);
    return { listings: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetMyShopListingsRow[];
  const listings = rows.map(mapRow);
  const nextCursor =
    rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].listing_id } : null;

  return { listings, hadError: false, nextCursor };
}
