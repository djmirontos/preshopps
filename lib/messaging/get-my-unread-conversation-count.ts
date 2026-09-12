import { createClient } from "@/lib/supabase/client";

/**
 * Exact unread-conversation count via the dedicated
 * get_my_unread_conversation_count RPC (0088) -- a conversation with five
 * unread messages still counts once, matching get_my_conversations' own
 * per-conversation is_unread semantics exactly (same combined-CTE/
 * archived/unread expressions, just aggregated server-side into a count
 * instead of a bounded page of rows). Called from the browser client for
 * an authoritative client-side recalculation (e.g. right after a
 * conversation is marked read, or after a debounced new_message
 * Realtime event) without a page reload.
 */
export async function getMyUnreadConversationCount(): Promise<number> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_unread_conversation_count");

    if (error) {
      console.error("get_my_unread_conversation_count RPC failed:", error.message);
      return 0;
    }

    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("get_my_unread_conversation_count RPC threw:", err instanceof Error ? err.message : err);
    return 0;
  }
}
