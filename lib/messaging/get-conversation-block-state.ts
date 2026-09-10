import { createClient } from "@/lib/supabase/server";

/**
 * Row shape exactly matching public.get_conversation_block_state's
 * RETURNS TABLE (0072_user_blocking_rpcs.sql).
 */
export type GetConversationBlockStateRow = {
  other_party_id: string;
  is_blocked_by_viewer: boolean;
};

export type ConversationBlockState = {
  otherPartyId: string;
  isBlockedByViewer: boolean;
};

export type ConversationBlockStateResult =
  | { status: "found"; state: ConversationBlockState }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Small, narrowly-scoped companion to getConversationContext -- resolves
 * only what the Block/Unblock action needs (the other participant's
 * profile id and the viewer's own current block state), never touching
 * the wider, actively-used get_conversation_context RPC.
 */
export async function getConversationBlockState(conversationId: string): Promise<ConversationBlockStateResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_conversation_block_state", { p_conversation_id: conversationId }));
  } catch (err) {
    console.error("get_conversation_block_state RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "CONVERSATION_NOT_FOUND" || error.details === "NOT_CONVERSATION_PARTICIPANT") {
      return { status: "not_found" };
    }
    console.error("get_conversation_block_state RPC failed:", error.message);
    return { status: "error" };
  }

  const row = ((data ?? []) as GetConversationBlockStateRow[])[0];
  if (!row) return { status: "not_found" };

  return { status: "found", state: { otherPartyId: row.other_party_id, isBlockedByViewer: row.is_blocked_by_viewer } };
}
