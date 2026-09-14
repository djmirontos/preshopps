"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell, CheckCheck, Trash2, X } from "lucide-react";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import { getNotificationTitle, getNotificationMessage, getNotificationHref } from "@/lib/notifications/notification-copy";
import {
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  dismissAllNotifications,
} from "@/lib/notifications/notification-actions";
import {
  useLatestNotificationEvent,
  useNotificationsMarkRead,
  useNotificationsDismiss,
} from "@/components/notifications/NotificationsProvider";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import type { NotificationItem, NotificationsCursor } from "@/lib/notifications/get-my-notifications";

type LoadMoreResult = {
  notifications: NotificationItem[];
  hadError: boolean;
  nextCursor: NotificationsCursor | null;
};

type Props = {
  initialNotifications: NotificationItem[];
  initialHadError: boolean;
  initialCursor: NotificationsCursor | null;
  loadMore: (cursor: NotificationsCursor) => Promise<LoadMoreResult>;
};

/**
 * Same server-rendered-first-page + Load More shape as every other list in
 * this app -- cursor pagination on (created_at, id), never OFFSET, per
 * get_my_notifications (0040). A linkable unread row marks itself read
 * (fire-and-forget, non-blocking) the moment it's clicked, per this task's
 * own "if clicking can safely mark it read before navigation, do so"
 * instruction; a non-linkable row (order_completed, new_review,
 * review_reply -- see notification-copy.ts for why no safe link exists)
 * gets its own small "Mark read" control instead, since there is no click-
 * through to attach the mark-read side effect to.
 */
