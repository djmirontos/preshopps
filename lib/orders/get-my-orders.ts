import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/orders/order-status-copy";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

/**
 * Row shape exactly matching public.get_my_orders' RETURNS TABLE
 * (0042_buyer_orders_read_rpcs.sql), confirmed by reading that migration
 * immediately before writing this module.
 */
export type GetMyOrdersRow = {
  order_id: string;
  order_public_code: string;
  shop_id: string;
  shop_slug: string;
  shop_name: string;
  status: OrderStatus;
  fulfillment_method: FulfillmentMethod;
  created_at: string;
  item_count: number;
  total_cents: number;
};

export type OrderSummary = {
  orderId: string;
  orderPublicCode: string;
  shopId: string;
  shopSlug: string;
  shopName: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  createdAt: string;
  itemCount: number;
  totalCents: number;
};

export type OrdersCursor = {
  createdAt: string;
  id: string;
};

export type GetMyOrdersResult = {
  orders: OrderSummary[];
  hadError: boolean;
  nextCursor: OrdersCursor | null;
};

function mapRow(row: GetMyOrdersRow): OrderSummary {
  return {
    orderId: row.order_id,
    orderPublicCode: row.order_public_code,
    shopId: row.shop_id,
    shopSlug: row.shop_slug,
    shopName: row.shop_name,
    status: row.status,
    fulfillmentMethod: row.fulfillment_method,
    createdAt: row.created_at,
    itemCount: row.item_count,
    totalCents: row.total_cents,
  };
}

/**
 * Client creation happens before any RPC-specific error handling, mirroring
 * every other marketplace/cart data module -- only the get_my_orders
 * invocation itself is wrapped, and only to catch a genuine transport-level
 * failure.
 */
export async function getMyOrders(limit: number, cursor?: OrdersCursor): Promise<GetMyOrdersResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_orders", {
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_my_orders RPC threw:", err instanceof Error ? err.message : err);
    return { orders: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_my_orders RPC failed:", error.message);
    return { orders: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetMyOrdersRow[];
  const orders = rows.map(mapRow);
  const nextCursor =
    rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].order_id } : null;

  return { orders, hadError: false, nextCursor };
}
