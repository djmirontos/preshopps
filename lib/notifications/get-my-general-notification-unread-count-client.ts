import { createClient } from "@/lib/supabase/client";

/**
 * ok=true carries the exact RPC-reported count, including a genuine 0.
 * ok=false means the count could not be determined at all (RPC error,
 * thrown/network error, or an unexpected response shape) -- the caller
 * must never treat this the same as a reported 0 (see
 * NotificationsProvider's own refreshUnreadNotificationCount, which keeps
 * the last-known Bell badge value instead of overwriting it with a
 * fabricated 0). Mirrors lib/messaging/get-my-unread-conversation-count.ts
 * exactly, one RPC over.
 */
export type GetMyGeneralNotificationUnreadCountResult = { ok: true; count: number } | { ok: false };

/**
 * Exact unread-notification count (every type EXCEPT new_message) via the
 * dedicated get_my_general_notification_unread_count RPC (0088) --
 * lib/notifications/get-my-general-notification-unread-count.ts is this
 * same RPC's server-side counterpart, used only for the root layout's SSR
 * seed. This browser-client version is for an authoritative client-side
 * recalculation without a page reload: on mount, when the tab regains
 * focus, when the Realtime channel reconnects, and (debounced) after any
 * incoming non-new_message notification event -- see
 * NotificationsProvider's own header comment for why the Bell is refreshed
 * rather than incremented.
 */
export async function getMyGeneralNotificationUnreadCount(): Promise<GetMyGeneralNotificationUnreadCountResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_general_notification_unread_count");

    if (error) {
      console.error("get_my_general_notification_unread_count RPC failed:", error.message);
      return { ok: false };
    }

    if (typeof data !== "number") {
      console.error("get_my_general_notification_unread_count RPC returned an unexpected response shape:", data);
      return { ok: false };
    }

    return { ok: true, count: data };
  } catch (err) {
    console.error("get_my_general_notification_unread_count RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
