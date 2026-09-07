import Link from "next/link";
import { Bell } from "lucide-react";

type Props = {
  unreadCount: number;
};

/**
 * Real destination (was href="#") plus an unread-count badge, mirroring
 * CartIconLink's exact pattern -- unreadCount is a plain server-fetched
 * prop (lib/notifications/get-my-notification-unread-count.ts, one scalar
 * RPC call per request at the root layout), not a client Context, since no
 * page-wide live interaction changes it outside of /notifications itself
 * (which calls router.refresh() after a mark-read action to update it
 * immediately on that page's own next render).
 */
export function NotificationBellLink({ unreadCount }: Props) {
  return (
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
  );
}
