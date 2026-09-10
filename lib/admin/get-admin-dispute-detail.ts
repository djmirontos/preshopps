import { createClient } from "@/lib/supabase/server";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

export type AdminDisputeNote = {
  note: string;
  adminDisplayName: string;
  createdAt: string;
};

export type GetAdminDisputeDetailRow = {
  dispute_id: string;
  order_id: string;
  order_public_code: string;
  order_status: string;
  status: DisputeStatus;
  reason: string;
  explanation: string;
  opened_by: string;
  opener_display_name: string;
  shop_id: string;
  shop_name: string;
  shop_owner_id: string;
  shop_owner_display_name: string;
  buyer_id: string;
  buyer_display_name: string;
  fulfillment_method: string;
  image_paths: string[];
  admin_notes: { note: string; adminDisplayName: string; createdAt: string }[];
  resolved_by: string | null;
  resolved_by_display_name: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type AdminDisputeDetail = {
  disputeId: string;
  orderId: string;
  orderPublicCode: string;
  orderStatus: string;
  status: DisputeStatus;
  reason: string;
  explanation: string;
  openedBy: string;
  openerDisplayName: string;
  shopId: string;
  shopName: string;
  shopOwnerId: string;
  shopOwnerDisplayName: string;
  buyerId: string;
  buyerDisplayName: string;
  fulfillmentMethod: string;
  imagePaths: string[];
  adminNotes: AdminDisputeNote[];
  resolvedBy: string | null;
  resolvedByDisplayName: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type GetAdminDisputeDetailResult =
  | { status: "found"; dispute: AdminDisputeDetail }
  | { status: "not_found" }
  | { status: "not_admin" }
  | { status: "error" };

function mapRow(row: GetAdminDisputeDetailRow): AdminDisputeDetail {
  return {
    disputeId: row.dispute_id,
    orderId: row.order_id,
    orderPublicCode: row.order_public_code,
    orderStatus: row.order_status,
    status: row.status,
    reason: row.reason,
    explanation: row.explanation,
    openedBy: row.opened_by,
    openerDisplayName: row.opener_display_name,
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopOwnerId: row.shop_owner_id,
    shopOwnerDisplayName: row.shop_owner_display_name,
    buyerId: row.buyer_id,
    buyerDisplayName: row.buyer_display_name,
    fulfillmentMethod: row.fulfillment_method,
    imagePaths: row.image_paths,
    adminNotes: row.admin_notes ?? [],
    resolvedBy: row.resolved_by,
    resolvedByDisplayName: row.resolved_by_display_name,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export async function getAdminDisputeDetail(disputeId: string): Promise<GetAdminDisputeDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_dispute_detail", { p_dispute_id: disputeId }));
  } catch (err) {
    console.error("get_admin_dispute_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "NOT_ADMIN") return { status: "not_admin" };
    if (error.details === "DISPUTE_NOT_FOUND") return { status: "not_found" };
    console.error("get_admin_dispute_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const row = ((data ?? []) as GetAdminDisputeDetailRow[])[0];
  if (!row) return { status: "not_found" };

  return { status: "found", dispute: mapRow(row) };
}
