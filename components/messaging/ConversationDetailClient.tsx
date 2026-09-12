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
 * not minimized).
 *
 * The height here is what turns ConversationThread's own message list
 * into a real, internally-scrolling region (rather than the whole page
 * scrolling) -- 100vh minus the sticky site header's own height
 * (AppHeader: h-16/64px below `lg`, h-[72px] at `lg` and up) and this
 * page's own vertical padding (py-6, 24px top + 24px bottom = 48px).
 * ConversationThread fills whatever height it's given (`h-full`) and
 * degrades to plain content-sized block layout with no bounding
 * ancestor, so this is the one place that height decision belongs for
 * the full-page route -- FloatingChatPanel makes the equivalent decision
 * for the floating panel, from its own already-bounded chrome.
 */
export function ConversationDetailClient(props: Props) {
  return (
    <div className="flex h-[calc(100vh-112px)] min-h-0 flex-col lg:h-[calc(100vh-120px)]">
      <ConversationThread {...props} />
    </div>
  );
}
