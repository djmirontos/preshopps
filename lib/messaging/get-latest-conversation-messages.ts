import { createClient } from "@/lib/supabase/client";
import type { ConversationMessage, GetConversationMessagesRow } from "@/lib/messaging/get-conversation-messages";

const LATEST_MESSAGES_LIMIT = 30;

/**
 * ok=true carries the current newest page (up to 30 messages, oldest
 * first) exactly as returned -- including a genuinely empty page. ok=false
 * means the fetch could not be completed at all (RPC error, thrown/
 * network error, or an unexpected response shape); the caller must never
 * treat this the same as "zero new messages" (see ConversationThread's own
 * reconciliation logic, which preserves current state on ok=false rather
 * than acting on an empty result).
 */
export type GetLatestConversationMessagesResult = { ok: true; messages: ConversationMessage[] } | { ok: false };

function mapRow(row: GetConversationMessagesRow): ConversationMessage {
  return {
    messageId: row.message_id,
    isMine: row.is_mine,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * Browser-callable counterpart to lib/messaging/get-conversation-messages.ts
 * (server-only, used for the initial SSR load and "Load earlier") -- same
 * public.get_conversation_messages RPC (0046), called with no `before`
 * cursor to fetch the current newest page, from the browser client. This
 * mirrors get-my-unread-conversation-count.ts's own client/server split
 * (that RPC's server-side twin lives in get-my-unread-conversation-count-
 * server.ts) for exactly the same reason: ConversationThread is a client
 * component and cannot call the server-only wrapper directly.
 *
 * Used for Realtime reconnect reconciliation only -- "fetch the current
 * newest page" is the closest this RPC can express to "fetch messages
 * missed while disconnected" (it has no forward/after cursor), which is
 * an accepted, documented MVP limitation: an outage during which more
 * than LATEST_MESSAGES_LIMIT messages arrive could leave a gap, self-
 * healing on the next full reload/reopen. Never touches earlierCursor or
 * any "Load earlier" state -- this is a completely separate axis from
 * that backward pagination.
 */
export async function getLatestConversationMessages(conversationId: string): Promise<GetLatestConversationMessagesResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_conversation_messages", {
      p_conversation_id: conversationId,
      p_limit: LATEST_MESSAGES_LIMIT,
      p_before_created_at: null,
      p_before_id: null,
    });

    if (error) {
      console.error("get_conversation_messages RPC failed:", error.message);
      return { ok: false };
    }

    if (!Array.isArray(data)) {
      console.error("get_conversation_messages RPC returned an unexpected response shape:", data);
      return { ok: false };
    }

    const rows = data as GetConversationMessagesRow[];
    // The RPC returns newest-first -- reversed here to chronological
    // order, exactly matching get-conversation-messages.ts's own
    // convention, so the caller can append these directly.
    return { ok: true, messages: rows.map(mapRow).reverse() };
  } catch (err) {
    console.error("get_conversation_messages RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
