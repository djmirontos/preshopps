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
