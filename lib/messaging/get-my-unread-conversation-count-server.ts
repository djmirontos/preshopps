import { getAuthUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side counterpart to lib/messaging/get-my-unread-conversation-
 * count.ts (browser client) -- same get_my_unread_conversation_count RPC
 * (0088), called with the server Supabase client for the root layout's
 * own initial seed. Kept as a separate file (not a shared implementation)
 * because the two runtimes need different Supabase client constructors
 * (@/lib/supabase/server vs @/lib/supabase/client), matching this
 * codebase's existing convention of never mixing server-only and
 * browser-only client creation in one module. Guards on getAuthUser()
 * first, exactly like getMyNotificationUnreadCount's own convention, so a
 * guest pageview never issues a doomed-to-fail authenticated RPC call.
 */
export async function getMyUnreadConversationCountServer(): Promise<number> {
  const user = await getAuthUser();
  if (!user) return 0;

  const supabase = await createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_unread_conversation_count");

    if (error) {
      console.error("get_my_unread_conversation_count RPC failed:", error.message);
      return 0;
    }

    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("get_my_unread_conversation_count RPC threw:", err instanceof Error ? err.message : err);
    return 0;
  }
}
