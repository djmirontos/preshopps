import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("Notifications UI never trusts client-supplied identity", () => {
  it("get-my-notifications.ts calls get_my_notifications with no user id argument", () => {
    const source = readFile("lib/notifications/get-my-notifications.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_notifications["']/);
    expect(source).not.toMatch(/p_user_id|p_recipient_id|p_caller_id/);
  });

  it("get-my-notification-unread-count.ts calls get_my_notification_unread_count with no arguments", () => {
    const source = readFile("lib/notifications/get-my-notification-unread-count.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_notification_unread_count["']\s*\)/);
  });

  it("notification-actions.ts sends only a notification id -- never a user/recipient id", () => {
    const source = readFile("lib/notifications/notification-actions.ts");
    expect(source).toMatch(/rpc\(\s*["']mark_notification_read["']/);
    expect(source).toMatch(/rpc\(\s*["']mark_all_notifications_read["']\s*\)/);
    expect(source).not.toMatch(/p_user_id|p_recipient_id|p_caller_id/);
  });

  it("notification-actions.ts's dismiss functions (0091) also send only a notification id -- never a user/recipient id", () => {
    const source = readFile("lib/notifications/notification-actions.ts");
    expect(source).toMatch(/rpc\(\s*["']dismiss_notification["']/);
    expect(source).toMatch(/rpc\(\s*["']dismiss_all_notifications["']\s*\)/);
    expect(source).not.toMatch(/p_user_id|p_recipient_id|p_caller_id/);
  });

  it("no notification module ever selects the notifications table directly", () => {
    for (const file of ["lib/notifications/get-my-notifications.ts", "lib/notifications/get-my-notification-unread-count.ts", "lib/notifications/notification-actions.ts"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.from\(\s*["']notifications["']\s*\)/);
    }
  });
});

describe("no service-role bypass anywhere in the Notifications module", () => {
  it("no notifications file references a service-role key", () => {
    const files = [
      "lib/notifications/get-my-notifications.ts",
      "lib/notifications/get-my-notification-unread-count.ts",
      "lib/notifications/notification-actions.ts",
      "lib/notifications/notification-copy.ts",
      "components/notifications/NotificationBellLink.tsx",
      "components/notifications/NotificationsListClient.tsx",
      "app/notifications/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Notifications UI does not build out-of-scope modules", () => {
  it("does not build push notifications or email delivery; no file besides NotificationsProvider opens a Realtime channel; no polling", () => {
    const files = [
      "lib/notifications/get-my-notifications.ts",
      "lib/notifications/get-my-notification-unread-count.ts",
      "lib/notifications/notification-actions.ts",
      "components/notifications/NotificationsListClient.tsx",
      "components/notifications/NotificationBellLink.tsx",
      "app/notifications/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.channel\(|\.subscribe\(|supabase\.realtime/i);
      expect(source).not.toMatch(/service-worker|push\.subscribe|PushManager/i);
      expect(source).not.toMatch(/sendEmail|nodemailer|resend\.emails/i);
      expect(source).not.toMatch(/setInterval|setTimeout.*poll/i);
    }
  });

  it("does not build a reviews or disputes UI -- review-related notification types render without a clickable destination", () => {
    const source = readFile("lib/notifications/notification-copy.ts");
    expect(source).not.toMatch(/leave a review|star rating|\/review/i);
    expect(source).not.toMatch(/dispute_status|open a dispute|\/dispute/i);
  });
});

/**
 * Realtime slice 2 (per the accepted audit + 0087's publication change):
 * public.notifications is now in the supabase_realtime publication.
 * NotificationsProvider is the ONE place in the app that opens a
 * websocket to it -- a single global, session-lifetime subscription
 * filtered to `recipient_id=eq.<the signed-in user's own id>`, mounted
 * once at the root layout. Every other notifications file (the bell link,
 * the list, the mark-read actions) reads from this shared Provider instead
 * of subscribing itself, and no file ever opens a subscription for a
 * guest.
 */
describe("Notifications Realtime is scoped to exactly one global, per-user-filtered subscription", () => {
  it("NotificationsProvider subscribes to postgres_changes INSERT on notifications, filtered to the caller's own recipient_id", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/\.channel\(/);
    expect(source).toMatch(/postgres_changes/);
    expect(source).toMatch(/event:\s*["']INSERT["']/);
    expect(source).toMatch(/table:\s*["']notifications["']/);
    expect(source).toMatch(/filter:\s*`recipient_id=eq\.\$\{/);
  });

  it("NotificationsProvider never subscribes when there is no authenticated userId -- no guest subscription", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/if \(!isAuthenticated \|\| !userId\) return;/);
  });

  it("NotificationsProvider cleanly unsubscribes (removeChannel) on unmount/auth change", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/removeChannel/);
  });

  it("NotificationsProvider dedupes incoming rows by id before counting or surfacing them", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/seenIdsRef/);
  });

  it("no other notifications file opens its own Realtime channel -- they all consume the shared Provider", () => {
    const files = [
      "lib/notifications/get-my-notifications.ts",
      "lib/notifications/get-my-notification-unread-count.ts",
      "lib/notifications/notification-actions.ts",
      "components/notifications/NotificationBellLink.tsx",
      "components/notifications/NotificationsListClient.tsx",
      "components/messaging/ConversationsListClient.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.channel\(|\.subscribe\(|supabase\.realtime/i);
    }
  });

  it("NotificationBellLink and NotificationsListClient consume the shared Provider hooks rather than fetching/subscribing themselves", () => {
    const bellSource = readFile("components/notifications/NotificationBellLink.tsx");
    expect(bellSource).toMatch(/useUnreadNotificationCount/);

    const listSource = readFile("components/notifications/NotificationsListClient.tsx");
    expect(listSource).toMatch(/useLatestNotificationEvent/);
  });

  it("waits for the browser client's session to resolve before subscribing -- the fix for the original 'realtime never fires' bug", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/await supabase\.auth\.getSession\(\)/);
  });
});

/**
 * Realtime slice 3 (unread-count split): a notification's `type` decides
 * which of the two independent counters it affects -- new_message
 * contributes to unreadMessageCount only, every other type to
 * unreadNotificationCount only. The Bell is for general marketplace
 * activity; the Messages badge (AppHeader's MessagesIconLink,
 * MobileBottomNav's Messages tab) is for new_message specifically.
 */
describe("Bell vs Messages badge counts are split and never double-counted", () => {
  it("NotificationsProvider exposes two independent counts, not one merged unreadCount", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/unreadMessageCount/);
    expect(source).toMatch(/unreadNotificationCount/);
    expect(source).not.toMatch(/\bunreadCount\b/);
  });

  it("routes new_message to a debounced authoritative refresh (never a direct setUnreadMessageCount increment) and every other type to a direct unreadNotificationCount increment, in one exclusive branch", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    const branchMatch = source.match(/if \(row\.type === ["']new_message["']\) \{([\s\S]*?)\n\s*\} else \{([\s\S]*?)\n\s*\}/);
    expect(branchMatch).not.toBeNull();
    const [, newMessageBranch, otherBranch] = branchMatch!;

    // new_message never increments the badge directly -- it schedules a
    // debounced authoritative re-fetch instead (Part 1's fix).
    expect(newMessageBranch).not.toMatch(/setUnreadMessageCount/);
    expect(newMessageBranch).toMatch(/clearTimeout/);
    expect(newMessageBranch).toMatch(/setTimeout/);
    expect(newMessageBranch).toMatch(/refreshUnreadMessageCount\(\)/);

    // every other type still increments the Bell count directly and
    // immediately -- unaffected by the new_message debounce.
    expect(otherBranch).toMatch(/setUnreadNotificationCount\(\(prev\) => prev \+ 1\)/);
  });

  it("the new_message debounce timer is tracked in a ref and cleared both on reschedule and on unmount -- no leaked timer, no drift from a stale pending refresh", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/refreshTimeoutRef\s*=\s*useRef/);
    expect(source).toMatch(/if \(refreshTimeoutRef\.current\) clearTimeout\(refreshTimeoutRef\.current\)/);
  });

  it("markOneRead/markAllRead (driven by /notifications' own mark-read actions) only ever touch unreadNotificationCount", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/markOneRead = useCallback\(\(\) => setUnreadNotificationCount/);
    expect(source).toMatch(/markAllRead = useCallback\(\(\) => setUnreadNotificationCount\(0\)/);
  });

  it("MessagesIconLink (desktop) and MobileBottomNav's Messages tab both read unreadMessageCount, never unreadNotificationCount", () => {
    const messagesIconSource = readFile("components/messaging/MessagesIconLink.tsx");
    expect(messagesIconSource).toMatch(/useUnreadMessageCount/);
    expect(messagesIconSource).not.toMatch(/useUnreadNotificationCount/);

    const mobileNavSource = readFile("components/layout/MobileBottomNav.tsx");
    expect(mobileNavSource).toMatch(/useUnreadMessageCount/);
    expect(mobileNavSource).not.toMatch(/useUnreadNotificationCount/);
  });

  it("AppHeader's Bell (NotificationBellLink) never reads unreadMessageCount", () => {
    const source = readFile("components/notifications/NotificationBellLink.tsx");
    expect(source).not.toMatch(/useUnreadMessageCount/);
  });

  it("does not add a bell/notifications icon to MobileBottomNav", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    expect(source).not.toMatch(/Bell|NotificationBellLink/);
  });

  it("a conversation being marked read triggers an authoritative recalculation (refreshUnreadMessageCount), not a blind local decrement", () => {
    const providerSource = readFile("components/notifications/NotificationsProvider.tsx");
    expect(providerSource).toMatch(/refreshUnreadMessageCount/);
    expect(providerSource).toMatch(/getMyUnreadConversationCount/);

    // ConversationDetailClient is now a thin wrapper -- the actual
    // subscription/mark-read logic (and this refreshUnreadMessageCount
    // usage) lives in ConversationThread, its one shared implementation
    // (also reused by FloatingChatPanel).
    const conversationThreadSource = readFile("components/messaging/ConversationThread.tsx");
    expect(conversationThreadSource).toMatch(/useRefreshUnreadMessageCount/);
    expect(conversationThreadSource).toMatch(/refreshUnreadMessageCount\(\)/);
  });

  it("never introduces read-receipt/'Seen' UI as part of the recalculation", () => {
    for (const file of ["components/messaging/ConversationThread.tsx", "components/messaging/FloatingChatPanel.tsx"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/>Seen</);
      expect(source).not.toMatch(/"Seen"/);
    }
  });
});

describe("Notifications does not add a sixth bottom-nav item", () => {
  it("MobileBottomNav still has exactly 5 tabs, none of them Notifications", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    const tabCount = (source.match(/<li className="flex-1">/g) ?? []).length;
    expect(tabCount).toBe(5);
    expect(source).not.toMatch(/href="\/notifications"/);
  });
});

describe("header unread badges are seeded by root-level queries, then kept live by the shared Provider", () => {
  it("AppHeader never fetches notification data itself -- it doesn't even hold either count anymore, NotificationsProvider does", () => {
    const source = readFile("components/layout/AppHeader.tsx");
    expect(source).not.toMatch(/from ["']@\/lib\/notifications/);
    expect(source).not.toMatch(/from ["']@\/lib\/messaging/);
    expect(source).not.toMatch(/\.rpc\(/);
  });

  it("NotificationBellLink never fetches notification data itself -- unreadNotificationCount comes from the shared Provider's context, not a prop or an RPC", () => {
    const source = readFile("components/notifications/NotificationBellLink.tsx");
    expect(source).not.toMatch(/getMyNotification\(|\.rpc\(/);
    expect(source).toMatch(/useUnreadNotificationCount/);
    expect(source).not.toMatch(/type Props/);
  });

  it("root layout no longer calls getMyNotificationUnreadCount for either header badge -- it counts every type together, which is the exact bug being fixed", () => {
    const source = readFile("app/layout.tsx");
    // Matches an actual call/import, not this file's own header comment
    // explaining (by name) why that scalar is deliberately not used here.
    expect(source).not.toMatch(/getMyNotificationUnreadCount\(/);
    expect(source).not.toMatch(/from ["']@\/lib\/notifications\/get-my-notification-unread-count["']/);
  });

  it("root layout seeds initialUnreadMessageCount from the exact get_my_unread_conversation_count RPC (0088), and initialUnreadNotificationCount from the exact get_my_general_notification_unread_count RPC (0088) -- never the bounded first-page approach", () => {
    const source = readFile("app/layout.tsx");
    expect(source).toMatch(/getMyUnreadConversationCountServer\(/);
    expect(source).toMatch(/getMyGeneralNotificationUnreadCount\(/);
    expect(source).toMatch(/from ["']@\/lib\/messaging\/get-my-unread-conversation-count-server["']/);
    expect(source).toMatch(/from ["']@\/lib\/notifications\/get-my-general-notification-unread-count["']/);
    expect(source).not.toMatch(/getMyConversations\(/);
    expect(source).not.toMatch(/getMyNotifications\(/);
  });

  it("root layout calls the two exact-count functions unconditionally -- each self-guards on getAuthUser() internally, so no external guest ternary is needed", () => {
    const layoutSource = readFile("app/layout.tsx");
    expect(layoutSource).not.toMatch(/user \? getMyUnreadConversationCountServer/);
    expect(layoutSource).not.toMatch(/user \? getMyGeneralNotificationUnreadCount/);

    const serverCountSource = readFile("lib/messaging/get-my-unread-conversation-count-server.ts");
    expect(serverCountSource).toMatch(/if \(!user\) return 0;/);

    const generalCountSource = readFile("lib/notifications/get-my-general-notification-unread-count.ts");
    expect(generalCountSource).toMatch(/if \(!user\) return 0;/);
  });

  it("getMyNotificationUnreadCount itself is untouched and still exists as a valid utility, just unused by either header badge now", () => {
    const source = readFile("lib/notifications/get-my-notification-unread-count.ts");
    expect(source).toMatch(/export async function getMyNotificationUnreadCount/);
    expect(source).toMatch(/rpc\(\s*["']get_my_notification_unread_count["']\s*\)/);
  });
});

/**
 * P1 dismiss/clear-all (0091). Dismissal is soft (dismissed_at), never a
 * hard DELETE, and only ever touches public.notifications -- it must
 * never mark a conversation read or change any business record. Clear
 * All is explicitly allowed to dismiss new_message rows too (the locked
 * product decision correcting the original audit's suggestion), since
 * dismissal has zero relationship to conversation_user_states.
 */
describe("Notification dismiss / Clear All (0091) never touches business data or the Messages badge", () => {
  const migrationSource = readFile("supabase/migrations/0091_notification_dismiss.sql");

  /** Extracts just the plpgsql body ($$...$$) of one function definition,
   * with SQL line comments stripped -- so assertions about what the
   * function actually DOES aren't tripped up by prose in an adjacent
   * comment block that merely explains what it must never touch. */
  function extractFunctionBody(functionName: string): string {
    const startMarker = `create or replace function public.${functionName}(`;
    const startIndex = migrationSource.indexOf(startMarker);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const bodyStart = migrationSource.indexOf("as $$", startIndex);
    const bodyEnd = migrationSource.indexOf("$$;", bodyStart);
    const rawBody = migrationSource.slice(bodyStart, bodyEnd);
    return rawBody
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
  }

  it("adds a soft-dismiss column rather than any hard-delete path", () => {
    expect(migrationSource).toMatch(/add column dismissed_at timestamptz/i);
    expect(migrationSource).not.toMatch(/delete from public\.notifications/i);
  });

  it("dismiss_notification and dismiss_all_notifications only ever write notifications.dismissed_at -- never any other table", () => {
    for (const fn of ["dismiss_notification", "dismiss_all_notifications"]) {
      const body = extractFunctionBody(fn);
      expect(body).toMatch(/update public\.notifications/);
      expect(body).not.toMatch(/conversation_user_states|public\.conversations|public\.messages\b|public\.orders|public\.order_items|public\.listings|public\.reviews|public\.disputes/);
    }
  });

  it("dismiss_all_notifications does NOT filter out new_message -- Clear All dismisses every type, per the locked product decision", () => {
    const dismissAllBody = extractFunctionBody("dismiss_all_notifications");
    expect(dismissAllBody).not.toMatch(/type\s*<>\s*['"]new_message['"]/);
  });

  it("get_my_notifications and both unread-count RPCs exclude dismissed rows", () => {
    const listBody = extractFunctionBody("get_my_notifications");
    const generalCountBody = extractFunctionBody("get_my_general_notification_unread_count");
    const legacyCountBody = extractFunctionBody("get_my_notification_unread_count");

    expect(listBody).toMatch(/dismissed_at is null/);
    expect(generalCountBody).toMatch(/dismissed_at is null/);
    expect(legacyCountBody).toMatch(/dismissed_at is null/);
    // The Bell's own general count still excludes new_message (0088), unchanged.
    expect(generalCountBody).toMatch(/type\s*<>\s*['"]new_message['"]/);
  });

  it("both new RPCs are authenticated-only: SECURITY DEFINER, empty search_path, revoked from public/anon, granted only to authenticated", () => {
    for (const fn of ["dismiss_notification", "dismiss_all_notifications"]) {
      expect(migrationSource).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public;`));
      expect(migrationSource).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from anon;`));
      expect(migrationSource).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
    }
    expect(migrationSource).toMatch(/security definer/gi);
    expect(migrationSource.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("dismiss_notification scopes its update to the caller's own recipient_id -- cannot dismiss another user's notification", () => {
    const dismissOneBody = migrationSource.split("create or replace function public.dismiss_notification")[1]!;
    expect(dismissOneBody).toMatch(/recipient_id = v_caller/);
    expect(dismissOneBody).toMatch(/auth\.uid\(\)/);
  });

  it("does not modify any pre-0091 migration file", () => {
    // 0091 is additive-only; earlier migrations (including 0086's
    // intentional gap) are never touched by this feature.
    expect(migrationSource).not.toMatch(/drop function|drop table|alter table public\.notifications drop/i);
  });
});

describe("Dismiss count methods are distinct from mark-read methods (never overloaded)", () => {
  it("NotificationsProvider exposes dedicated dismiss-count methods, not a reuse of markOneRead/markAllRead", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/decrementGeneralUnreadByOne/);
    expect(source).toMatch(/restoreGeneralUnreadByOne/);
    expect(source).toMatch(/clearGeneralUnreadCount/);
    expect(source).toMatch(/useNotificationsDismiss/);
  });

  it("NotificationsListClient's dismiss/clear-all handlers call the dismiss-named methods, not markOneRead/markAllRead", () => {
    const source = readFile("components/notifications/NotificationsListClient.tsx");
    const dismissFn = source.split("async function handleDismiss")[1]!.split("async function handleConfirmClearAll")[0]!;
    const clearAllFn = source.split("async function handleConfirmClearAll")[1]!.split("function handleLoadMore")[0]!;

    expect(dismissFn).toMatch(/decrementGeneralUnreadByOne\(\)/);
    expect(dismissFn).toMatch(/restoreGeneralUnreadByOne\(\)/);
    expect(dismissFn).not.toMatch(/markOneRead\(\)|markAllRead\(\)/);

    expect(clearAllFn).toMatch(/clearGeneralUnreadCount\(\)/);
    expect(clearAllFn).not.toMatch(/markOneRead\(\)|markAllRead\(\)/);
  });
});
