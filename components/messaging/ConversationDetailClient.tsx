"use client";

import { ConversationThread } from "@/components/messaging/ConversationThread";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { ConversationMessage, MessagesCursor } from "@/lib/messaging/get-conversation-messages";

type LoadEarlierResult = {
  messages: ConversationMessage[];
  hadError: boolean;
  nextCursor: MessagesCursor | null;
};

type Props = {
  context: ConversationContext;
  initialMessages: ConversationMessage[];
  initialCursor: MessagesCursor | null;
  loadEarlier: (conversationId: string, cursor: MessagesCursor) => Promise<LoadEarlierResult>;
  /** The other participant's own profile id, resolved server-side by
   * get_conversation_block_state (0072) -- never guessed/typed client-side. */
  otherPartyId: string;
  initialIsBlocked: boolean;
};

/**
 * The full-page `/messages/[conversationId]` route's own component --
 * a thin wrapper around ConversationThread (the actual, shared
 * implementation, also reused by FloatingChatPanel for the desktop
 * floating chat). Kept as its own named export/file so the page route's
 * import and every existing test of this exact component keep working
 * unchanged; it renders ConversationThread with every floating-panel-only
 * prop left at its default (back link and identity header both shown,
 * not minimized), i.e. pixel-identical to this component's own original,
 * pre-extraction markup.
 */
export function ConversationDetailClient(props: Props) {
  return <ConversationThread {...props} />;
}
