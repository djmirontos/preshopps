import { createClient } from "@/lib/supabase/server";

export type GetConversationMessagesRow = {
  message_id: string;
  is_mine: boolean;
  body: string;
  created_at: string;
};

export type ConversationMessage = {
  messageId: string;
  isMine: boolean;
  body: string;
  createdAt: string;
};

export type MessagesCursor = {
  createdAt: string;
  id: string;
};

export type GetConversationMessagesResult = {
  /** Chronological order (oldest first) -- reversed from the RPC's own
   * newest-first keyset order, ready for direct rendering. */
  messages: ConversationMessage[];
  hadError: boolean;
  /** Present when a full page came back, meaning older messages may still
   * exist -- pass to the next call to load them ("Load earlier"). */
  nextCursor: MessagesCursor | null;
};

function mapRow(row: GetConversationMessagesRow): ConversationMessage {
  return {
    messageId: row.message_id,
    isMine: row.is_mine,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * public.get_conversation_messages (0046) returns newest-first, matching
 * every other cursor list in this schema. This function reverses the page
 * to chronological order for direct rendering -- the caller prepends
 * earlier pages (also reversed) above the currently loaded messages.
 */
export async function getConversationMessages(
  conversationId: string,
  limit: number,
  cursor?: MessagesCursor,
): Promise<GetConversationMessagesResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_conversation_messages", {
      p_conversation_id: conversationId,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_conversation_messages RPC threw:", err instanceof Error ? err.message : err);
    return { messages: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_conversation_messages RPC failed:", error.message);
    return { messages: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetConversationMessagesRow[];
  const nextCursor =
    rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].message_id } : null;

  return { messages: rows.map(mapRow).reverse(), hadError: false, nextCursor };
}
