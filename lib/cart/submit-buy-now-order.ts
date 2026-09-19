import { createClient } from "@/lib/supabase/client";
import {
  ORDER_ERROR_MESSAGES,
  type SubmitCartOrderErrorCode,
  type SubmitCartOrderResult,
  type SubmittedOrder,
} from "@/lib/cart/submit-cart-order";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";
import { interpretInteractionBlocked } from "@/lib/moderation/interpret-interaction-blocked";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

export { ORDER_ERROR_MESSAGES };
export type { SubmitCartOrderResult, SubmittedOrder };

/** Same shared A2.2.1 helper and precedence submit_cart_order itself uses
 * -- account_suspended first, buyer_restricted second. seller_suspended is
 * intentionally excluded: unrelated to a buyer's own Buy Now action. */
const BUY_NOW_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "buyer_restricted"];

export type SubmitBuyNowOrderInput = {
  listingId: string;
  quantity: number;
  fulfillmentMethod: FulfillmentMethod;
  /** The price most recently displayed to the buyer -- compared against
   * the live canonical listings.price_cents by the shared
   * create_orders_from_selection core (0089_buy_now_order_submission.sql).
   * The live price is always authoritative and always what actually gets
   * written to order_items; this value only drives the existing
   * PRICE_CHANGED guard, exactly like a cart row's own stored snapshot. */
  expectedPriceCents: number;
  buyerNote?: string | null;
};

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<SubmitCartOrderErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "SUBMISSION_INVALID",
  "LISTING_NOT_ORDERABLE",
  "CANNOT_BUY_OWN_LISTING",
  "QUANTITY_UNAVAILABLE",
  "PRICE_CHANGED",
  "FULFILLMENT_INVALID",
]);

function toErrorCode(detail: string | undefined): SubmitCartOrderErrorCode {
  return detail && KNOWN_ERROR_CODES.has(detail) ? (detail as SubmitCartOrderErrorCode) : "UNKNOWN";
}

type SubmitBuyNowOrderRpcRow = {
  order_id: string;
  shop_id: string;
  order_public_code: string;
  item_count: number;
  total_cents: number;
  status: string;
};

/**
 * Buy Now's own submission path -- calls the new submit_buy_now_order RPC
 * (0089_buy_now_order_submission.sql), which shares its entire eligibility/
 * self-purchase/block/quantity/price/fulfillment validation and order-
 * creation logic with submit_cart_order via one private core,
 * create_orders_from_selection. Never reads or writes cart_items/carts --
 * there is no cart_item_id anywhere in this module. Returns the exact same
 * SubmitCartOrderResult shape submitCartOrder does, so OrderReviewSubmit
 * can drive either path without knowing which one it's using.
 */
export async function submitBuyNowOrder({
  listingId,
  quantity,
  fulfillmentMethod,
  expectedPriceCents,
  buyerNote = null,
}: SubmitBuyNowOrderInput): Promise<SubmitCartOrderResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("submit_buy_now_order", {
      p_listing_id: listingId,
      p_quantity: quantity,
      p_fulfillment_method: fulfillmentMethod,
      p_expected_price_cents: expectedPriceCents,
      p_buyer_note: buyerNote,
    });

    if (error) {
      console.error("submit_buy_now_order RPC failed:", error.message);
      const code = toErrorCode((error as { details?: string }).details);
      const restriction = await interpretInteractionBlocked(code, BUY_NOW_RELEVANT_RESTRICTIONS);
      return restriction ? { ok: false, code, restriction } : { ok: false, code };
    }

    const orderRows = (data ?? []) as SubmitBuyNowOrderRpcRow[];

    return {
      ok: true,
      orders: orderRows.map((order) => ({
        orderId: order.order_id,
        shopId: order.shop_id,
        orderPublicCode: order.order_public_code,
        itemCount: order.item_count,
        totalCents: order.total_cents,
      })),
      submittedListingIds: [listingId],
    };
  } catch (err) {
    console.error("submit_buy_now_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
