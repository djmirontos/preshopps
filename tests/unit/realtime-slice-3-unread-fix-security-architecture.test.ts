import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips // line comments and /* block comments *\/ so a static
 * assertion about actual code can't false-positive on a comment's prose
 * merely discussing (by name) the pattern being asserted against. Not a
 * full parser -- adequate for this repo's TS/TSX source, which never puts
 * `//` or `/*` inside a string this suite inspects. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every file touched or added by this slice (session-race fix for
 * notifications Realtime + split message/notification unread counts,
 * plus this follow-up correction: authoritative-refresh message-badge
 * semantics and the two exact scalar RPCs added by migration 0088).
 * Kept as one explicit list here so the security checklist below reads
 * as a single audit trail, distinct from the more granular per-module
 * architecture files and from Slice 2's own equivalent list. */
const SLICE_3_FILES = [
  "components/notifications/NotificationsProvider.tsx",
  "components/notifications/NotificationBellLink.tsx",
  "components/messaging/MessagesIconLink.tsx",
  "components/messaging/ConversationDetailClient.tsx",
  "components/layout/AppHeader.tsx",
  "components/layout/MobileBottomNav.tsx",
  "lib/messaging/get-my-unread-conversation-count.ts",
  "lib/messaging/get-my-unread-conversation-count-server.ts",
  "lib/notifications/get-my-general-notification-unread-count.ts",
  "app/layout.tsx",
];

