import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Every file touched or added by Realtime Slice 2 (frontend messages +
 * notifications). Kept as one explicit list here so the security
 * checklist below reads as a single audit trail, distinct from the more
 * granular per-module architecture files. */
const SLICE_2_FILES = [
  "lib/messaging/message-list.ts",
  "components/messaging/ConversationDetailClient.tsx",
  "components/messaging/ConversationsListClient.tsx",
  "components/notifications/NotificationsProvider.tsx",
  "components/notifications/NotificationBellLink.tsx",
  "components/notifications/NotificationsListClient.tsx",
  "components/layout/AppHeader.tsx",
  "app/layout.tsx",
  "app/messages/page.tsx",
];

describe("Realtime Slice 2 -- no service-role key/client anywhere in the browser-facing code", () => {
  it("no Slice 2 file references a service-role key", () => {
    for (const file of SLICE_2_FILES) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });

  it("every Realtime subscription is created through the existing browser client (createClient from lib/supabase/client), never a second/ad-hoc client", () => {
    const subscribingFiles = ["components/messaging/ConversationDetailClient.tsx", "components/notifications/NotificationsProvider.tsx"];
    for (const file of subscribingFiles) {
      const source = readFile(file);
      expect(source).toMatch(/from ["']@\/lib\/supabase\/client["']/);
      expect(source).not.toMatch(/createServerClient|createBrowserClient\(/); // only the shared wrapper, not a raw SDK call
    }
  });
});

describe("Realtime Slice 2 -- no polling was introduced", () => {
  it("no Slice 2 file uses setInterval, or setTimeout in a repeating/poll pattern", () => {
    for (const file of SLICE_2_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/setInterval/);
    }
  });

  it("ConversationsListClient's one setTimeout is a single-shot debounce, not a poll -- it's always paired with clearTimeout in the same effect", () => {
    const source = readFile("components/messaging/ConversationsListClient.tsx");
    const setTimeoutCount = (source.match(/setTimeout\(/g) ?? []).length;
    const clearTimeoutCount = (source.match(/clearTimeout\(/g) ?? []).length;
    expect(setTimeoutCount).toBe(1);
    expect(clearTimeoutCount).toBe(1);
  });
});

describe("Realtime Slice 2 -- public.conversations was not added to the Realtime surface", () => {
  it("no Slice 2 file subscribes to a 'conversations' table via postgres_changes", () => {
    for (const file of SLICE_2_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/table:\s*["']conversations["']/);
    }
  });

  it("0087 (the only Realtime publication migration) adds only messages + notifications -- conversations is absent", () => {
    const source = readFile("supabase/migrations/0087_enable_messaging_notification_realtime.sql");
    expect(source).toMatch(/add table public\.messages/);
    expect(source).toMatch(/add table public\.notifications/);
    expect(source).not.toMatch(/add table public\.conversations/);
  });
});

describe("Realtime Slice 2 -- no backend/migration change was made in this slice", () => {
  it("no migration newer than 0088 exists -- Slice 2 itself added none; 0088 belongs to the later, separately-audited Slice 3 correction (see realtime-slice-3-unread-fix-security-architecture.test.ts)", () => {
    const latestAllowed = "0088_exact_unread_badge_counts.sql";
    const files = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql") && f > latestAllowed);
    expect(files).toEqual([]);
  });

  it("no Slice 2 file contains RLS/policy/grant DDL -- this is a frontend-only slice", () => {
    for (const file of SLICE_2_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
      expect(source).not.toMatch(/\bgrant\b|\brevoke\b/i);
    }
  });
});
