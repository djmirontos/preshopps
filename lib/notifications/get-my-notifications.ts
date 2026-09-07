import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

/**
 * Exactly the fourteen values of public.notification_type_enum
 * (0040_notifications.sql) -- confirmed live, no drift since. Never invent
 * a fifteenth.
 */
export type NotificationType =
  | "order_request_received"
  | "order_accepted"
  | "order_declined"
  | "order_changes_pending"
  | "order_ready"
  | "order_handed_over_or_shipped"
  | "order_completed"
  | "order_cancelled"
  | "order_cancellation_requested"
  | "order_cancellation_rejected"
  | "order_expired"
  | "new_message"
  | "new_review"
  | "review_reply";

/**
 * Row shape exactly matching public.get_my_notifications' RETURNS TABLE
 * (0040_notifications.sql). No title/body/payload columns exist on the
 * notifications table itself -- every recipient-facing string is
 * projected fresh by the RPC (actor_display_name, order_public_code,
 * conversation_listing_title) and turned into copy client-side by
 * lib/notifications/notification-copy.ts, never stored.
 */
export type GetMyNotificationsRow = {
  notification_id: string;
  type: NotificationType;
  created_at: string;
  read_at: string | null;
  actor_display_name: string | null;
  actor_avatar_path: string | null;
  order_id: string | null;
  order_public_code: string | null;
  conversation_id: string | null;
  conversation_listing_title: string | null;
  review_id: string | null;
};

export type NotificationItem = {
  notificationId: string;
  type: NotificationType;
  createdAt: string;
  readAt: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | undefined;
  orderId: string | null;
  orderPublicCode: string | null;
  conversationId: string | null;
  conversationListingTitle: string | null;
  reviewId: string | null;
};

export type NotificationsCursor = {
  createdAt: string;
  id: string;
};

export type GetMyNotificationsResult = {
  notifications: NotificationItem[];
  hadError: boolean;
  nextCursor: NotificationsCursor | null;
};

function mapRow(row: GetMyNotificationsRow): NotificationItem {
  return {
    notificationId: row.notification_id,
    type: row.type,
    createdAt: row.created_at,
    readAt: row.read_at,
    actorDisplayName: row.actor_display_name,
    actorAvatarUrl: getListingImageUrl(row.actor_avatar_path),
    orderId: row.order_id,
    orderPublicCode: row.order_public_code,
    conversationId: row.conversation_id,
    conversationListingTitle: row.conversation_listing_title,
    reviewId: row.review_id,
  };
}

/**
 * Cursor pagination on (created_at, id) DESC, matching every other list in
 * this schema -- get_my_notifications (0040) already implements the
 * keyset itself; this is a plain pass-through, no OFFSET.
 */
export async function getMyNotifications(limit: number, cursor?: NotificationsCursor): Promise<GetMyNotificationsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_notifications", {
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_my_notifications RPC threw:", err instanceof Error ? err.message : err);
    return { notifications: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_my_notifications RPC failed:", error.message);
    return { notifications: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetMyNotificationsRow[];
  const notifications = rows.map(mapRow);
  const nextCursor =
    rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].notification_id } : null;

  return { notifications, hadError: false, nextCursor };
}