describe("Realtime Slice 3 -- no service-role key/client anywhere in the browser-facing code", () => {
  it("no Slice 3 file references a service-role key", () => {
    for (const file of SLICE_3_FILES) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });

  it("the new client-safe unread-conversation-count helper reuses the existing browser client, never a raw/second SDK client", () => {
    const source = readFile("lib/messaging/get-my-unread-conversation-count.ts");
    expect(source).toMatch(/from ["']@\/lib\/supabase\/client["']/);
    expect(source).not.toMatch(/createServerClient|createBrowserClient\(/);
  });
});

describe("Realtime Slice 3 -- no polling was introduced", () => {
  it("no Slice 3 file uses setInterval, or setTimeout in a repeating/poll pattern", () => {
    for (const file of SLICE_3_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/setInterval/);
      expect(source).not.toMatch(/setTimeout.*poll/i);
    }
  });
});

describe("Realtime Slice 3 -- public.conversations was not added to the Realtime surface", () => {
  it("no Slice 3 file subscribes to a 'conversations' table via postgres_changes", () => {
    for (const file of SLICE_3_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/table:\s*["']conversations["']/);
    }
  });

  it("the unread-conversation-count helpers read the exact get_my_unread_conversation_count scalar RPC (0088) via a plain RPC call, never a direct Realtime subscription", () => {
    for (const file of ["lib/messaging/get-my-unread-conversation-count.ts", "lib/messaging/get-my-unread-conversation-count-server.ts"]) {
      const source = readFile(file);
      expect(source).toMatch(/\.rpc\(\s*["']get_my_unread_conversation_count["']\s*\)/);
      expect(source).not.toMatch(/\.channel\(/);
    }
  });
});

describe("Realtime Slice 3 -- guests never create a notifications subscription", () => {
  it("NotificationsProvider's subscription effect still guards on isAuthenticated && userId before doing anything else", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    expect(source).toMatch(/if \(!isAuthenticated \|\| !userId\) return;/);
  });

  it("root layout's exact-count seed functions each guard on getAuthUser() internally, avoiding a doomed-to-fail authenticated RPC call for a guest", () => {
    const serverCountSource = readFile("lib/messaging/get-my-unread-conversation-count-server.ts");
    expect(serverCountSource).toMatch(/if \(!user\) return 0;/);

    const generalCountSource = readFile("lib/notifications/get-my-general-notification-unread-count.ts");
    expect(generalCountSource).toMatch(/if \(!user\) return 0;/);
  });
});

describe("Realtime Slice 3 -- the only backend change is migration 0088's two additive, read-only scalar RPCs", () => {
  it("no migration newer than 0088 exists, and 0086 was never backfilled", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
    const newerThan0088 = migrationFiles.filter((f) => f > "0088_exact_unread_badge_counts.sql");
    expect(newerThan0088).toEqual([]);
    expect(migrationFiles).toContain("0088_exact_unread_badge_counts.sql");
  });

  it("0088 adds exactly the two expected functions and touches no existing table, RLS policy, or publication", () => {
    const source = readFile("supabase/migrations/0088_exact_unread_badge_counts.sql");
    expect(source).toMatch(/create or replace function public\.get_my_unread_conversation_count\(\)/);
    expect(source).toMatch(/create or replace function public\.get_my_general_notification_unread_count\(\)/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/alter publication/i);
    expect(source).not.toMatch(/insert into|update\s+public\.|delete from/i);
  });

  it("both 0088 functions are SECURITY DEFINER with a fixed empty search_path and require auth.uid()", () => {
    const source = readFile("supabase/migrations/0088_exact_unread_badge_counts.sql");
    const definerCount = (source.match(/^security definer$/gim) ?? []).length;
    expect(definerCount).toBe(2);
    const searchPathCount = (source.match(/set search_path = ''/g) ?? []).length;
    expect(searchPathCount).toBe(2);
    const authUidCount = (source.match(/auth\.uid\(\)/g) ?? []).length;
    expect(authUidCount).toBeGreaterThanOrEqual(2);
  });

  it("both 0088 functions grant execute to authenticated only -- no anon/public access", () => {
    const source = readFile("supabase/migrations/0088_exact_unread_badge_counts.sql");
    expect(source).toMatch(/revoke all on function public\.get_my_unread_conversation_count\(\) from public/);
    expect(source).toMatch(/revoke all on function public\.get_my_unread_conversation_count\(\) from anon/);
    expect(source).toMatch(/grant execute on function public\.get_my_unread_conversation_count\(\) to authenticated/);
    expect(source).toMatch(/revoke all on function public\.get_my_general_notification_unread_count\(\) from public/);
    expect(source).toMatch(/revoke all on function public\.get_my_general_notification_unread_count\(\) from anon/);
    expect(source).toMatch(/grant execute on function public\.get_my_general_notification_unread_count\(\) to authenticated/);
  });

  it("the general-notification RPC excludes new_message from its count", () => {
    const source = readFile("supabase/migrations/0088_exact_unread_badge_counts.sql");
    const fnMatch = source.match(/create or replace function public\.get_my_general_notification_unread_count\(\)[\s\S]*?\$\$;/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/n\.type <> ['"]new_message['"]/);
  });

  it("no Slice 3 frontend file contains RLS/policy/grant DDL -- that lives only in migration 0088", () => {
    for (const file of SLICE_3_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
      expect(source).not.toMatch(/\bgrant\b|\brevoke\b/i);
    }
  });

  it("this correction deliberately introduces exactly two new RPC names (get_my_unread_conversation_count, get_my_general_notification_unread_count), each used only by its own dedicated wrapper", () => {
    const clientHelper = readFile("lib/messaging/get-my-unread-conversation-count.ts");
    const serverHelper = readFile("lib/messaging/get-my-unread-conversation-count-server.ts");
    expect(clientHelper).toMatch(/rpc\(\s*["']get_my_unread_conversation_count["']\s*\)/);
    expect(serverHelper).toMatch(/rpc\(\s*["']get_my_unread_conversation_count["']\s*\)/);

    const generalNotificationHelper = readFile("lib/notifications/get-my-general-notification-unread-count.ts");
    expect(generalNotificationHelper).toMatch(/rpc\(\s*["']get_my_general_notification_unread_count["']\s*\)/);

    // The old bounded-approximation RPC call (get_my_conversations, for
    // header-badge seeding) is gone from these specific files -- replaced,
    // not layered on top of. A code comment may still mention it by name
    // for context, so check for an actual .rpc(...) call, not any mention.
    expect(stripComments(clientHelper)).not.toMatch(/\.rpc\(\s*["']get_my_conversations["']/);
    expect(stripComments(serverHelper)).not.toMatch(/\.rpc\(\s*["']get_my_conversations["']/);
  });
});

describe("Realtime Slice 3 -- session-race fix is present exactly where the bug was", () => {
  it("NotificationsProvider awaits getSession() before ever creating the channel", () => {
    const source = readFile("components/notifications/NotificationsProvider.tsx");
    const sessionAwaitIndex = source.indexOf("await supabase.auth.getSession()");
    const channelCreateIndex = source.indexOf(".channel(`notifications:");
    expect(sessionAwaitIndex).toBeGreaterThan(-1);
    expect(channelCreateIndex).toBeGreaterThan(sessionAwaitIndex);
  });

  it("ConversationDetailClient's own (separately confirmed working) message subscription is deliberately left untouched by this fix -- no actual await getSession() call in its code, only a comment explaining why one wasn't added", () => {
    const source = readFile("components/messaging/ConversationDetailClient.tsx");
    const codeOnly = stripComments(source);
    expect(codeOnly).not.toMatch(/await supabase\.auth\.getSession\(\)/);
    // The decision itself is documented in-code, per Part 4's "report what
    // you decided" instruction -- confirm the explanation exists rather
    // than merely tolerating its side effect on the check above.
    expect(source).toMatch(/Deliberately does NOT await supabase\.auth\.getSession\(\)/);
  });
});
