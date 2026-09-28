"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type FloatingMessengerContextValue = {
  /** Whether the expanded, two-column desktop messaging center is
   * showing (vs just the collapsed launcher pill). */
  isOpen: boolean;
  /** Which conversation is shown in the right pane -- persists across
   * collapse/expand (minimize/openMessenger don't touch it), so reopening
   * the center resumes on the same thread the viewer left. Null means no
   * conversation has been selected yet (the right pane's own empty
   * state, "Select a conversation", once the center is open). */
  selectedConversationId: string | null;
  /** Opens the messaging center without changing which conversation (if
   * any) is currently selected -- e.g. clicking the header Messages icon
   * or the collapsed launcher pill itself. */
  openMessenger: () => void;
  /** Opens the messaging center with this conversation selected in the
   * right pane -- e.g. clicking a conversation row in the list, Message
   * Seller/Message Shop, or a conversation link elsewhere. Selecting a
   * different conversation while the center is already open never opens
   * a second window -- it's the same one panel, just a different
   * selectedConversationId. */
  openConversation: (conversationId: string) => void;
  /** Collapses the messaging center back to the launcher pill --
   * preserves selectedConversationId (and everything else) so reopening
   * shows the exact same state. */
  minimize: () => void;
  /** Desktop MVP's "close" is deliberately non-destructive: it only ever
   * collapses back to the launcher (the same effect as minimize()), it
   * never removes messenger access entirely -- the launcher itself stays
   * available for as long as the viewer is signed in and browsing. */
  close: () => void;
  /** Deselects the current conversation (the right pane returns to its
   * own "Select a conversation" empty state) WITHOUT collapsing the
   * center itself -- a distinct action from close()/minimize() above,
   * which both preserve the selection by design (see close's own
   * comment). Added for LAUNCH UX S1.2's Mark as Unread success
   * behavior: that action needs to leave the specific conversation
   * (unmounting its ConversationThread instance, since the right pane's
   * conditional render is keyed on selectedConversationId) rather than
   * merely minimize the still-mounted thread, which neither close() nor
   * minimize() do on their own. */
  closeConversation: () => void;
};

const FloatingMessengerContext = createContext<FloatingMessengerContextValue>({
  isOpen: false,
  selectedConversationId: null,
  openMessenger: () => {},
  openConversation: () => {},
  minimize: () => {},
  close: () => {},
  closeConversation: () => {},
});

/**
 * Root-level, session-lifetime state for the single desktop messaging
 * center (FloatingChatPanel, mounted once alongside this Provider in the
 * root layout, right next to NotificationsProvider/CartProvider). This
 * owns only "is the center expanded" and "which conversation is
 * selected" -- never conversation data itself (FloatingChatPanel loads
 * the selected thread and the conversation list on demand) and never
 * more than one selected conversation at a time, per this feature's
 * approved single-window MVP scope (a marketplace-style messaging
 * center, not a multi-window chat system).
 *
 * Mounting this at the root -- rather than inside a specific page/route --
 * is what lets both the collapsed launcher and the expanded center
 * survive normal marketplace navigation instead of being torn down every
 * time the route changes underneath them.
 */
export function FloatingMessengerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const openMessenger = useCallback(() => setIsOpen(true), []);

  const openConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId);
    setIsOpen(true);
  }, []);

  const minimize = useCallback(() => setIsOpen(false), []);
  // Same effect as minimize() -- see this value's own doc comment above
  // for why "close" no longer destroys anything in this design.
  const close = minimize;
  const closeConversation = useCallback(() => setSelectedConversationId(null), []);

  const value = useMemo<FloatingMessengerContextValue>(
    () => ({ isOpen, selectedConversationId, openMessenger, openConversation, minimize, close, closeConversation }),
    [isOpen, selectedConversationId, openMessenger, openConversation, minimize, close, closeConversation],
  );

  return <FloatingMessengerContext.Provider value={value}>{children}</FloatingMessengerContext.Provider>;
}

export function useFloatingMessenger(): FloatingMessengerContextValue {
  return useContext(FloatingMessengerContext);
}
