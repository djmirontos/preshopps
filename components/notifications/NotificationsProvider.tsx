"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { NotificationType } from "@/lib/notifications/get-my-notifications";

/** Raw public.notifications row shape, exactly as Realtime's
 * postgres_changes INSERT payload.new delivers it -- no
 * actor_display_name/order_public_code/conversation_listing_title (those
 * are projections get_my_notifications joins in server-side, never present
 * on the raw table row). */
export type RawNotificationRow = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  actor_id: string | null;
  order_id: string | null;
  conversation_id: string | null;
  review_id: string | null;
  created_at: string;
  read_at: string | null;
};

/** A minimal, just-arrived notification signal -- consumers that need the
 * full display copy (actor name, order code, listing title) already
 * degrade gracefully on the missing fields via
 * lib/notifications/notification-copy.ts's own null-fallback design. */
export type NewNotificationEvent = {
  notificationId: string;
  type: NotificationType;
  createdAt: string;
  readAt: string | null;
  actorId: string | null;
  orderId: string | null;
  conversationId: string | null;
  reviewId: string | null;
};

type NotificationsContextValue = {
  unreadCount: number;
  /** The most recently received, not-already-processed notification
   * INSERT this session -- consumers (the /notifications list, the
   * conversation list) react to this instead of opening a second
   * websocket channel of their own. */
  lastEvent: NewNotificationEvent | null;
  markOneRead: () => void;
  markAllRead: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  lastEvent: null,
  markOneRead: () => {},
  markAllRead: () => {},
});

type Props = {
  isAuthenticated: boolean;
  /** The signed-in user's own id, sourced from the same root-layout
   * getAuthUser() call already used for isAuthenticated -- never fetched
   * again here. Null for a guest, in which case no subscription is ever
   * created. */
  userId: string | null;
  /** Seeded once from the existing root-layout
   * get_my_notification_unread_count() call -- this Provider then owns the
   * count as live state for the rest of the session, the same "server
   * seed, then client-managed" shape as CartProvider/FavoritesProvider. */
  initialUnreadCount: number;
  children: ReactNode;
};

/**
 * Small, focused global notifications source -- deliberately not a large
 * state framework. Owns exactly two pieces of live state (the unread
 * count and the latest incoming event) plus the one Realtime subscription
 * that feeds them. Mounted once at the root layout, alongside
 * AuthStatusProvider/FavoritesProvider/CartProvider.
 *
 * Subscribes to postgres_changes INSERT on public.notifications filtered
 * to `recipient_id=eq.<userId>` -- RLS's own notifications_select_own
 * policy (`auth.uid() = recipient_id`) independently re-enforces the same
 * boundary server-side per subscribing connection, so this filter is a
 * performance narrowing, not the security boundary itself; no notification
 * data can ever cross between users through this channel regardless of
 * what filter string a client sends.
 *
 * Every incoming row is deduped by its own id before being counted or
 * surfaced as `lastEvent`, so a duplicate/replayed event (e.g. a
 * reconnect) can never double-increment the badge.
 */
export function NotificationsProvider({ isAuthenticated, userId, initialUnreadCount, children }: Props) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [lastEvent, setLastEvent] = useState<NewNotificationEvent | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    // Never let a client construction/subscription failure throw
    // uncaught -- worst case, the badge simply stops updating live for
    // this session, same as before Realtime existed. Matches every other
    // Supabase-touching call in this codebase.
    try {
      const supabase = createClient();
      const channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as RawNotificationRow;
            if (seenIdsRef.current.has(row.id)) return;
            seenIdsRef.current.add(row.id);

            setUnreadCount((prev) => prev + 1);
            setLastEvent({
              notificationId: row.id,
              type: row.type,
              createdAt: row.created_at,
              readAt: row.read_at,
              actorId: row.actor_id,
              orderId: row.order_id,
              conversationId: row.conversation_id,
              reviewId: row.review_id,
            });
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.error("Realtime notifications subscription failed to start:", err instanceof Error ? err.message : err);
      return undefined;
    }
  }, [isAuthenticated, userId]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unreadCount,
      lastEvent,
      markOneRead: () => setUnreadCount((prev) => Math.max(0, prev - 1)),
      markAllRead: () => setUnreadCount(0),
    }),
    [unreadCount, lastEvent],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsUnreadCount(): number {
  return useContext(NotificationsContext).unreadCount;
}

export function useLatestNotificationEvent(): NewNotificationEvent | null {
  return useContext(NotificationsContext).lastEvent;
}

export function useNotificationsMarkRead(): { markOneRead: () => void; markAllRead: () => void } {
  const { markOneRead, markAllRead } = useContext(NotificationsContext);
  return { markOneRead, markAllRead };
}
