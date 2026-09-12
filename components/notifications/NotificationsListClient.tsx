"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import { getNotificationTitle, getNotificationMessage, getNotificationHref } from "@/lib/notifications/notification-copy";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/notifications/notification-actions";
import { useLatestNotificationEvent, useNotificationsMarkRead } from "@/components/notifications/NotificationsProvider";
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

  const { markOneRead, markAllRead } = useNotificationsMarkRead();

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
      {hasUnread && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markAllPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-ink-secondary hover:bg-canvas hover:text-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {markAllPending ? "Marking…" : "Mark all read"}
          </button>
        </div>
      )}
      {markAllError && <p className="mb-3 text-xs text-danger">{markAllError}</p>}

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

          if (href) {
            return (
              <li key={item.notificationId}>
                <Link
                  href={href}
                  onClick={() => handleLinkClick(item)}
                  className="block rounded-[14px] border border-border bg-surface p-3 hover:border-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:p-4"
                >
                  {rowContent}
                </Link>
              </li>
            );
          }

          return (
            <li key={item.notificationId} className="rounded-[14px] border border-border bg-surface p-3 sm:p-4">
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
