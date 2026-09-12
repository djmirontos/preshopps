"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type FloatingMessengerContextValue = {
  openConversationId: string | null;
  isMinimized: boolean;
  /** Opens (or re-focuses) the floating desktop chat panel for this
   * conversation. MVP is deliberately single-window: opening a second
   * conversation replaces whatever was open, it never stacks a second
   * panel -- always (re)expands too, even if the same conversation is
   * already open and minimized. */
  openConversation: (conversationId: string) => void;
  minimize: () => void;
  restore: () => void;
  /** Only clears which conversation the panel is showing -- never marks
   * anything read/unread itself. A future incoming message for this
   * conversation still updates the global Messages badge normally via
   * NotificationsProvider's own independent subscription. */
  close: () => void;
};

const FloatingMessengerContext = createContext<FloatingMessengerContextValue>({
  openConversationId: null,
  isMinimized: false,
  openConversation: () => {},
  minimize: () => {},
  restore: () => {},
  close: () => {},
});

/**
 * Root-level, session-lifetime state for the single desktop floating chat
 * panel (FloatingChatPanel, mounted once alongside this Provider in the
 * root layout, right next to NotificationsProvider/CartProvider). This
 * owns only which conversation is open and whether it's minimized --
 * never conversation data itself (FloatingChatPanel loads that on demand
 * via lib/messaging/load-conversation-for-panel.ts) and never more than
 * one open conversation at a time, per this slice's approved MVP scope.
 *
 * Mounting this at the root -- rather than inside a specific page/route --
 * is what lets the panel survive normal marketplace navigation instead of
 * being torn down every time the route changes underneath it.
 */
export function FloatingMessengerProvider({ children }: { children: ReactNode }) {
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  const openConversation = useCallback((conversationId: string) => {
    setOpenConversationId(conversationId);
    setIsMinimized(false);
  }, []);

  const minimize = useCallback(() => setIsMinimized(true), []);
  const restore = useCallback(() => setIsMinimized(false), []);
  const close = useCallback(() => {
    setOpenConversationId(null);
    setIsMinimized(false);
  }, []);

  const value = useMemo<FloatingMessengerContextValue>(
    () => ({ openConversationId, isMinimized, openConversation, minimize, restore, close }),
    [openConversationId, isMinimized, openConversation, minimize, restore, close],
  );

  return <FloatingMessengerContext.Provider value={value}>{children}</FloatingMessengerContext.Provider>;
}

export function useFloatingMessenger(): FloatingMessengerContextValue {
  return useContext(FloatingMessengerContext);
}
