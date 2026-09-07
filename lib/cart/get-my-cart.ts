import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { getListingImageUrl } from "@/lib/marketplace/browse-listings";

/**
 * Row shape exactly matching public.get_my_cart's RETURNS TABLE
 * (0037_favorites_cart_rls_and_rpcs.sql), confirmed by reading the
 * migration immediately before writing this module.
 */
export type GetMyCartRow = {
  listing_id: string;
  public_code: string | null;
  slug: string | null;
  title: string | null;
  cover_image_storage_path: string | null;
  price_cents: number | null;
  price_cents_snapshot: number;
  price_changed: boolean | null;
  status: string;
  is_inquiry_only: boolean | null;
  requested_quantity: number;
  current_available_quantity: number | null;
  is_submittable: boolean;
  unavailable_reason: string | null;
  shop_id: string | null;
  shop_slug: string | null;
  shop_name: string | null;
  added_at: string;
};

async function fetchMyCartRowsUncached(): Promise<{ rows: GetMyCartRow[]; hadError: boolean }> {
  const user = await getAuthUser();
  if (!user) return { rows: [], hadError: false };

  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_cart"));
  } catch (err) {
    console.error("get_my_cart RPC threw:", err instanceof Error ? err.message : err);
    return { rows: [], hadError: true };
  }

  if (error) {
    console.error("get_my_cart RPC failed:", error.message);
    return { rows: [], hadError: true };
  }

  return { rows: (data ?? []) as GetMyCartRow[], hadError: false };
}

/**
 * Memoized per request (React cache()) so the root layout (seeding
 * CartProvider's shared quantity map via getMyCartQuantities below) and
 * the /cart page (rendering full rows via getMyCart below) share exactly
 * one get_my_cart() round trip instead of two. This is the only backend
 * read path for a signed-in cart: unlike favorites (favorites_select_own
 * lets the layout do a lightweight direct-table SELECT), cart_items and
 * carts carry RLS enabled with zero SELECT policies (confirmed in
 * 0037's own pre-inspection notes) -- there is no lighter alternative to
 * call from the layout, so both callers necessarily hit the same full RPC,
 * and cache() is what keeps that to one real network call per request.
 */
export const getMyCartRows = cache(fetchMyCartRowsUncached);

export type CartQuantityLine = {
  listingId: string;
  publicCode: string | null;
  quantity: number;
};

/** Lightweight projection for CartProvider's shared quantity map -- see
 * components/cart/CartProvider.tsx. */
export async function getMyCartQuantities(): Promise<CartQuantityLine[]> {
  const { rows } = await getMyCartRows();
  return rows.map((row) => ({
    listingId: row.listing_id,
    publicCode: row.public_code,
    quantity: row.requested_quantity,
  }));
}

export type CartLineDisplay = {
  listingId: string;
  publicCode: string | null;
  title: string | null;
  imageUrl: string | undefined;
  priceCents: number | null;
  priceCentsSnapshot: number;
  priceChanged: boolean;
  status: string;
  isInquiryOnly: boolean;
  quantity: number;
  availableQuantity: number | null;
  isSubmittable: boolean;
  unavailableReason: string | null;
  shopId: string | null;
  shopSlug: string | null;
  shopName: string | null;
  addedAt: string;
};

export type GetMyCartResult = {
  lines: CartLineDisplay[];
  hadError: boolean;
};

/** Full display projection for the /cart page. */
export async function getMyCart(): Promise<GetMyCartResult> {
  const { rows, hadError } = await getMyCartRows();

  const lines: CartLineDisplay[] = rows.map((row) => ({
    listingId: row.listing_id,
    publicCode: row.public_code,
    title: row.title,
    imageUrl: getListingImageUrl(row.cover_image_storage_path),
    priceCents: row.price_cents,
    priceCentsSnapshot: row.price_cents_snapshot,
    priceChanged: row.price_changed ?? false,
    status: row.status,
    isInquiryOnly: row.is_inquiry_only ?? false,
    quantity: row.requested_quantity,
    availableQuantity: row.current_available_quantity,
    isSubmittable: row.is_submittable,
    unavailableReason: row.unavailable_reason,
    shopId: row.shop_id,
    shopSlug: row.shop_slug,
    shopName: row.shop_name,
    addedAt: row.added_at,
  }));

  return { lines, hadError };
}
