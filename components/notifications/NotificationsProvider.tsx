"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { getMyUnreadConversationCount } from "@/lib/messaging/get-my-unread-conversation-count";
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
  /** Unread CONVERSATIONS (per get_my_conversations' own is_unread), never
   * unread new_message notification rows -- the two are tracked by
   * independent read systems (conversation_user_states vs
   * notifications.read_at), so only the conversation-level number stays
   * correct once a conversation is opened/read. */
  unreadMessageCount: number;
  /** Unread notifications of every type EXCEPT new_message -- the Bell is
   * for general marketplace activity, not messages. */
  unreadNotificationCount: number;
  /** The most recently received, not-already-processed notification
   * INSERT this session (every type, including new_message) --
   * consumers (the /notifications list, the conversation list) react to
   * this instead of opening a second websocket channel of their own. */
  lastEvent: NewNotificationEvent | null;
  markOneRead: () => void;
  markAllRead: () => void;
  /** Authoritative recalculation of unreadMessageCount from the server --
   * used after a conversation is marked read, instead of guessing how
   * much to decrement locally (opening one conversation says nothing by
   * itself about how many *other* conversations are still unread). */
  refreshUnreadMessageCount: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadMessageCount: 0,
  unreadNotificationCount: 0,
  lastEvent: null,
  markOneRead: () => {},
  markAllRead: () => {},
  refreshUnreadMessageCount: () => {},
});

type Props = {
  isAuthenticated: boolean;
  /** The signed-in user's own id, sourced from the same root-layout
   * getAuthUser() call already used for isAuthenticated -- never fetched
   * again here. Null for a guest, in which case no subscription is ever
   * created. */
  userId: string | null;
  /** Seeded once from the exact get_my_unread_conversation_count RPC
   * (0088) at the root layout -- this Provider then owns the count as
   * live state for the rest of the session, the same "server seed, then
   * client-managed" shape as CartProvider/FavoritesProvider. */
  initialUnreadMessageCount: number;
  /** Seeded once from the exact get_my_general_notification_unread_count
   * RPC (0088, unread and type <> 'new_message') at the root layout --
   * same shape as initialUnreadMessageCount above. */
  initialUnreadNotificationCount: number;
  children: ReactNode;
};

/**
 * Small, focused global notifications source -- deliberately not a large
 * state framework. Owns three pieces of live state (the two unread
 * counts and the latest incoming event) plus the one Realtime
 * subscription that feeds them. Mounted once at the root layout,
 * alongside AuthStatusProvider/FavoritesProvider/CartProvider.
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
 * reconnect) can never double-increment or double-refresh either badge.
 * A row's `type` decides which single mechanism it drives:
 *
 * - new_message: unreadMessageCount is a count of UNREAD CONVERSATIONS
 *   (get_my_unread_conversation_count's own semantics, identical to
 *   get_my_conversations' per-row is_unread flag) -- a conversation with
 *   five new unread messages still counts once. A raw per-event
 *   increment would be wrong here (it would count messages, not
 *   conversations), so a new_message event instead schedules a debounced
 *   authoritative refresh (re-fetches the exact scalar count) rather than
 *   ever incrementing this number directly. Debounced so a burst of
 *   several messages -- to the same or different conversations --
 *   triggers one refetch shortly after the burst settles, not one per
 *   message. Never affects unreadNotificationCount.
 * - everything else: unreadNotificationCount (the Bell, general
 *   marketplace activity) is incremented by exactly 1 per deduped event --
 *   safe here because each such event is its own independent, permanent
 *   unread item (no analogous "already counted via a different row"
 *   ambiguity the way conversations have). Never affects
 *   unreadMessageCount.
 *
 * Session-race fix (see this Provider's own git history for the original
 * bug): this Provider mounts at the very first paint of the app, before
 * the browser Supabase client has necessarily finished restoring/
 * validating the session from cookies/localStorage. Subscribing before
 * that resolves means the Realtime websocket authenticates as anon (no
 * JWT), so notifications_select_own's RLS check (auth.uid() =
 * recipient_id) never matches for that connection -- Postgres silently
 * sends zero events to it, and since isAuthenticated/userId are resolved
 * server-side and never change again, the effect never re-runs to retry.
 * Explicitly awaiting getSession() first forces the client to finish that
 * hydration (which internally calls realtime.setAuth(access_token)) before
 * the channel is ever created. (ConversationDetailClient's own messages
 * subscription deliberately does NOT get this same guard -- see its own
 * file for why.)
 */
