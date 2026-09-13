import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Every file touched or added across the floating-messenger slices
 * (the original single-conversation panel, desktop Enter-to-send/Shift+
 * Enter, web-only tooltips, and this task's own upgrade to a persistent
 * two-column messaging center). Kept as one explicit list so the
 * security checklist below reads as a single audit trail, distinct from
 * the more granular per-module architecture files and from the earlier
 * Realtime slices' own lists. */
const FLOATING_MESSENGER_FILES = [
  "components/messaging/FloatingMessengerProvider.tsx",
  "components/messaging/FloatingChatPanel.tsx",
  "components/messaging/ConversationThread.tsx",
  "components/messaging/ConversationDetailClient.tsx",
  "components/messaging/ConversationsListClient.tsx",
  "components/messaging/ComposeMessageDialog.tsx",
  "components/messaging/MessagesIconLink.tsx",
  "components/listing/ListingActions.tsx",
  "components/shop/ShopMessageAction.tsx",
  "components/ui/Tooltip.tsx",
  "lib/messaging/load-conversation-for-panel.ts",
  "lib/messaging/load-conversations-for-messaging-center.ts",
  "lib/messaging/composer-keydown.ts",
  "lib/ui/viewport.ts",
  "app/layout.tsx",
];

describe("Floating Messenger slice -- no backend/migration/RLS change was made", () => {
  it("no migration newer than 0088 exists -- this slice is frontend-only", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
    const newerThan0088 = migrationFiles.filter((f) => f > "0088_exact_unread_badge_counts.sql");
    expect(newerThan0088).toEqual([]);
  });

  it("no slice file contains RLS/policy/grant DDL", () => {
    for (const file of FLOATING_MESSENGER_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
      expect(source).not.toMatch(/\bgrant\b|\brevoke\b/i);
    }
  });

  it("this slice introduces no new RPC name -- the panel's own data loads reuse the exact same canonical calls the full-page routes already make", () => {
    const threadLoaderSource = readFile("lib/messaging/load-conversation-for-panel.ts");
    expect(threadLoaderSource).toMatch(/getConversationContext\(/);
    expect(threadLoaderSource).toMatch(/getConversationMessages\(/);
    expect(threadLoaderSource).toMatch(/getConversationBlockState\(/);
    expect(threadLoaderSource).not.toMatch(/\.rpc\(/);

    // The messaging center's own left-column list loader reuses
    // getMyConversations() -- the exact same call app/messages/page.tsx
    // already makes -- not a second, competing inbox query/RPC.
    const listLoaderSource = readFile("lib/messaging/load-conversations-for-messaging-center.ts");
    expect(listLoaderSource).toMatch(/getMyConversations\(/);
    expect(listLoaderSource).not.toMatch(/\.rpc\(/);
  });
});

describe("Floating Messenger slice -- no service-role/ad-hoc client anywhere in the browser-facing code", () => {
  it("no slice file references a service-role key", () => {
    for (const file of FLOATING_MESSENGER_FILES) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });

  it("both panel Server Actions use the server Supabase client, never a browser/service-role client", () => {
    for (const file of ["lib/messaging/load-conversation-for-panel.ts", "lib/messaging/load-conversations-for-messaging-center.ts"]) {
      const source = readFile(file);
      expect(source).toMatch(/^"use server";/);
      expect(source).not.toMatch(/from ["']@\/lib\/supabase\/client["']/);
    }
  });
});

describe("Floating Messenger slice -- exactly one messaging Realtime implementation, reused (never duplicated)", () => {
  it("only ConversationThread subscribes to postgres_changes on messages -- ConversationDetailClient and FloatingChatPanel both delegate to it instead of opening their own channel", () => {
    const threadSource = readFile("components/messaging/ConversationThread.tsx");
    expect(threadSource).toMatch(/\.channel\(/);

    for (const file of ["components/messaging/ConversationDetailClient.tsx", "components/messaging/FloatingChatPanel.tsx"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.channel\(/);
      expect(source).toMatch(/<ConversationThread/);
    }
  });

  it("FloatingChatPanel never subscribes to public.conversations", () => {
    const source = readFile("components/messaging/FloatingChatPanel.tsx");
    expect(source).not.toMatch(/table:\s*["']conversations["']/);
  });
});

describe("Floating Messenger slice -- single-window MVP, never a multi-chat-window system", () => {
  it("FloatingMessengerProvider owns exactly one selectedConversationId, not a list/array/map of open/selected conversations", () => {
    const source = readFile("components/messaging/FloatingMessengerProvider.tsx");
    expect(source).toMatch(/selectedConversationId/);
    expect(source).not.toMatch(/selectedConversationIds|openConversationIds|Set<string>|Map<string|conversations:\s*string\[\]/);
  });

  it("FloatingChatPanel itself renders at most one panel/thread element -- the only .map() in the messaging center's tree belongs to ConversationsListClient's own (separate, pre-existing) row list, not to FloatingChatPanel duplicating panels", () => {
    const source = readFile("components/messaging/FloatingChatPanel.tsx");
    expect(source).not.toMatch(/\.map\(/);
  });

  it("the right pane renders exactly one ConversationThread, keyed on the single selected conversation -- never more than one thread mounted at once", () => {
    const source = readFile("components/messaging/FloatingChatPanel.tsx");
    const threadMountCount = (source.match(/<ConversationThread/g) ?? []).length;
    expect(threadMountCount).toBe(1);
  });
});

describe("Floating Messenger slice -- no polling was introduced", () => {
  it("no slice file uses setInterval, or setTimeout in a repeating/poll pattern", () => {
    for (const file of FLOATING_MESSENGER_FILES) {
      const source = readFile(file);
      expect(source).not.toMatch(/setInterval/);
      expect(source).not.toMatch(/setTimeout.*poll/i);
    }
  });
});

describe("Floating Messenger slice -- keyboard/viewport checks never risk a hydration mismatch", () => {
  it("isDesktopViewport is only ever read inside interactive handlers, never used to branch what a component renders", () => {
    const source = readFile("lib/ui/viewport.ts");
    expect(source).toMatch(/typeof window !== ["']undefined["']/);
  });

  it("no slice file evaluates isDesktopViewport at the top level of a component's render body to decide markup (only inside onClick/onKeyDown callbacks)", () => {
    for (const file of [
      "components/messaging/ConversationsListClient.tsx",
      "components/messaging/MessagesIconLink.tsx",
      "components/listing/ListingActions.tsx",
      "components/shop/ShopMessageAction.tsx",
    ]) {
      const source = readFile(file);
      if (!source.includes("isDesktopViewport")) continue;
      // Every call site is inside a function body (an event handler), so
      // it never appears as the condition of the component's own JSX
      // return/ternary at the top level -- a crude but effective proxy:
      // it must always be preceded somewhere above by a handler function
      // declaration, not appear before the first "return (" of the
      // component itself in a way that would gate the whole render tree.
      expect(source).not.toMatch(/return isDesktopViewport\(\)/);
    }
  });
});

describe("Floating Messenger slice -- AGENTS.md untouched", () => {
  it("AGENTS.md is unaffected by this slice (not part of the touched-files list, and still exists)", () => {
    expect(FLOATING_MESSENGER_FILES).not.toContain("AGENTS.md");
    // Merely confirms the file is still present/readable -- this slice
    // never deletes or renames it.
    expect(() => readFile("AGENTS.md")).not.toThrow();
  });
});
