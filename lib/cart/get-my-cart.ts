import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { mapCartRowToDisplay, type GetMyCartRow, type CartLineDisplay } from "@/lib/cart/map-cart-row";

export type { GetMyCartRow, CartLineDisplay };

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

export type GetMyCartResult = {
  lines: CartLineDisplay[];
  hadError: boolean;
};

/** Full display projection for the /cart page. Row-to-display mapping is
 * shared with the client-side refresh path via map-cart-row.ts. */
export async function getMyCart(): Promise<GetMyCartResult> {
  const { rows, hadError } = await getMyCartRows();
  return { lines: rows.map(mapCartRowToDisplay), hadError };
}
