import { createClient } from "@/lib/supabase/client";

/**
 * ok=true carries the exact RPC-reported count, including a genuine 0.
 * ok=false means the count could not be determined at all (RPC error,
 * thrown/network error, or an unexpected response shape) -- the caller
 * must never treat this the same as a reported 0 (see
 * NotificationsProvider's own refreshUnreadMessageCount, which keeps the
 * last-known badge value instead of overwriting it with a fabricated 0).
 */
export type GetMyUnreadConversationCountResult = { ok: true; count: number } | { ok: false };

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
export async function getMyUnreadConversationCount(): Promise<GetMyUnreadConversationCountResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_unread_conversation_count");

    if (error) {
      console.error("get_my_unread_conversation_count RPC failed:", error.message);
      return { ok: false };
    }

    if (typeof data !== "number") {
      console.error("get_my_unread_conversation_count RPC returned an unexpected response shape:", data);
      return { ok: false };
    }

    return { ok: true, count: data };
  } catch (err) {
    console.error("get_my_unread_conversation_count RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
