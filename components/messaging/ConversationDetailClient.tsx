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
 * Desktop (`lg` and up): completely UNCHANGED from before -- `lg:static`
 * cancels the mobile fixed positioning below (top/bottom/inset-x/z-index
 * all become inert on a statically positioned element per the CSS spec,
 * so no explicit per-property reset is even required, though a few are
 * spelled out anyway for clarity), and `lg:h-[calc(100vh-120px)]` is the
 * exact original calc: 100vh minus the sticky header's height at `lg`
 * (72px) and this page's own vertical padding (py-6, 48px). ConversationThread
 * fills that with `h-full`.
 *
 * Mobile (below `lg`): the previous version reused that same calc
 * (100vh minus a *single-row* header height) below `lg` too, which
 * undercounted AppHeader's real mobile height -- below `lg`, AppHeader
 * renders a SECOND row (its own search bar, `lg:hidden`) that the old
 * calc never subtracted, and separately never reserved any space for the
 * fixed MobileBottomNav at all. The visible result: the composer ended
 * up rendered underneath the bottom nav, only reachable by scrolling the
 * whole page (which a Footer sitting right after this component, still
 * in normal flow, made tall enough to do) -- and scrolling the page also
 * carried this component's own header out of view with it.
 *
 * The fix: below `lg`, this becomes a `fixed` panel positioned directly
 * against the two other fixed/sticky chrome pieces already on the page
 * (AppHeader, MobileBottomNav) instead of trying to add up their heights
 * into another 100vh calc -- top-[132px] is AppHeader's real total mobile
 * height (row 1 `h-16`=64px + row 2's own border-t/padding/search-input
 * stack, measured at ~68px; a content-driven row with no single fixed
 * Tailwind size, so this is a documented approximation, not a class
 * this file can read directly -- a few px of slack here is a cosmetic
 * rounding gap at worst, never a functional break, unlike the ~65px the
 * previous calc was off by). The bottom offset mirrors MobileBottomNav's
 * own real height + safe-area-inset-bottom exactly the same way
 * Footer.tsx's own pb-24 already does for normal pages. z-30 sits below
 * both AppHeader and MobileBottomNav's z-40, so either one's opaque
 * background always wins at the seams regardless of small offset drift.
 * Being `fixed` also takes this out of the page's own normal-flow
 * height entirely, which is what stops the whole *page* from needing to
 * scroll in the first place (see ConditionalFooter for the other half of
 * that -- removing the Footer that used to supply the extra height).
 */
export function ConversationDetailClient(props: Props) {
  return (
    <div className="fixed inset-x-0 top-[132px] bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex min-h-0 flex-col bg-canvas px-4 lg:static lg:inset-auto lg:top-auto lg:bottom-auto lg:z-auto lg:h-[calc(100vh-120px)] lg:px-0">
      <ConversationThread {...props} />
    </div>
  );
}
