import { createClient } from "@/lib/supabase/client";

/**
 * Direct client-side mutations against conversation_user_states -- NOT
 * RPC calls. Per 0030/0031's own locked design ("no toggle RPCs are
 * created, per locked scope"), mark read/unread, archive/unarchive, and
 * mute/unmute are plain UPDATEs against this one row, protected entirely
 * by the existing conversation_user_states_update_own RLS policy (`using
 * (auth.uid() = user_id)`). Filtering by conversation_id alone is
 * sufficient and safe: RLS silently restricts the UPDATE to the caller's
 * own state row for that conversation even without an explicit user_id
 * filter -- there is structurally no other row this call could touch.
 *
 * Read/unread and archive semantics reused exactly as documented in 0030:
 * marking unread sets marked_unread_at and must never rewind last_read_at;
 * marking read advances last_read_at and clears marked_unread_at.
 */

export type ConversationStateResult = { ok: true } | { ok: false };

async function updateOwnState(conversationId: string, patch: Record<string, unknown>): Promise<ConversationStateResult> {
  const supabase = createClient();

  try {
    const { error } = await supabase.from("conversation_user_states").update(patch).eq("conversation_id", conversationId);

    if (error) {
      console.error("conversation_user_states update failed:", error.message);
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error("conversation_user_states update threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export function markConversationRead(conversationId: string): Promise<ConversationStateResult> {
  return updateOwnState(conversationId, { last_read_at: new Date().toISOString(), marked_unread_at: null });
}

/**
 * Auto-mark-on-open: reads the caller's own conversation_user_states row
 * plus the conversation's last_message_at (both already directly readable
 * under existing RLS -- conversation_user_states_select_own and
 * conversations_select_participants -- no RPC/migration needed) and only
 * writes last_read_at/marked_unread_at when the conversation is actually
 * unread per 0030's own documented semantics (marked_unread_at is not
 * null, OR last_read_at is null, OR last_message_at > last_read_at).
 * Already-read conversations perform zero writes. Never touches
 * archived_at or muted -- the write patch is identical to
 * markConversationRead's own.
 */
export async function markConversationReadIfUnread(conversationId: string): Promise<ConversationStateResult> {
  try {
    const supabase = createClient();

    const [stateResult, conversationResult] = await Promise.all([
      supabase.from("conversation_user_states").select("last_read_at, marked_unread_at").eq("conversation_id", conversationId).maybeSingle(),
      supabase.from("conversations").select("last_message_at").eq("id", conversationId).maybeSingle(),
    ]);

    if (stateResult.error) {
      console.error("conversation_user_states read failed:", stateResult.error.message);
      return { ok: false };
    }
    if (conversationResult.error) {
      console.error("conversations read failed:", conversationResult.error.message);
      return { ok: false };
    }

    const state = stateResult.data;
    const conversation = conversationResult.data;

    const isUnread =
      !state ||
      state.marked_unread_at !== null ||
      state.last_read_at === null ||
      (conversation !== null && new Date(conversation.last_message_at) > new Date(state.last_read_at));

    if (!isUnread) {
      return { ok: true };
    }

    return updateOwnState(conversationId, { last_read_at: new Date().toISOString(), marked_unread_at: null });
  } catch (err) {
    console.error("markConversationReadIfUnread threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export function markConversationUnread(conversationId: string): Promise<ConversationStateResult> {
  return updateOwnState(conversationId, { marked_unread_at: new Date().toISOString() });
}

export function setConversationArchived(conversationId: string, archived: boolean): Promise<ConversationStateResult> {
  return updateOwnState(conversationId, { archived_at: archived ? new Date().toISOString() : null });
}

export function setConversationMuted(conversationId: string, muted: boolean): Promise<ConversationStateResult> {
  return updateOwnState(conversationId, { muted });
}
