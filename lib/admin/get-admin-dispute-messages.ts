import { createClient } from "@/lib/supabase/server";

export type GetAdminDisputeMessagesRow = {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  is_from_buyer: boolean;
  body: string;
  created_at: string;
};

export type AdminDisputeMessage = {
  messageId: string;
  conversationId: string;
  senderId: string;
  isFromBuyer: boolean;
  body: string;
  createdAt: string;
};

export type GetAdminDisputeMessagesResult = { status: "found"; messages: AdminDisputeMessage[] } | { status: "not_admin" } | { status: "error" };

function mapRow(row: GetAdminDisputeMessagesRow): AdminDisputeMessage {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    isFromBuyer: row.is_from_buyer,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** PRD 34.4 "Review relevant messages/history" -- every message between
 * this dispute's order's buyer and shop, oldest first. Read-only,
 * admin-only; not the buyer/seller-facing messaging surface. */
export async function getAdminDisputeMessages(disputeId: string): Promise<GetAdminDisputeMessagesResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_dispute_messages", { p_dispute_id: disputeId }));
  } catch (err) {
    console.error("get_admin_dispute_messages RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "NOT_ADMIN") return { status: "not_admin" };
    console.error("get_admin_dispute_messages RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetAdminDisputeMessagesRow[];
  return { status: "found", messages: rows.map(mapRow) };
}
