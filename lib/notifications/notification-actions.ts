import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrappers around the existing mark_notification_read /
 * mark_all_notifications_read RPCs (0040_notifications.sql, unchanged).
 * Both derive the caller from auth.uid() internally and scope every write
 * to `recipient_id = auth.uid()` -- no notification/user id is ever
 * trusted as an ownership claim; mark_notification_read is itself a
 * silent no-op for a foreign/nonexistent/already-read id (never a
 * distinguishing error that would leak whether that id exists).
 */

export type NotificationActionResult = { ok: true } | { ok: false };

export async function markNotificationRead(notificationId: string): Promise<NotificationActionResult> {
  const supabase = createClient();

  try {
    const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: notificationId });

    if (error) {
      console.error("mark_notification_read RPC failed:", error.message);
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error("mark_notification_read RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export type MarkAllNotificationsReadResult = { ok: true; markedCount: number } | { ok: false };

export async function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("mark_all_notifications_read");

    if (error) {
      console.error("mark_all_notifications_read RPC failed:", error.message);
      return { ok: false };
    }

    return { ok: true, markedCount: typeof data === "number" ? data : 0 };
  } catch (err) {
    console.error("mark_all_notifications_read RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

/**
 * Dismiss (soft-hide, never delete) a single notification of ANY type,
 * including new_message -- dismiss_notification (0091) only ever writes
 * notifications.dismissed_at, never touching conversation_user_states,
 * messages, or any other business table. Same silent-no-op-on-foreign-id
 * shape as mark_notification_read above.
 */
export type DismissNotificationResult = { ok: true } | { ok: false };

export async function dismissNotification(notificationId: string): Promise<DismissNotificationResult> {
  const supabase = createClient();

  try {
    const { error } = await supabase.rpc("dismiss_notification", { p_notification_id: notificationId });

    if (error) {
      console.error("dismiss_notification RPC failed:", error.message);
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error("dismiss_notification RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

/**
 * "Clear all" -- dismisses every undismissed notification the caller owns,
 * including new_message rows (0091). Never touches conversations,
 * conversation_user_states, messages, or any other business table; the
 * Messages badge and conversation read state are untouched by design.
 */
export type DismissAllNotificationsResult = { ok: true; dismissedCount: number } | { ok: false };

export async function dismissAllNotifications(): Promise<DismissAllNotificationsResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("dismiss_all_notifications");

    if (error) {
      console.error("dismiss_all_notifications RPC failed:", error.message);
      return { ok: false };
    }

    return { ok: true, dismissedCount: typeof data === "number" ? data : 0 };
  } catch (err) {
    console.error("dismiss_all_notifications RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
