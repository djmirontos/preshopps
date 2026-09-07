import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/orders/order-status-copy";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

/**
 * Row shape exactly matching public.get_my_shop_orders' RETURNS TABLE
 * (0043_seller_orders_read_rpcs.sql).
 */
export type GetMyShopOrdersRow = {
  order_id: string;
  order_public_code: string;
  buyer_display_name: string;
  status: OrderStatus;
  fulfillment_method: FulfillmentMethod;
  created_at: string;
  item_count: number;
  total_cents: number;
};

export type SellerOrderSummary = {
  orderId: string;
  orderPublicCode: string;
  buyerDisplayName: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  createdAt: string;
  itemCount: number;
  totalCents: number;
};

export type SellerOrdersCursor = {
  createdAt: string;
  id: string;
};

export type GetMyShopOrdersResult = {
  orders: SellerOrderSummary[];
  hadError: boolean;
  nextCursor: SellerOrdersCursor | null;
};

function mapRow(row: GetMyShopOrdersRow): SellerOrderSummary {
  return {
    orderId: row.order_id,
    orderPublicCode: row.order_public_code,
    buyerDisplayName: row.buyer_display_name,
    status: row.status,
    fulfillmentMethod: row.fulfillment_method,
    createdAt: row.created_at,
    itemCount: row.item_count,
    totalCents: row.total_cents,
  };
}

/**
 * get_my_shop_orders (0043) returns zero rows both when the caller has no
 * shop and when their shop simply has no orders yet -- callers that need to
 * distinguish those two cases check getMyShop() separately before calling
 * this function.
 */
export async function getMyShopOrders(limit: number, cursor?: SellerOrdersCursor): Promise<GetMyShopOrdersResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_shop_orders", {
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_my_shop_orders RPC threw:", err instanceof Error ? err.message : err);
    return { orders: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_my_shop_orders RPC failed:", error.message);
    return { orders: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetMyShopOrdersRow[];
  const orders = rows.map(mapRow);
  const nextCursor =
    rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].order_id } : null;

  return { orders, hadError: false, nextCursor };
}
