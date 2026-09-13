import { createClient } from "@/lib/supabase/client";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import type { CartLineDisplay } from "@/lib/cart/map-cart-row";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

type GetListingDetailRow = {
  listing_id: string;
  public_code: string;
  title: string;
  price_cents: number;
  status: "available" | "reserved" | "sold" | "archived";
  available_quantity: number;
  is_inquiry_only: boolean;
  image_paths: string[];
  fulfillment_methods: FulfillmentMethod[];
  shop_id: string;
  shop_slug: string;
  shop_name: string;
};

export type BuildBuyNowLineResult =
  | { ok: true; line: CartLineDisplay }
  | { ok: false; reason: "not_found" | "error" };

function unavailableReasonFor(row: GetListingDetailRow): string | null {
  if (row.is_inquiry_only) return "inquiry_only";
  if (row.status === "reserved") return "reserved";
  if (row.status === "sold") return "sold";
  if (row.status === "archived") return "archived";
  return null;
}

/**
 * Builds a single CartLineDisplay-shaped line for Buy Now directly from the
 * existing public get_listing_detail RPC (0036_public_marketplace_read_
 * rpcs.sql) -- the exact same read the listing detail page itself and
 * GuestCartClient's own hydration already use. Never touches get_my_cart,
 * cart_items, or carts -- Buy Now has no persistent cart row to build this
 * from, by design (see 0089_buy_now_order_submission.sql).
 *
 * cartItemId is always null here (CartLineDisplay's cartItemId is nullable
 * for exactly this reason) -- submitBuyNowOrder never reads it.
 * isSubmittable/unavailableReason are best-effort UI guidance only, derived
 * from this public projection (no per-viewer self-purchase/block/
 * restriction awareness, since get_listing_detail is anon-callable and has
 * none either) -- the shared create_orders_from_selection core remains the
 * sole authority at actual submission time, exactly like a cart row's own
 * is_submittable flag.
 */
export async function buildBuyNowLine(publicCode: string, quantity: number): Promise<BuildBuyNowLineResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_listing_detail", { p_public_code: publicCode });

    if (error) {
      console.error("get_listing_detail RPC failed:", error.message);
      return { ok: false, reason: "error" };
    }

    const rows = (data ?? []) as GetListingDetailRow[];
    if (rows.length === 0) {
      return { ok: false, reason: "not_found" };
    }

    const row = rows[0];
    const unavailableReason = unavailableReasonFor(row);

    const line: CartLineDisplay = {
      cartItemId: null,
      listingId: row.listing_id,
      publicCode: row.public_code,
      title: row.title,
      imageUrl: getListingImageUrl(row.image_paths?.[0] ?? null),
      priceCents: row.price_cents,
      priceCentsSnapshot: row.price_cents,
      priceChanged: false,
      status: row.status,
      isInquiryOnly: row.is_inquiry_only,
      quantity,
      availableQuantity: row.available_quantity,
      isSubmittable: unavailableReason === null,
      unavailableReason,
      shopId: row.shop_id,
      shopSlug: row.shop_slug,
      shopName: row.shop_name,
      fulfillmentMethods: row.fulfillment_methods ?? [],
      addedAt: new Date().toISOString(),
    };

    return { ok: true, line };
  } catch (err) {
    console.error("get_listing_detail RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "error" };
  }
}