export function NotificationsListClient({ initialNotifications, initialHadError, initialCursor, loadMore }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [markAllPending, setMarkAllPending] = useState(false);
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const [markingIds, setMarkingIds] = useState<ReadonlySet<string>>(new Set());
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [clearAllPending, setClearAllPending] = useState(false);
  const [clearAllError, setClearAllError] = useState<string | null>(null);

  const { markOneRead, markAllRead } = useNotificationsMarkRead();
  const { decrementGeneralUnreadByOne, restoreGeneralUnreadByOne, clearGeneralUnreadCount } = useNotificationsDismiss();

  // Live prepend while this page is mounted: reuses the shared
  // NotificationsProvider's own Realtime subscription (no second
  // websocket channel opened here). lastEvent only carries the raw
  // table-row fields (no actor name/order code/listing title), so the
  // prepended row renders via notification-copy.ts's own graceful
  // null-fallback copy until the next full fetch fills in the rest.
  // De-duped by notification_id in case of an overlap with a concurrent
  // loadMore page.
  // Adjusting state during render (not inside an effect) when `lastEvent`
  // changes from the shared Provider -- the same "sync state to a changed
  // external value" pattern CartProvider's own initialLines resync uses,
  // per React's own guidance that this belongs in the render body, not a
  // useEffect, when it's a direct reaction to a value that just changed.
  const lastEvent = useLatestNotificationEvent();
  const [prevLastEvent, setPrevLastEvent] = useState(lastEvent);
  if (lastEvent !== prevLastEvent) {
    setPrevLastEvent(lastEvent);
    if (lastEvent) {
      setNotifications((prev) => {
        if (prev.some((n) => n.notificationId === lastEvent.notificationId)) return prev;
        const newItem: NotificationItem = {
          notificationId: lastEvent.notificationId,
          type: lastEvent.type,
          createdAt: lastEvent.createdAt,
          readAt: lastEvent.readAt,
          actorDisplayName: null,
          actorAvatarUrl: undefined,
          orderId: lastEvent.orderId,
          orderPublicCode: null,
          conversationId: lastEvent.conversationId,
          conversationListingTitle: null,
          reviewId: lastEvent.reviewId,
        };
        return [newItem, ...prev];
      });
    }
  }

  const hasUnread = notifications.some((n) => n.readAt === null);

  function markLocalRead(notificationId: string) {
    setNotifications((prev) => prev.map((n) => (n.notificationId === notificationId ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  function handleLinkClick(item: NotificationItem) {
    if (item.readAt !== null) return;
    markLocalRead(item.notificationId);
    markOneRead();
    void markNotificationRead(item.notificationId);
  }

  async function handleMarkOneRead(notificationId: string) {
    setMarkingIds((prev) => new Set(prev).add(notificationId));
    const result = await markNotificationRead(notificationId);
    setMarkingIds((prev) => {
      const next = new Set(prev);
      next.delete(notificationId);
      return next;
    });
    if (result.ok) {
      markLocalRead(notificationId);
      // Immediate, not solely reliant on the refresh below: the shared
      // provider's own count is the header badge's live source now.
      markOneRead();
      // Still refreshed as a harmless belt-and-suspenders safety net for
      // any other server-rendered surface still keyed off the layout's
      // own initial fetch.
      router.refresh();
    }
  }

  async function handleMarkAllRead() {
    setMarkAllPending(true);
    setMarkAllError(null);
    const result = await markAllNotificationsRead();
    setMarkAllPending(false);

    if (!result.ok) {
      setMarkAllError("Unable to mark all as read right now. Please try again.");
      return;
    }

    markAllRead();
    router.refresh();

    setNotifications((prev) => prev.map((n) => (n.readAt === null ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  /**
   * Individual dismiss -- no confirmation, works on ANY notification type
   * including new_message (0091 product decision: dismissal only ever
   * writes notifications.dismissed_at, never conversation_user_states/
   * messages/conversations, so it's safe uniformly). Optimistic: the row
   * disappears and the Bell count adjusts immediately, before the RPC
   * resolves; on failure both are rolled back and a generic error shown
   * (never a raw database error), per this feature's own error-behavior
   * requirement.
   */
  async function handleDismiss(item: NotificationItem) {
    setDismissError(null);
    const wasGeneralUnread = item.readAt === null && item.type !== "new_message";
    const snapshot = notifications;

    setNotifications((prev) => prev.filter((n) => n.notificationId !== item.notificationId));
    if (wasGeneralUnread) decrementGeneralUnreadByOne();

    const result = await dismissNotification(item.notificationId);
    if (!result.ok) {
      setNotifications(snapshot);
      if (wasGeneralUnread) restoreGeneralUnreadByOne();
      setDismissError("Unable to dismiss that notification right now. Please try again.");
    }
  }

  /**
   * Clear All -- requires the confirmation dialog above it (opened via
   * showClearAllConfirm), unlike single dismiss. Deliberately NOT
   * optimistic (mirrors handleMarkAllRead's own pattern): the list and
   * Bell count only change once the RPC confirms success, so a failure
   * never has to "undo" a false success and the dialog can show the
   * error in place without misleadingly implying the clear happened.
   * dismiss_all_notifications (0091) dismisses every type including
   * new_message, so on success the entire local list is cleared.
   */
  async function handleConfirmClearAll() {
    setClearAllPending(true);
    setClearAllError(null);
    const result = await dismissAllNotifications();
    setClearAllPending(false);

    if (!result.ok) {
      setClearAllError("Unable to clear notifications right now. Please try again.");
      return;
    }

    setShowClearAllConfirm(false);
    clearGeneralUnreadCount();
    router.refresh();
    setNotifications([]);
    setCursor(null);
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await loadMore(cursor);
      if (result.hadError) {
        setLoadMoreFailed(true);
        return;
      }
      setNotifications((prev) => [...prev, ...result.notifications]);
      setCursor(result.nextCursor);
    });
  }

  if (initialHadError) {
    return <p className="text-sm text-ink-secondary">Unable to load your notifications right now.</p>;
  }

  if (notifications.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <Bell className="mx-auto h-8 w-8 text-ink-muted/60" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-ink">No notifications yet.</p>
        <p className="mt-1 text-sm text-ink-muted">Updates about your orders, messages, and marketplace activity will appear here.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        {hasUnread && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markAllPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-ink-secondary hover:bg-canvas hover:text-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {markAllPending ? "Marking…" : "Mark all read"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowClearAllConfirm(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-ink-secondary hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Clear all
        </button>
      </div>
      {markAllError && <p className="mb-3 text-xs text-danger">{markAllError}</p>}
      {dismissError && <p className="mb-3 text-xs text-danger">{dismissError}</p>}

      {showClearAllConfirm && (
        <ConfirmDialog
          title="Clear all notifications?"
          description="This will remove all notifications from your list. This won't affect your orders, messages, or other marketplace activity."
          confirmLabel="Clear all"
          destructive
          isPending={clearAllPending}
          errorMessage={clearAllError}
          onConfirm={() => void handleConfirmClearAll()}
          onClose={() => {
            if (clearAllPending) return;
            setShowClearAllConfirm(false);
            setClearAllError(null);
          }}
        />
      )}

      <ul className="space-y-2">
        {notifications.map((item) => {
          const isUnread = item.readAt === null;
          const href = getNotificationHref(item);
          const title = getNotificationTitle(item.type);
          const message = getNotificationMessage(item);

          const rowContent = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className={isUnread ? "text-sm font-semibold text-ink" : "text-sm font-medium text-ink"}>{title}</span>
                <span className="shrink-0 text-xs text-ink-muted">{formatMessageTimestamp(item.createdAt)}</span>
              </div>
              <div className="mt-1 flex items-start gap-1.5">
                {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-action" aria-hidden="true" />}
                <p className={isUnread ? "text-sm text-ink" : "text-sm text-ink-secondary"}>{message}</p>
              </div>
              {isUnread && <span className="sr-only"> (unread)</span>}
            </>
          );

          // The dismiss X is always rendered as a sibling of the Link, never
          // a child of it -- nesting an interactive control inside an <a>
          // is both invalid HTML and would make an X click also fire
          // navigation. The <li> is the positioning context (relative) so
          // the X can sit visually in the row's top-right corner regardless
          // of which branch renders below it; the row content itself gets
          // right padding so its own timestamp text never sits under it.
          const dismissButton = (
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => void handleDismiss(item)}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:right-2.5 sm:top-2.5"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          );

          if (href) {
            return (
              <li key={item.notificationId} className="relative">
                <Link
                  href={href}
                  onClick={() => handleLinkClick(item)}
                  className="block rounded-[14px] border border-border bg-surface p-3 pr-9 hover:border-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:p-4 sm:pr-10"
                >
                  {rowContent}
                </Link>
                {dismissButton}
              </li>
            );
          }

          return (
            <li key={item.notificationId} className="relative rounded-[14px] border border-border bg-surface p-3 pr-9 sm:p-4 sm:pr-10">
              {rowContent}
              {isUnread && (
                <button
                  type="button"
                  onClick={() => handleMarkOneRead(item.notificationId)}
                  disabled={markingIds.has(item.notificationId)}
                  className="mt-2 text-xs font-medium text-brand-link hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {markingIds.has(item.notificationId) ? "Marking…" : "Mark read"}
                </button>
              )}
              {dismissButton}
            </li>
          );
        })}
      </ul>

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-[10px] border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-link hover:text-brand-link disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more notifications right now.</p>}
        </div>
      )}
    </div>
  );
}
