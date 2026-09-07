import { createClient } from "@/lib/supabase/client";
import type { CartLineDisplay } from "@/lib/cart/map-cart-row";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

export type SubmitCartOrderInput = {
  /** Only rows the caller has already filtered to isSubmittable -- this
   * module never re-derives eligibility itself, per "the RPC must remain
   * authoritative": eligibility here is whatever get_my_cart most recently
   * said, and submit_cart_order has the final, live say. Each row must
   * carry its own real cartItemId (get_my_cart's cart_item_id column, added
   * by 0041_get_my_cart_projection_fix.sql). */
  rows: CartLineDisplay[];
  /** One chosen method per shop id represented in `rows`. */
  fulfillmentChoices: Record<string, FulfillmentMethod | undefined>;
};

export type SubmittedOrder = {
  orderId: string;
  shopId: string;
  orderPublicCode: string;
  itemCount: number;
  totalCents: number;
};

export type SubmitCartOrderSuccess = {
  ok: true;
  orders: SubmittedOrder[];
  /** listingIds whose cart rows were included in the successful
   * submission and therefore deleted server-side -- the caller should
   * remove these from its own cart state. */
  submittedListingIds: string[];
};

export type SubmitCartOrderErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "SUBMISSION_INVALID"
  | "CART_ITEM_NOT_FOUND"
  | "LISTING_NOT_ORDERABLE"
  | "CANNOT_BUY_OWN_LISTING"
  | "QUANTITY_UNAVAILABLE"
  | "PRICE_CHANGED"
  | "FULFILLMENT_INVALID"
  | "NO_ELIGIBLE_ITEMS"
  | "UNKNOWN";

export type SubmitCartOrderFailure = {
  ok: false;
  code: SubmitCartOrderErrorCode;
};

export type SubmitCartOrderResult = SubmitCartOrderSuccess | SubmitCartOrderFailure;

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<SubmitCartOrderErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "SUBMISSION_INVALID",
  "CART_ITEM_NOT_FOUND",
  "LISTING_NOT_ORDERABLE",
  "CANNOT_BUY_OWN_LISTING",
  "QUANTITY_UNAVAILABLE",
  "PRICE_CHANGED",
  "FULFILLMENT_INVALID",
]);

function toErrorCode(detail: string | undefined): SubmitCartOrderErrorCode {
  return detail && KNOWN_ERROR_CODES.has(detail) ? (detail as SubmitCartOrderErrorCode) : "UNKNOWN";
}

export const ORDER_ERROR_MESSAGES: Record<SubmitCartOrderErrorCode, string> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "Your account can't complete this action right now.",
  SUBMISSION_INVALID: "Something went wrong. Please review your cart and try again.",
  CART_ITEM_NOT_FOUND: "Some items are no longer in your cart. Please refresh and try again.",
  LISTING_NOT_ORDERABLE: "Some items changed and could not be submitted. Review your cart and try again.",
  CANNOT_BUY_OWN_LISTING: "Something went wrong. Please review your cart and try again.",
  QUANTITY_UNAVAILABLE: "Some items changed and could not be submitted. Review your cart and try again.",
  PRICE_CHANGED: "Prices changed for some items. Review your cart and try again.",
  FULFILLMENT_INVALID: "One or more items don't support the selected delivery method. Please choose a different option.",
  NO_ELIGIBLE_ITEMS: "Some items changed and could not be submitted. Review your cart and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

type SubmitCartOrderRpcRow = {
  order_id: string;
  shop_id: string;
  order_public_code: string;
  item_count: number;
  total_cents: number;
  status: string;
};

/**
 * Converts the buyer's confirmed cart selection into one pending order per
 * shop via the existing submit_cart_order RPC (0039_order_submission.sql,
 * unchanged in signature/behavior by 0040_notifications.sql -- that later
 * migration only adds an internal seller notification insert, invisible
 * from here).
 *
 * cart_item_id now comes directly from get_my_cart() (0041_get_my_cart_
 * projection_fix.sql) -- there is no separate lookup step here anymore.
 * Earlier this module reused set_cart_item_quantity's own RETURNS TABLE as
 * a workaround to recover cart_item_id (get_my_cart didn't expose it and
 * the task instructions discouraged a migration); once the real
 * projection gap was fixed backend-side, that N-call workaround was
 * removed rather than kept as a redundant revalidation pass --
 * submit_cart_order already performs its own full, authoritative live
 * revalidation of every selected row, so a second one here would only add
 * latency without adding safety.
 */
export async function submitCartOrder({ rows, fulfillmentChoices }: SubmitCartOrderInput): Promise<SubmitCartOrderResult> {
  if (rows.length === 0) {
    return { ok: false, code: "NO_ELIGIBLE_ITEMS" };
  }

  const shopIds = Array.from(new Set(rows.map((row) => row.shopId).filter((shopId): shopId is string => shopId !== null)));

  const fulfillmentPayload = shopIds.map((shopId) => ({
    shop_id: shopId,
    method: fulfillmentChoices[shopId],
  }));

  if (fulfillmentPayload.some((entry) => !entry.method)) {
    return { ok: false, code: "FULFILLMENT_INVALID" };
  }

  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("submit_cart_order", {
      p_cart_item_ids: rows.map((row) => row.cartItemId),
      p_fulfillment_choices: fulfillmentPayload,
      p_buyer_note: null,
    });

    if (error) {
      console.error("submit_cart_order RPC failed:", error.message);
      return { ok: false, code: toErrorCode((error as { details?: string }).details) };
    }

    const orderRows = (data ?? []) as SubmitCartOrderRpcRow[];

    return {
      ok: true,
      orders: orderRows.map((order) => ({
        orderId: order.order_id,
        shopId: order.shop_id,
        orderPublicCode: order.order_public_code,
        itemCount: order.item_count,
        totalCents: order.total_cents,
      })),
      submittedListingIds: rows.map((row) => row.listingId),
    };
  } catch (err) {
    console.error("submit_cart_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
