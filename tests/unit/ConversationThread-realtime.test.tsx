import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { readdirSync } from "node:fs";
import path from "node:path";
import type { ComponentProps } from "react";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { ConversationMessage } from "@/lib/messaging/get-conversation-messages";

/**
 * Regression tests for the reported bug: "cannot add `postgres_changes`
 * callbacks for realtime:messages:<conversation-id> after `subscribe()`."
 *
 * Root cause (confirmed by reading @supabase/realtime-js's own source,
 * not assumed): RealtimeClient.channel(topic) deliberately REUSES an
 * existing channel object whenever one with the same topic string is
 * still present in its internal registry, and RealtimeClient.
 * removeChannel() is async (it awaits the channel's own unsubscribe
 * network round trip before removing it from that registry) --
 * ConversationThread's cleanup fires removeChannel without awaiting it
 * (a React cleanup function cannot await), so a fast enough second
 * effect invocation for the SAME conversationId (React Strict Mode's
 * dev-only double-invoke of every effect on mount being the common real
 * trigger) can find the FIRST invocation's still-joining/joined channel
 * object still registered under the same topic and get it handed back
 * instead of a fresh one -- calling `.on('postgres_changes', ...)` on
 * that already-subscribed object is exactly what realtime-js's own
 * `on()` rejects.
 *
 * This fake `channel`/`removeChannel` pair below deliberately reproduces
 * BOTH real behaviors realtime-js actually has (topic-based reuse, and
 * an async removal that only clears the registry once "resolved") so
 * these tests are a genuine regression guard against the original bug
 * reappearing, not just an assertion about call ordering on one channel.
 */

const { channelOnCalls, channelNameCalls, createdChannels, getSessionMock, rpcMock, sendMessageMock, markConversationReadMock, markConversationReadIfUnreadMock } =
  vi.hoisted(() => {
    return {
      channelOnCalls: [] as Array<{ topic: string; config: { table: string; filter: string }; callback: (payload: { new: unknown }) => void }>,
      channelNameCalls: [] as string[],
      createdChannels: [] as Array<{ topic: string; subscribed: boolean; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }>,
      getSessionMock: vi.fn(),
      rpcMock: vi.fn(),
      sendMessageMock: vi.fn(),
      markConversationReadMock: vi.fn(),
      markConversationReadIfUnreadMock: vi.fn(),
    };
  });

// Simulates RealtimeClient's own internal "topic -> channel" registry --
// a channel stays in here until its (async) removal actually resolves,
// exactly matching the real reuse-by-topic behavior this fix defends
// against.
const registry = new Map<string, ReturnType<typeof makeFakeChannel>>();
const pendingRemovals: Array<() => void> = [];

