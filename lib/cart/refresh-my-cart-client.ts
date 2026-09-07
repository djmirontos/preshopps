import { createClient } from "@/lib/supabase/client";
import { mapCartRowToDisplay, type GetMyCartRow, type CartLineDisplay } from "@/lib/cart/map-cart-row";

export type RefreshMyCartResult = {
  lines: CartLineDisplay[];
  hadError: boolean;
};

/**
 * Client-side equivalent of lib/cart/get-my-cart.ts's getMyCart(), used to
 * refresh the authenticated cart after an order-submission attempt
 * without a full page reload -- e.g. after a failure, so eligibility
 * reflects whatever actually changed, or after a partial success where
 * some rows were dropped during pre-submit revalidation. Shares the exact
 * same row mapping via map-cart-row.ts so the server and client paths can
 * never drift.
 */
export async function refreshMyCart(): Promise<RefreshMyCartResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_cart");

    if (error) {
      console.error("get_my_cart RPC failed:", error.message);
      return { lines: [], hadError: true };
    }

    const rows = (data ?? []) as GetMyCartRow[];
    return { lines: rows.map(mapCartRowToDisplay), hadError: false };
  } catch (err) {
    console.error("get_my_cart RPC threw:", err instanceof Error ? err.message : err);
    return { lines: [], hadError: true };
  }
}
