"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useUnreadNotificationCount } from "@/components/notifications/NotificationsProvider";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Real destination plus an unread-count badge, mirroring CartIconLink's
 * exact pattern -- unreadCount is read from the shared NotificationsProvider
 * (seeded once per request, then kept live by that Provider's own Realtime
 * subscription and mark-read updates), never a prop and never fetched
 * here. Counts general marketplace notifications only -- new_message
 * never contributes here, it drives MessagesIconLink's own badge instead
 * (see NotificationsProvider's own header comment). Renders correctly
 * even without a Provider ancestor (context default is 0), matching
 * every existing call site's original "no badge" expectation.
 */
export function NotificationBellLink() {
  const unreadCount = useUnreadNotificationCount();

  return (
    // Header icon (also rendered in the mobile row, but the tooltip
    // itself only ever shows at lg+ regardless -- see Tooltip's own
    // comment) -- side="bottom" so it has room below the icon instead of
    // being pushed above the viewport's top.
    <Tooltip label="Notifications" side="bottom">
      <Link
        href="/notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-action px-1 text-[10px] font-semibold leading-none text-brand-action-text"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>
    </Tooltip>
  );
}
