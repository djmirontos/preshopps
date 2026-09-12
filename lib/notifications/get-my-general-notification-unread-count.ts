import { getAuthUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Exact count of unread notifications EXCLUDING new_message, via the
 * dedicated get_my_general_notification_unread_count RPC (0088) -- the
 * Bell badge's own seed. get_my_notification_unread_count (existing,
 * untouched) counts every type together, which would double-count
 * new_message into the Bell; this is the type-aware variant, same
 * "auth required, deleted-account guard, plain scalar" shape as that
 * function, with exactly one added predicate (type <> 'new_message').
 * Guards on getAuthUser() first, matching that same existing convention,
 * so a guest pageview never issues a doomed-to-fail authenticated RPC
 * call.
 */
export async function getMyGeneralNotificationUnreadCount(): Promise<number> {
  const user = await getAuthUser();
  if (!user) return 0;

  const supabase = await createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_general_notification_unread_count");

    if (error) {
      console.error("get_my_general_notification_unread_count RPC failed:", error.message);
      return 0;
    }

    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("get_my_general_notification_unread_count RPC threw:", err instanceof Error ? err.message : err);
    return 0;
  }
}
