import { createClient } from "@/lib/supabase/server";

export type DisputeStatus = "opened" | "under_review" | "resolved";

export type GetMyDisputesRow = {
  dispute_id: string;
  order_id: string;
  order_public_code: string;
  status: DisputeStatus;
  reason: string;
  opened_by: string;
  is_mine_opened: boolean;
  created_at: string;
};

export type MyDisputeSummary = {
  disputeId: string;
  orderId: string;
  orderPublicCode: string;
  status: DisputeStatus;
  reason: string;
  openedBy: string;
  isMineOpened: boolean;
  createdAt: string;
};

export type MyDisputesCursor = { createdAt: string; id: string };

export type GetMyDisputesResult = {
  disputes: MyDisputeSummary[];
  hadError: boolean;
  nextCursor: MyDisputesCursor | null;
};

function mapRow(row: GetMyDisputesRow): MyDisputeSummary {
  return {
    disputeId: row.dispute_id,
    orderId: row.order_id,
    orderPublicCode: row.order_public_code,
    status: row.status,
    reason: row.reason,
    openedBy: row.opened_by,
    isMineOpened: row.is_mine_opened,
    createdAt: row.created_at,
  };
}

export async function getMyDisputes(limit: number, cursor?: MyDisputesCursor): Promise<GetMyDisputesResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_disputes", {
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_my_disputes RPC threw:", err instanceof Error ? err.message : err);
    return { disputes: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_my_disputes RPC failed:", error.message);
    return { disputes: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetMyDisputesRow[];
  const disputes = rows.map(mapRow);
  const nextCursor = rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].dispute_id } : null;

  return { disputes, hadError: false, nextCursor };
}
