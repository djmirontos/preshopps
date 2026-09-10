import { createClient } from "@/lib/supabase/server";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

export type OrderDisputeSummary = { disputeId: string; status: DisputeStatus } | null;

export type GetOrderDisputeSummaryResult = { status: "found"; summary: OrderDisputeSummary } | { status: "error" };

/** Zero rows (no dispute exists for this order) maps to `summary: null`,
 * a real, common, non-error outcome -- not the same as an RPC failure. */
export async function getOrderDisputeSummary(orderId: string): Promise<GetOrderDisputeSummaryResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_order_dispute_summary", { p_order_id: orderId }));
  } catch (err) {
    console.error("get_order_dispute_summary RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    console.error("get_order_dispute_summary RPC failed:", error.message);
    return { status: "error" };
  }

  const row = ((data ?? []) as { dispute_id: string; status: DisputeStatus }[])[0];
  if (!row) return { status: "found", summary: null };

  return { status: "found", summary: { disputeId: row.dispute_id, status: row.status } };
}
