"use server";

import { getAuthUser } from "@/lib/auth/session";
import { getMyConversations, type ConversationsCursor, type GetMyConversationsResult } from "@/lib/messaging/get-my-conversations";

const CONVERSATIONS_LIMIT = 20;

/**
 * The desktop messaging center's own left-column conversation list --
 * called from a client component (FloatingChatPanel), unlike
 * app/messages/page.tsx's own inline "use server" actions, which a
 * Server Component can define per-render but a root-level client
 * component cannot. Reuses the exact same getMyConversations() call
 * (0046's own get_my_conversations RPC) the full `/messages` page already
 * uses -- no second inbox query, no new RPC.
 *
 * Deliberately always the main (non-archived) inbox -- the compact
 * messaging center is for quick access to active conversations while
 * browsing, not a replacement for the full `/messages` page's own
 * Archived toggle, which remains the one place to browse archived
 * conversations.
 *
 * Guarded on getAuthUser() first, matching load-conversation-for-panel.ts's
 * own convention, so a guest never issues a doomed-to-fail authenticated
 * RPC call -- though in practice FloatingChatPanel itself never mounts
 * this data-loading path for a guest to begin with (the persistent
 * launcher is gated on isAuthenticated at the root layout).
 */
export async function loadConversationsForMessagingCenter(): Promise<GetMyConversationsResult> {
  const user = await getAuthUser();
  if (!user) return { conversations: [], hadError: false, nextCursor: null };

  return getMyConversations(CONVERSATIONS_LIMIT, undefined, false);
}

/** The messaging center's own "Load more" action -- identical shape to
 * app/messages/page.tsx's inline loadMoreAction, exported at module scope
 * for the same reason loadConversationsForMessagingCenter is above. */
export async function loadMoreConversationsForMessagingCenter(cursor: ConversationsCursor): Promise<GetMyConversationsResult> {
  const user = await getAuthUser();
  if (!user) return { conversations: [], hadError: false, nextCursor: null };

  return getMyConversations(CONVERSATIONS_LIMIT, cursor, false);
}
