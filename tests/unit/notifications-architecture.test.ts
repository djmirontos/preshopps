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
  it("does not build push notifications, email delivery, or Realtime subscriptions", () => {
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

describe("Notifications does not add a sixth bottom-nav item", () => {
  it("MobileBottomNav still has exactly 5 tabs, none of them Notifications", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    const tabCount = (source.match(/<li className="flex-1">/g) ?? []).length;
    expect(tabCount).toBe(5);
    expect(source).not.toMatch(/href="\/notifications"/);
  });
});

describe("header unread badge is a single root-level query, not a per-page/per-row fetch", () => {
  it("AppHeader never fetches notification data itself -- unreadNotificationCount is a plain prop, not imported/called here", () => {
    const source = readFile("components/layout/AppHeader.tsx");
    expect(source).not.toMatch(/from ["']@\/lib\/notifications/);
    expect(source).not.toMatch(/getMyNotificationUnreadCount\(/);
    expect(source).not.toMatch(/\.rpc\(/);
  });

  it("NotificationBellLink never fetches notification data itself -- unreadCount is a plain prop", () => {
    const source = readFile("components/notifications/NotificationBellLink.tsx");
    expect(source).not.toMatch(/get_my_notification|getMyNotification|rpc\(/);
  });

  it("the root layout fetches the unread count exactly once, alongside the other existing root-level queries", () => {
    const source = readFile("app/layout.tsx");
    expect(source).toMatch(/getMyNotificationUnreadCount/);
    // Exactly one call site (inside the shared Promise.all), not a second
    // ad-hoc fetch elsewhere in the same file.
    const callSites = source.match(/getMyNotificationUnreadCount\(\)/g) ?? [];
    expect(callSites.length).toBe(1);
  });
});