const MESSAGE_BADGE_REFRESH_DEBOUNCE_MS = 400;

export function NotificationsProvider({
  isAuthenticated,
  userId,
  initialUnreadMessageCount,
  initialUnreadNotificationCount,
  children,
}: Props) {
  const [unreadMessageCount, setUnreadMessageCount] = useState(initialUnreadMessageCount);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(initialUnreadNotificationCount);
  const [lastEvent, setLastEvent] = useState<NewNotificationEvent | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable identities (empty deps -- the setState functions React gives us
  // are themselves stable) so consumers that depend on these functions in
  // their own effects (e.g. ConversationDetailClient's mark-read-on-open
  // effect, or the subscription effect below) don't re-run just because
  // unreadMessageCount/unreadNotificationCount/lastEvent changed.
  const markOneRead = useCallback(() => setUnreadNotificationCount((prev) => Math.max(0, prev - 1)), []);
  const markAllRead = useCallback(() => setUnreadNotificationCount(0), []);
  const refreshUnreadMessageCount = useCallback(() => {
    void getMyUnreadConversationCount().then((count) => setUnreadMessageCount(count));
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    let cancelled = false;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function subscribe() {
      try {
        // Wait for the browser client's own session hydration (and its
        // internal realtime.setAuth call) before subscribing -- see the
        // file-level comment above for why this specific ordering is the
        // actual fix, not a workaround.
        await supabase.auth.getSession();
        if (cancelled) return;

        channel = supabase
          .channel(`notifications:${userId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
            (payload) => {
              const row = payload.new as RawNotificationRow;
              if (seenIdsRef.current.has(row.id)) return;
              seenIdsRef.current.add(row.id);

              if (row.type === "new_message") {
                // Debounced authoritative refresh, never a blind
                // increment -- see the class-level comment above. Each
                // new deduped event resets the timer, so a rapid burst
                // (5 messages in the same still-unread conversation, or
                // across several conversations) still ends in exactly
                // one refetch, and the badge always ends up reflecting
                // real server state, not an accumulated guess. If the
                // conversation is opened and read in the meantime,
                // ConversationDetailClient's own immediate
                // refreshUnreadMessageCount() call and this debounced one
                // both just re-fetch the same authoritative scalar --
                // whichever resolves last simply reconfirms the current
                // truth, so there is no drift regardless of ordering.
                if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
                refreshTimeoutRef.current = setTimeout(() => {
                  refreshTimeoutRef.current = null;
                  refreshUnreadMessageCount();
                }, MESSAGE_BADGE_REFRESH_DEBOUNCE_MS);
              } else {
                setUnreadNotificationCount((prev) => prev + 1);
              }

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
          .subscribe((status, err) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.error("Notifications realtime subscription failed:", err?.message ?? status);
            }
          });
      } catch (err) {
        console.error("Realtime notifications subscription failed to start:", err instanceof Error ? err.message : err);
      }
    }

    void subscribe();

    return () => {
      cancelled = true;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (channel) supabase.removeChannel(channel);
    };
  }, [isAuthenticated, userId, refreshUnreadMessageCount]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unreadMessageCount,
      unreadNotificationCount,
      lastEvent,
      markOneRead,
      markAllRead,
      refreshUnreadMessageCount,
    }),
    [unreadMessageCount, unreadNotificationCount, lastEvent, markOneRead, markAllRead, refreshUnreadMessageCount],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useUnreadMessageCount(): number {
  return useContext(NotificationsContext).unreadMessageCount;
}

export function useUnreadNotificationCount(): number {
  return useContext(NotificationsContext).unreadNotificationCount;
}

export function useLatestNotificationEvent(): NewNotificationEvent | null {
  return useContext(NotificationsContext).lastEvent;
}

export function useNotificationsMarkRead(): { markOneRead: () => void; markAllRead: () => void } {
  const { markOneRead, markAllRead } = useContext(NotificationsContext);
  return { markOneRead, markAllRead };
}

export function useRefreshUnreadMessageCount(): () => void {
  return useContext(NotificationsContext).refreshUnreadMessageCount;
}
