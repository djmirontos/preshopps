import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import type { OrderStatus, OrderItemStatus } from "@/lib/orders/order-status-copy";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

/**
 * Row shape exactly matching public.get_my_shop_order_detail's RETURNS
 * TABLE (0043_seller_orders_read_rpcs.sql) -- one row per order_item,
 * order-level fields (including the denormalized pending cancellation
 * request, if any) repeated on every row.
 */
export type GetMyShopOrderDetailRow = {
  order_id: string;
  order_public_code: string;
  buyer_display_name: string;
  status: OrderStatus;
  fulfillment_method: FulfillmentMethod;
  buyer_note: string | null;
  created_at: string;
  pending_cancellation_request_id: string | null;
  pending_cancellation_reason: string | null;
  order_item_id: string;
  listing_id: string | null;
  listing_public_code_snapshot: string;
  listing_title_snapshot: string;
  listing_cover_image_snapshot_path: string | null;
  item_quantity: number;
  item_price_cents_snapshot: number;
  item_status: OrderItemStatus;
};

export type SellerOrderDetailItem = {
  orderItemId: string;
  listingId: string | null;
  listingPublicCode: string;
  title: string;
  imageUrl: string | undefined;
  quantity: number;
  priceCentsSnapshot: number;
  status: OrderItemStatus;
};

export type SellerOrderDetail = {
  orderId: string;
  orderPublicCode: string;
  buyerDisplayName: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  buyerNote: string | null;
  createdAt: string;
  pendingCancellationRequestId: string | null;
  pendingCancellationReason: string | null;
  items: SellerOrderDetailItem[];
  totalCents: number;
};

export type SellerOrderDetailResult =
  | { status: "found"; order: SellerOrderDetail }
  | { status: "not_found" }
  | { status: "error" };

function mapItem(row: GetMyShopOrderDetailRow): SellerOrderDetailItem {
  return {
    orderItemId: row.order_item_id,
    listingId: row.listing_id,
    listingPublicCode: row.listing_public_code_snapshot,
    title: row.listing_title_snapshot,
    imageUrl: getListingImageUrl(row.listing_cover_image_snapshot_path),
    quantity: row.item_quantity,
    priceCentsSnapshot: row.item_price_cents_snapshot,
    status: row.item_status,
  };
}

/**
 * A public_code belonging to another seller's shop, or one that does not
 * exist at all, both resolve to zero rows from get_my_shop_order_detail --
 * this function (and the page that calls it) never distinguishes the two,
 * mapping both to "not_found", identical to the buyer-side
 * getMyOrderDetail privacy pattern.
 */
export async function getMyShopOrderDetail(publicCode: string): Promise<SellerOrderDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_shop_order_detail", { p_public_code: publicCode }));
  } catch (err) {
    console.error("get_my_shop_order_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    console.error("get_my_shop_order_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetMyShopOrderDetailRow[];
  if (rows.length === 0) {
    return { status: "not_found" };
  }

  const first = rows[0];
  const items = rows.map(mapItem);
  const totalCents = items.reduce((sum, item) => sum + item.priceCentsSnapshot * item.quantity, 0);

  return {
    status: "found",
    order: {
      orderId: first.order_id,
      orderPublicCode: first.order_public_code,
      buyerDisplayName: first.buyer_display_name,
      status: first.status,
      fulfillmentMethod: first.fulfillment_method,
      buyerNote: first.buyer_note,
      createdAt: first.created_at,
      pendingCancellationRequestId: first.pending_cancellation_request_id,
      pendingCancellationReason: first.pending_cancellation_reason,
      items,
      totalCents,
    },
  };
}
