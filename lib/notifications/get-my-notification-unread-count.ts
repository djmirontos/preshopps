import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";

/**
 * Single root-level scalar query, mirroring
 * lib/favorites/get-my-favorite-ids.ts's own guard shape: a guest never
 * reaches the RPC at all (get_my_notification_unread_count itself would
 * raise NOT_AUTHENTICATED for an unauthenticated caller). Fetched once per
 * request at the root layout and passed down to AppHeader -- exactly one
 * extra query site-wide, never a per-page or per-notification query, per
 * this task's explicit "no sitewide N+1" instruction. The header badge
 * naturally reflects the latest count on the next full navigation; a
 * mark-read/mark-all-read action on /notifications calls router.refresh()
 * (which re-renders the current route's Server Components, layouts
 * included) to update it immediately.
 */
export async function getMyNotificationUnreadCount(): Promise<number> {
  const user = await getAuthUser();
  if (!user) return 0;

  const supabase = await createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_notification_unread_count");

    if (error) {
      console.error("get_my_notification_unread_count RPC failed:", error.message);
      return 0;
    }

    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("get_my_notification_unread_count RPC threw:", err instanceof Error ? err.message : err);
    return 0;
  }
}