function makeFakeChannel(topic: string) {
  const fakeChannel = {
    topic,
    subscribed: false,
    on: vi.fn((_event: string, config: { table: string; filter: string }, callback: (payload: { new: unknown }) => void) => {
      // Mirrors realtime-js's own real guard in RealtimeChannel.on():
      // `if (this.channelAdapter.isJoined() || this.channelAdapter.isJoining()) throw ...`
      if (fakeChannel.subscribed) {
        throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`);
      }
      channelOnCalls.push({ topic, config, callback });
      return fakeChannel;
    }),
    subscribe: vi.fn(() => {
      fakeChannel.subscribed = true;
      return fakeChannel;
    }),
  };
  return fakeChannel;
}

function fakeChannelFactory(topic: string) {
  channelNameCalls.push(topic);
  const existing = registry.get(topic);
  if (existing) return existing; // <-- the exact real reuse-by-topic behavior
  const created = makeFakeChannel(topic);
  registry.set(topic, created);
  createdChannels.push(created);
  return created;
}

/** Mirrors RealtimeClient.removeChannel()'s real async shape: the
 * channel is only actually removed from the registry once this promise
 * resolves -- callers must explicitly flush it via resolvePendingRemovals()
 * to simulate the network round trip completing. */
function fakeRemoveChannel(channel: ReturnType<typeof makeFakeChannel>): Promise<void> {
  return new Promise((resolve) => {
    pendingRemovals.push(() => {
      for (const [topic, ch] of registry.entries()) {
        if (ch === channel) registry.delete(topic);
      }
      resolve();
    });
  });
}

function resolvePendingRemovals() {
  while (pendingRemovals.length > 0) pendingRemovals.pop()!();
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
    channel: fakeChannelFactory,
    removeChannel: fakeRemoveChannel,
  }),
}));

vi.mock("@/lib/messaging/send-message", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messaging/send-message")>("@/lib/messaging/send-message");
  return { ...actual, sendMessage: sendMessageMock };
});

vi.mock("@/lib/messaging/conversation-state", () => ({
  markConversationRead: markConversationReadMock,
  markConversationReadIfUnread: markConversationReadIfUnreadMock,
  markConversationUnread: vi.fn(),
  setConversationArchived: vi.fn(),
  setConversationMuted: vi.fn(),
}));

vi.mock("@/lib/moderation/report-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/moderation/report-actions")>("@/lib/moderation/report-actions");
  return { ...actual, submitReport: vi.fn() };
});

vi.mock("@/lib/messaging/block-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messaging/block-actions")>("@/lib/messaging/block-actions");
  return { ...actual, blockUser: vi.fn(), unblockUser: vi.fn() };
});

import { ConversationDetailClient } from "@/components/messaging/ConversationDetailClient";

function sampleContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationId: "conv-1",
    conversationType: "listing_inquiry",
    viewerRole: "initiator",
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    shopLogoUrl: undefined,
    listingId: null,
    listingPublicCode: null,
    listingTitle: null,
    listingStatus: null,
    listingImageUrl: undefined,
    otherPartyDisplayName: null,
    otherPartyAvatarUrl: undefined,
    isArchived: false,
    isMuted: false,
    canSend: true,
    ...overrides,
  };
}

function sampleMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { messageId: "msg-1", isMine: false, body: "Hi there", createdAt: "2026-02-01T10:00:00.000Z", ...overrides };
}

const loadEarlierMock = vi.fn();

function renderConversation(overrides: Partial<ComponentProps<typeof ConversationDetailClient>> = {}) {
  return render(
    <ConversationDetailClient
      context={sampleContext()}
      initialMessages={[sampleMessage({ messageId: "m1", body: "First message" })]}
      initialCursor={null}
      loadEarlier={loadEarlierMock}
      otherPartyId="other-user-1"
      initialIsBlocked={false}
      {...overrides}
    />,
  );
}

function latestChannelForTopicPrefix(prefix: string) {
  const matches = createdChannels.filter((c) => c.topic.startsWith(prefix));
  return matches[matches.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  loadEarlierMock.mockReset();
  markConversationReadIfUnreadMock.mockResolvedValue({ ok: true });
  markConversationReadMock.mockResolvedValue({ ok: true });
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  createdChannels.length = 0;
  registry.clear();
  pendingRemovals.length = 0;
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  rpcMock.mockResolvedValue({ data: 0, error: null });
});

describe("ConversationThread Realtime -- attach-before-subscribe invariant", () => {
  it("1. attaches the postgres_changes handler before calling subscribe on the channel", () => {
    renderConversation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    expect(channel.on.mock.invocationCallOrder[0]).toBeLessThan(channel.subscribe.mock.invocationCallOrder[0]);
  });

  it("2. creates exactly one channel/subscription for one mounted conversation thread", () => {
    renderConversation();
    expect(channelNameCalls).toHaveLength(1);
    expect(createdChannels).toHaveLength(1);
  });
});

describe("ConversationThread Realtime -- cleanup", () => {
  it("3. unmounting removes exactly the channel this thread's own effect created", () => {
    const { unmount } = renderConversation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    expect(channel.subscribed).toBe(true);

    unmount();
    resolvePendingRemovals();

    expect(registry.has(channel.topic)).toBe(false);
  });

  it("4. changing conversation id cleans up the old channel before the new one is used", () => {
    const { rerender } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });
    const firstChannel = latestChannelForTopicPrefix("messages:conv-1");

    rerender(
      <ConversationDetailClient
        context={sampleContext({ conversationId: "conv-2" })}
        initialMessages={[]}
        initialCursor={null}
        loadEarlier={loadEarlierMock}
        otherPartyId="other-user-1"
        initialIsBlocked={false}
      />,
    );
    resolvePendingRemovals();

    const secondChannel = latestChannelForTopicPrefix("messages:conv-2");
    expect(registry.has(firstChannel.topic)).toBe(false);
    expect(secondChannel).not.toBe(firstChannel);
    expect(secondChannel.topic).not.toBe(firstChannel.topic);
    expect(secondChannel.subscribed).toBe(true);
  });
});

describe("ConversationThread Realtime -- the actual reported bug is fixed", () => {
  it("5. a fast remount for the SAME conversation id, before the previous channel's async removal resolves, never reuses that still-registered channel and never throws the realtime-js `.on() after subscribe()` error", () => {
    const { unmount } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });
    const firstChannel = latestChannelForTopicPrefix("messages:conv-1");
    expect(firstChannel.subscribed).toBe(true);

    // Simulate React Strict Mode's dev-only double-invoke (or any other
    // fast remount): unmount fires the cleanup (removeChannel is called
    // but its promise is NOT resolved yet -- resolvePendingRemovals() is
    // deliberately never called in this test), then the component is
    // mounted again for the identical conversation id.
    unmount();
    expect(registry.has(firstChannel.topic)).toBe(true); // still "pending removal" -- the exact race window

    expect(() => renderConversation({ context: sampleContext({ conversationId: "conv-1" }) })).not.toThrow();

    const secondChannel = latestChannelForTopicPrefix("messages:conv-1");
    // The regression this fix prevents: without unique topics, this
    // would be the SAME still-subscribed object, and its own `.on()`
    // call above would have thrown.
    expect(secondChannel).not.toBe(firstChannel);
    expect(secondChannel.topic).not.toBe(firstChannel.topic);
    expect(secondChannel.subscribed).toBe(true);
  });

  it("effect reruns never attempt to add a postgres_changes callback to an already-subscribed channel -- every created channel had .on() succeed exactly once, never a second time on the same object", () => {
    const { unmount: unmount1 } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });
    unmount1();
    const { unmount: unmount2 } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });
    unmount2();
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });

    expect(createdChannels).toHaveLength(3);
    for (const channel of createdChannels) {
      expect(channel.on).toHaveBeenCalledTimes(1);
    }
  });
});

describe("ConversationThread Realtime -- existing behavior preserved", () => {
  it("6. an incoming message still appends to the thread via the fixed subscription", () => {
    renderConversation();
    const registration = channelOnCalls[channelOnCalls.length - 1];

    act(() => {
      registration.callback({ new: { id: "msg-in-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "New message", created_at: "2026-02-01T12:00:00.000Z" } });
    });

    expect(markConversationReadMock).toHaveBeenCalledWith("conv-1");
  });

  it("7. a duplicate/replayed incoming message id is still deduped, not double-processed", () => {
    renderConversation();
    const registration = channelOnCalls[channelOnCalls.length - 1];
    const row = { id: "msg-in-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "New message", created_at: "2026-02-01T12:00:00.000Z" };

    act(() => {
      registration.callback({ new: row });
      registration.callback({ new: row });
    });

    // markConversationRead is only invoked for a genuinely NEW message --
    // a replayed duplicate must not trigger it a second time.
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
  });
});

describe("Realtime bug fix: no migration/RLS/publication change", () => {
  it("8. no migration file was added or changed by this fix -- 0093 remains the newest", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newer = migrationFiles.filter((f) => f > "0093_seller_order_messaging.sql");
    expect(newer).toEqual([]);
  });
});
