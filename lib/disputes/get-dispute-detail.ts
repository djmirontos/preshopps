import { createClient } from "@/lib/supabase/server";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

export type GetDisputeDetailRow = {
  dispute_id: string;
  order_id: string;
  order_public_code: string;
  order_status: string;
  status: DisputeStatus;
  reason: string;
  explanation: string;
  opened_by: string;
  is_mine_opened: boolean;
  shop_name: string;
  buyer_display_name: string;
  fulfillment_method: string;
  image_paths: string[];
  created_at: string;
  resolved_at: string | null;
};

export type DisputeDetail = {
  disputeId: string;
  orderId: string;
  orderPublicCode: string;
  orderStatus: string;
  status: DisputeStatus;
  reason: string;
  explanation: string;
  openedBy: string;
  isMineOpened: boolean;
  shopName: string;
  buyerDisplayName: string;
  fulfillmentMethod: string;
  imagePaths: string[];
  createdAt: string;
  resolvedAt: string | null;
};

export type GetDisputeDetailResult = { status: "found"; dispute: DisputeDetail } | { status: "not_found" } | { status: "error" };

function mapRow(row: GetDisputeDetailRow): DisputeDetail {
  return {
    disputeId: row.dispute_id,
    orderId: row.order_id,
    orderPublicCode: row.order_public_code,
    orderStatus: row.order_status,
    status: row.status,
    reason: row.reason,
    explanation: row.explanation,
    openedBy: row.opened_by,
    isMineOpened: row.is_mine_opened,
    shopName: row.shop_name,
    buyerDisplayName: row.buyer_display_name,
    fulfillmentMethod: row.fulfillment_method,
    imagePaths: row.image_paths,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export async function getDisputeDetail(disputeId: string): Promise<GetDisputeDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_dispute_detail", { p_dispute_id: disputeId }));
  } catch (err) {
    console.error("get_dispute_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "DISPUTE_NOT_FOUND" || error.details === "NOT_DISPUTE_PARTICIPANT") {
      return { status: "not_found" };
    }
    console.error("get_dispute_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const row = ((data ?? []) as GetDisputeDetailRow[])[0];
  if (!row) return { status: "not_found" };

  return { status: "found", dispute: mapRow(row) };
}
