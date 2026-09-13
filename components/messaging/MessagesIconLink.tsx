"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useUnreadMessageCount } from "@/components/notifications/NotificationsProvider";
import { useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";
import { isDesktopViewport } from "@/lib/ui/viewport";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Real destination plus an unread-conversation-count badge, mirroring
 * NotificationBellLink/CartIconLink's exact pattern -- unreadMessageCount
 * is read from the shared NotificationsProvider (seeded once per request
 * from a root-layout get_my_conversations call, then kept live by that
 * Provider's own Realtime subscription and conversation-read
 * recalculation), never a prop and never fetched here. Desktop-header
 * counterpart to MobileBottomNav's own Messages tab badge.
 *
 * Desktop (`lg` and up): opens the persistent messaging center in place
 * (openMessenger(), preserving whatever conversation was already
 * selected) instead of navigating to the full-page /messages route --
 * checked at click time only (an interactive event, never render), so
 * there's no SSR/hydration risk, matching ConversationsListClient's own
 * click-interception pattern exactly. A modified click (new-tab/new-
 * window/download conventions) or anything other than a plain left click
 * always falls through to the normal <Link> navigation. Below `lg`, this
 * is a no-op and the existing /messages full-page navigation proceeds
 * completely unchanged.
 */
export function MessagesIconLink() {
  const unreadMessageCount = useUnreadMessageCount();
  const { openMessenger } = useFloatingMessenger();

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!isDesktopViewport()) return;
    event.preventDefault();
    openMessenger();
  }

  return (
    // Desktop-header-only icon (rendered only in AppHeader's lg:flex nav,
    // never in the mobile row) -- side="bottom" so the tooltip has room
    // below the icon instead of being pushed above the viewport's top.
    <Tooltip label="Messages" side="bottom">
      <Link
        href="/messages"
        onClick={handleClick}
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
