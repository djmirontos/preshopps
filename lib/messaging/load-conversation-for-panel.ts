"use server";

import { getAuthUser } from "@/lib/auth/session";
import { getConversationContext, type ConversationContext } from "@/lib/messaging/get-conversation-context";
import { getConversationMessages, type ConversationMessage, type MessagesCursor } from "@/lib/messaging/get-conversation-messages";
import { getConversationBlockState } from "@/lib/messaging/get-conversation-block-state";

const MESSAGES_LIMIT = 30;

export type LoadConversationForPanelResult =
  | {
      status: "found";
      context: ConversationContext;
      initialMessages: ConversationMessage[];
      initialCursor: MessagesCursor | null;
      otherPartyId: string;
      initialIsBlocked: boolean;
    }
  | { status: "not_found" }
  | { status: "error" };

/**
 * The floating desktop chat panel (FloatingChatPanel) opens without a
 * page navigation, so unlike the full-page `/messages/[conversationId]`
 * route it has no server component to load its data for it. This is that
 * same load, exposed as a Server Action the panel (a client component)
 * can call directly -- no new API route, no new RPC, no new validation:
 * it's the exact same three calls app/messages/[conversationId]/page.tsx
 * already makes (getConversationContext, getConversationMessages,
 * getConversationBlockState), each already scoped to the caller via the
 * server Supabase client and RLS/RPC participant checks, just combined
 * into one round trip for the panel's convenience. A conversation the
 * caller cannot access (not a participant, wrong/stale id, or the
 * conversation somehow no longer exists) resolves to "not_found", mapped
 * by the panel to a plain "no longer available" message -- never a crash,
 * and never a distinguishing error that would confirm the conversation
 * exists for someone who isn't part of it.
 */
export async function loadConversationForPanel(conversationId: string): Promise<LoadConversationForPanelResult> {
  const user = await getAuthUser();
  if (!user) return { status: "not_found" };

  const contextResult = await getConversationContext(conversationId);
  if (contextResult.status !== "found") {
    return { status: contextResult.status };
  }

  const [messagesResult, blockStateResult] = await Promise.all([
    getConversationMessages(conversationId, MESSAGES_LIMIT),
    getConversationBlockState(conversationId),
  ]);

  if (messagesResult.hadError) {
    return { status: "error" };
  }

  // Mirrors app/messages/[conversationId]/page.tsx's own fallback exactly:
  // get_conversation_block_state uses the same participant-resolution
  // logic as get_conversation_context, so a "found" context should always
  // pair with a "found" block state too; this soft fallback only covers
  // the structurally-shouldn't-happen case, rather than failing the whole
  // panel over it.
  const blockState = blockStateResult.status === "found" ? blockStateResult.state : null;

  return {
    status: "found",
    context: contextResult.context,
    initialMessages: messagesResult.messages,
    initialCursor: messagesResult.nextCursor,
    otherPartyId: blockState?.otherPartyId ?? "",
    initialIsBlocked: blockState?.isBlockedByViewer ?? false,
  };
}

/**
 * The panel's own "Load earlier messages" action -- identical shape and
 * behavior to app/messages/[conversationId]/page.tsx's inline
 * loadEarlierAction, just exported at module scope (a Server Action
 * passed as a prop from inside a Server Component can be defined inline
 * per-render; one driving a root-level client component needs a
 * top-level export instead).
 */
export async function loadEarlierMessagesForPanel(conversationId: string, cursor: MessagesCursor) {
  return getConversationMessages(conversationId, MESSAGES_LIMIT, cursor);
}
