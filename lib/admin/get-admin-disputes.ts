import { createClient } from "@/lib/supabase/server";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

export type GetAdminDisputesRow = {
  dispute_id: string;
  order_id: string;
  order_public_code: string;
  order_status: string;
  status: DisputeStatus;
  reason: string;
  opener_display_name: string;
  shop_name: string;
  buyer_display_name: string;
  created_at: string;
};

export type AdminDisputeSummary = {
  disputeId: string;
  orderId: string;
  orderPublicCode: string;
  orderStatus: string;
  status: DisputeStatus;
  reason: string;
  openerDisplayName: string;
  shopName: string;
  buyerDisplayName: string;
  createdAt: string;
};

export type AdminDisputesCursor = { createdAt: string; id: string };

export type GetAdminDisputesResult = {
  disputes: AdminDisputeSummary[];
  hadError: boolean;
  notAdmin: boolean;
  nextCursor: AdminDisputesCursor | null;
};

function mapRow(row: GetAdminDisputesRow): AdminDisputeSummary {
  return {
    disputeId: row.dispute_id,
    orderId: row.order_id,
    orderPublicCode: row.order_public_code,
    orderStatus: row.order_status,
    status: row.status,
    reason: row.reason,
    openerDisplayName: row.opener_display_name,
    shopName: row.shop_name,
    buyerDisplayName: row.buyer_display_name,
    createdAt: row.created_at,
  };
}

export async function getAdminDisputes(
  limit: number,
  status?: DisputeStatus | null,
  cursor?: AdminDisputesCursor,
): Promise<GetAdminDisputesResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_disputes", {
      p_status: status ?? null,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_admin_disputes RPC threw:", err instanceof Error ? err.message : err);
    return { disputes: [], hadError: true, notAdmin: false, nextCursor: null };
  }

  if (error) {
    const isNotAdmin = error.details === "NOT_ADMIN";
    if (!isNotAdmin) {
      console.error("get_admin_disputes RPC failed:", error.message);
    }
    return { disputes: [], hadError: !isNotAdmin, notAdmin: isNotAdmin, nextCursor: null };
  }

  const rows = (data ?? []) as GetAdminDisputesRow[];
  const disputes = rows.map(mapRow);
  const nextCursor = rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].dispute_id } : null;

  return { disputes, hadError: false, notAdmin: false, nextCursor };
}
