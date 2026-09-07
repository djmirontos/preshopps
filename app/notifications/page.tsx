import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyNotifications } from "@/lib/notifications/get-my-notifications";
import { NotificationsListClient } from "@/components/notifications/NotificationsListClient";
import type { NotificationsCursor } from "@/lib/notifications/get-my-notifications";

export const metadata = { title: "Notifications | Preshopps" };

const NOTIFICATIONS_LIMIT = 20;

/**
 * Authenticated-only, exactly like /orders, /messages, /seller/orders:
 * getAuthUser() runs before any notification data is fetched, so a guest
 * never triggers get_my_notifications. Opening this page does NOT mark
 * everything read automatically, per this task's own explicit instruction
 * -- marking read happens only via clicking through a linkable
 * notification or the explicit mark-one/mark-all controls.
 */
export default async function NotificationsPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/notifications")}`);
  }

  const result = await getMyNotifications(NOTIFICATIONS_LIMIT);

  async function loadMoreAction(cursor: NotificationsCursor) {
    "use server";
    return getMyNotifications(NOTIFICATIONS_LIMIT, cursor);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Notifications</h1>
      <p className="mt-1 text-sm text-ink-secondary">Updates about your orders, messages, and marketplace activity.</p>

      <div className="mt-6">
        <NotificationsListClient
          initialNotifications={result.notifications}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
        />
      </div>
    </div>
  );
}
