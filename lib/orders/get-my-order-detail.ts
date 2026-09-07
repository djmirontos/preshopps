import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import type { OrderStatus, OrderItemStatus } from "@/lib/orders/order-status-copy";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

/**
 * Row shape exactly matching public.get_my_order_detail's RETURNS TABLE
 * (0042_buyer_orders_read_rpcs.sql) -- one row per order_item, with
 * order-level fields repeated on every row (the same denormalized shape
 * get_my_cart already uses for shop fields).
 */
export type GetMyOrderDetailRow = {
  order_id: string;
  order_public_code: string;
  shop_id: string;
  shop_slug: string;
  shop_name: string;
  status: OrderStatus;
  fulfillment_method: FulfillmentMethod;
  buyer_note: string | null;
  created_at: string;
  order_item_id: string;
  listing_id: string | null;
  listing_public_code_snapshot: string;
  listing_title_snapshot: string;
  listing_cover_image_snapshot_path: string | null;
  item_quantity: number;
  item_price_cents_snapshot: number;
  item_status: OrderItemStatus;
};

export type OrderDetailItem = {
  orderItemId: string;
  listingId: string | null;
  listingPublicCode: string;
  title: string;
  imageUrl: string | undefined;
  quantity: number;
  priceCentsSnapshot: number;
  status: OrderItemStatus;
};

export type OrderDetail = {
  orderId: string;
  orderPublicCode: string;
  shopId: string;
  shopSlug: string;
  shopName: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  buyerNote: string | null;
  createdAt: string;
  items: OrderDetailItem[];
  totalCents: number;
};

export type OrderDetailResult =
  | { status: "found"; order: OrderDetail }
  | { status: "not_found" }
  | { status: "error" };

function mapItem(row: GetMyOrderDetailRow): OrderDetailItem {
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
 * A public_code the caller does not own, or one that does not exist at
 * all, both resolve to zero rows from get_my_order_detail -- this
 * function (and the page that calls it) never distinguishes the two,
 * mapping both to "not_found" -> Next's notFound(), exactly mirroring
 * get_listing_detail's established privacy pattern.
 */
export async function getMyOrderDetail(publicCode: string): Promise<OrderDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_order_detail", { p_public_code: publicCode }));
  } catch (err) {
    console.error("get_my_order_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    console.error("get_my_order_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetMyOrderDetailRow[];
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
      shopId: first.shop_id,
      shopSlug: first.shop_slug,
      shopName: first.shop_name,
      status: first.status,
      fulfillmentMethod: first.fulfillment_method,
      buyerNote: first.buyer_note,
      createdAt: first.created_at,
      items,
      totalCents,
    },
  };
}
