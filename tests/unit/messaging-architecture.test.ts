import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("Real Messaging reads never trust client-supplied identity", () => {
  it("get-my-conversations.ts calls get_my_conversations with no user/participant id argument", () => {
    const source = readFile("lib/messaging/get-my-conversations.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_conversations["']/);
    expect(source).not.toMatch(/p_user_id|p_caller_id|p_initiator_id/);
  });

  it("get-conversation-context.ts calls get_conversation_context with only the conversation id", () => {
    const source = readFile("lib/messaging/get-conversation-context.ts");
    expect(source).toMatch(/rpc\(\s*["']get_conversation_context["']/);
    expect(source).not.toMatch(/p_user_id|p_caller_id|p_initiator_id/);
  });

  it("get-conversation-messages.ts calls get_conversation_messages with only conversation id + pagination args", () => {
    const source = readFile("lib/messaging/get-conversation-messages.ts");
    expect(source).toMatch(/rpc\(\s*["']get_conversation_messages["']/);
    expect(source).not.toMatch(/p_user_id|p_caller_id|p_sender_id/);
  });

  it("no messaging read module ever selects the conversations/messages tables directly", () => {
    for (const file of ["lib/messaging/get-my-conversations.ts", "lib/messaging/get-conversation-context.ts", "lib/messaging/get-conversation-messages.ts"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.from\(\s*["']conversations["']\s*\)/);
      expect(source).not.toMatch(/\.from\(\s*["']messages["']\s*\)/);
    }
  });
});

describe("Real Messaging writes never trust client-supplied identity", () => {
  it("start-conversation.ts and send-message.ts never send a shop-owner/initiator/sender id -- only shop/listing/conversation ids and message text", () => {
    for (const file of ["lib/messaging/start-conversation.ts", "lib/messaging/send-message.ts"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/p_sender_id|p_initiator_id|p_caller_id|p_user_id/);
    }
  });

  it("conversation-state.ts performs direct table UPDATEs (per the backend's own locked no-toggle-RPC design), never inventing a new RPC, and never filters by an explicit user id (RLS scopes it)", () => {
    const source = readFile("lib/messaging/conversation-state.ts");
    expect(source).toMatch(/\.from\(\s*["']conversation_user_states["']\s*\)/);
    expect(source).not.toMatch(/rpc\(/);
    expect(source).not.toMatch(/\.eq\(\s*["']user_id["']/);
  });
});

describe("no service-role bypass anywhere in the Real Messaging module", () => {
  it("no messaging file references a service-role key", () => {
    const files = [
      "lib/messaging/get-my-conversations.ts",
      "lib/messaging/get-conversation-context.ts",
      "lib/messaging/get-conversation-messages.ts",
      "lib/messaging/start-conversation.ts",
      "lib/messaging/send-message.ts",
      "lib/messaging/conversation-state.ts",
      "lib/messaging/detect-link.ts",
      "components/messaging/ConversationsListClient.tsx",
      "components/messaging/ConversationDetailClient.tsx",
      "components/messaging/ComposeMessageDialog.tsx",
      "components/shop/ShopMessageAction.tsx",
      "components/listing/ListingActions.tsx",
      "app/messages/page.tsx",
      "app/messages/[conversationId]/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Real Messaging does not build out-of-scope modules", () => {
  it("does not reference notification-center, review-feature, or disputes-UI concepts", () => {
    const files = [
      "components/messaging/ConversationsListClient.tsx",
      "components/messaging/ConversationDetailClient.tsx",
      "app/messages/page.tsx",
      "app/messages/[conversationId]/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/leave a review|star rating|review_id|reviews table/i);
      expect(source).not.toMatch(/dispute_status|open a dispute|disputes table/i);
      expect(source).not.toMatch(/notification_center|notifications table|push notification/i);
    }
  });
});

/**
 * Realtime slice 2 (per the accepted audit + 0087's publication change):
 * public.messages is now in the supabase_realtime publication, and
 * ConversationDetailClient is the one, deliberately narrow place that
 * subscribes to it -- filtered to the currently open conversation_id only,
 * never a broad/unfiltered subscription. public.conversations remains
 * OUTSIDE the publication (0087 only added messages + notifications), so
 * no file in this module may subscribe to it; conversation-list liveness
 * is instead derived from the shared notifications channel (see
 * notifications-architecture.test.ts), never a second websocket here.
 */
describe("Real Messaging Realtime is scoped to the open thread only, filtered per-conversation", () => {
  it("ConversationDetailClient subscribes to postgres_changes INSERT on messages, filtered to this conversation only", () => {
    const source = readFile("components/messaging/ConversationDetailClient.tsx");
    expect(source).toMatch(/\.channel\(/);
    expect(source).toMatch(/postgres_changes/);
    expect(source).toMatch(/event:\s*["']INSERT["']/);
    expect(source).toMatch(/table:\s*["']messages["']/);
    expect(source).toMatch(/filter:\s*`conversation_id=eq\.\$\{/);
  });

  it("ConversationDetailClient cleanly unsubscribes (removeChannel) rather than leaking a channel per conversation", () => {
    const source = readFile("components/messaging/ConversationDetailClient.tsx");
    expect(source).toMatch(/removeChannel/);
  });

  it("ConversationDetailClient's message dedupe uses a stable message_id-based helper, not a timing assumption", () => {
    const source = readFile("components/messaging/ConversationDetailClient.tsx");
    expect(source).toMatch(/appendMessageIfNew/);
  });

  it("no messaging file ever subscribes to public.conversations directly -- 0087 deliberately excluded it", () => {
    const files = [
      "components/messaging/ConversationDetailClient.tsx",
      "components/messaging/ConversationsListClient.tsx",
      "lib/messaging/get-my-conversations.ts",
      "lib/messaging/get-conversation-context.ts",
      "lib/messaging/get-conversation-messages.ts",
      "lib/messaging/start-conversation.ts",
      "lib/messaging/send-message.ts",
      "lib/messaging/conversation-state.ts",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/table:\s*["']conversations["']/);
    }
  });

  it("no messaging module besides ConversationDetailClient opens its own Realtime channel", () => {
    const files = [
      "lib/messaging/get-my-conversations.ts",
      "lib/messaging/get-conversation-context.ts",
      "lib/messaging/get-conversation-messages.ts",
      "lib/messaging/start-conversation.ts",
      "lib/messaging/send-message.ts",
      "lib/messaging/conversation-state.ts",
      "components/messaging/ConversationsListClient.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.channel\(|\.subscribe\(|supabase\.realtime/i);
    }
  });

  it("ConversationsListClient reacts to the shared notifications signal instead of subscribing itself -- no polling/setInterval added either", () => {
    const source = readFile("components/messaging/ConversationsListClient.tsx");
    expect(source).toMatch(/useLatestNotificationEvent/);
    expect(source).not.toMatch(/\.channel\(/);
    expect(source).not.toMatch(/setInterval/);
  });
});

describe("Real Messaging migration is scoped to exactly three new read RPCs", () => {
  it("0046_messaging_read_rpcs adds get_my_conversations, get_conversation_context, get_conversation_messages only", () => {
    const source = readFile("supabase/migrations/0046_messaging_read_rpcs.sql");
    expect(source).toMatch(/create or replace function public\.get_my_conversations/i);
    expect(source).toMatch(/create or replace function public\.get_conversation_context/i);
    expect(source).toMatch(/create or replace function public\.get_conversation_messages/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    // No existing write/lifecycle RPC is touched by this migration.
    expect(source).not.toMatch(/create or replace function public\.start_conversation/i);
    expect(source).not.toMatch(/create or replace function public\.send_message/i);
  });

  it("all three new RPCs are granted to authenticated only, never anon", () => {
    const source = readFile("supabase/migrations/0046_messaging_read_rpcs.sql");
    for (const fn of ["get_my_conversations", "get_conversation_context", "get_conversation_messages"]) {
      expect(source).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from anon`, "i"));
      expect(source).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`, "i"));
    }
  });
});

describe("Real Messaging navigation matches the locked design", () => {
  it("Messages is not added as a sixth bottom-nav tab -- the canonical 5 tabs stay, now wired for real", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    const tabCount = (source.match(/<li className="flex-1">/g) ?? []).length;
    expect(tabCount).toBe(5);
    expect(source).toMatch(/href="\/messages"/);
    expect(source).not.toMatch(/href="#"/);
  });

  it("desktop header Messages icon points to /messages, no longer a placeholder", () => {
    const source = readFile("components/layout/AppHeader.tsx");
    expect(source).toMatch(/IconButton href="\/messages" label="Messages"/);
  });
});
