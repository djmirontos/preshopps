import { readGuestCart, clearGuestCart } from "@/lib/cart/guest-cart-storage";
import { createClient } from "@/lib/supabase/client";

type MergeGuestCartRpcRow = {
  listing_id: string;
  result: "merged" | "skipped_not_cartable" | "skipped_quantity";
  final_quantity: number | null;
};

export type MergeGuestCartOutcome =
  /** Guest cart was empty -- no RPC call was made. */
  | { attempted: false }
  /** RPC call was made but failed (returned an error or threw). Guest
   * storage is left untouched by the caller in this case. */
  | { attempted: true; ok: false }
  /** RPC succeeded; guest storage has already been cleared. `results`
   * carries the authoritative post-merge quantity per listing (0037's
   * merge_guest_cart, final_quantity: null means nothing ended up in the
   * DB cart for that listing -- e.g. skipped and no prior row existed). */
  | { attempted: true; ok: true; results: Array<{ listingId: string; finalQuantity: number | null }> };

/**
 * Merges the local guest cart into the signed-in account cart via the
 * existing merge_guest_cart RPC (0037_favorites_cart_rls_and_rpcs.sql),
 * per PRD S20.2 / AGENTS.md's Cart Rules. Invents no merge policy of its
 * own -- it only builds the RPC payload, and on success clears local
 * guest storage and returns the RPC's own per-item results so a caller
 * (e.g. CartProvider's fallback effect) can reflect them into shared
 * state without a full server refetch.
 *
 * Never blocks or fails its caller: a merge failure (RPC error or a
 * thrown transport failure) is logged and swallowed, never thrown, and
 * local guest cart data is preserved (not cleared) so nothing is lost --
 * the guest cart simply remains available to retry on a future
 * authenticated transition.
 */
export async function mergeGuestCartOnAuth(): Promise<MergeGuestCartOutcome> {
  const guestLines = readGuestCart();
  if (guestLines.length === 0) return { attempted: false };

  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("merge_guest_cart", {
      p_items: guestLines.map((line) => ({ listing_id: line.listingId, quantity: line.quantity })),
    });

    if (error) {
      console.error("merge_guest_cart RPC failed:", error.message);
      return { attempted: true, ok: false };
    }

    clearGuestCart();
    const rows = (data ?? []) as MergeGuestCartRpcRow[];
    return {
      attempted: true,
      ok: true,
      results: rows.map((row) => ({ listingId: row.listing_id, finalQuantity: row.final_quantity })),
    };
  } catch (err) {
    // A transport-level failure (e.g. offline) must never break the
    // caller's flow -- callers do not (and should not have to) wrap this
    // call in their own try/catch.
    console.error("merge_guest_cart RPC threw:", err instanceof Error ? err.message : err);
    return { attempted: true, ok: false };
  }
}
