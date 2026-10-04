import { createClient } from "@/lib/supabase/server";

/**
 * Server-side reader for get_order_review_removal (0115). Dual-role, like
 * get_order_review: the buyer and the shop's current owner may read removal
 * status; anyone else, or an order with no review, gets zero rows. Only the
 * buyer receives publicMessage. The private admin note never reaches this
 * module, because the RPC does not return it.
 */

export type OrderReviewRemoval = {
  isRemoved: boolean;
  removedAt: string | null;
  publicMessage: string | null;
};

export type OrderReviewRemovalResult =
  | { status: "found"; removal: OrderReviewRemoval }
  | { status: "none" }
  | { status: "error" };

type OrderReviewRemovalRow = {
  order_id: string;
  is_removed: boolean;
  removed_at: string | null;
  public_message: string | null;
};

function isTimestampString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseRow(data: unknown, orderId: string): OrderReviewRemoval | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as OrderReviewRemovalRow | null;
  if (typeof row !== "object" || row === null || row.order_id !== orderId) return null;
  if (typeof row.is_removed !== "boolean") return null;
  if (row.is_removed) {
    if (!isTimestampString(row.removed_at)) return null;
  } else if (row.removed_at !== null) {
    return null;
  }
  if (row.public_message !== null && typeof row.public_message !== "string") return null;
  return { isRemoved: row.is_removed, removedAt: row.removed_at, publicMessage: row.public_message };
}

export async function getOrderReviewRemoval(orderId: string): Promise<OrderReviewRemovalResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_order_review_removal", { p_order_id: orderId });

    if (error) {
      console.error("get_order_review_removal RPC failed:", error.message);
      return { status: "error" };
    }

    if (Array.isArray(data) && data.length === 0) return { status: "none" };

    const removal = parseRow(data, orderId);
    if (!removal) {
      console.error("get_order_review_removal returned a malformed response");
      return { status: "error" };
    }

    return { status: "found", removal };
  } catch (err) {
    console.error("get_order_review_removal RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }
}
