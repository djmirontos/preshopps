"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useUnreadMessageCount } from "@/components/notifications/NotificationsProvider";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Real destination plus an unread-conversation-count badge, mirroring
 * NotificationBellLink/CartIconLink's exact pattern -- unreadMessageCount
 * is read from the shared NotificationsProvider (seeded once per request
 * from a root-layout get_my_conversations call, then kept live by that
 * Provider's own Realtime subscription and conversation-read
 * recalculation), never a prop and never fetched here. Desktop-header
 * counterpart to MobileBottomNav's own Messages tab badge.
 */
export function MessagesIconLink() {
  const unreadMessageCount = useUnreadMessageCount();

  return (
    // Desktop-header-only icon (rendered only in AppHeader's lg:flex nav,
    // never in the mobile row) -- side="bottom" so the tooltip has room
    // below the icon instead of being pushed above the viewport's top.
    <Tooltip label="Messages" side="bottom">
      <Link
        href="/messages"
        aria-label={unreadMessageCount > 0 ? `Messages, ${unreadMessageCount} unread` : "Messages"}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        {unreadMessageCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-action px-1 text-[10px] font-semibold leading-none text-brand-action-text"
          >
            {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
          </span>
        )}
      </Link>
    </Tooltip>
  );
}
