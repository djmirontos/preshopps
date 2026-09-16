import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, act, screen, fireEvent, waitFor } from "@testing-library/react";
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

const {
  channelOnCalls,
  channelNameCalls,
  createdChannels,
  getSessionMock,
  rpcMock,
  sendMessageMock,
  markConversationReadMock,
  markConversationReadIfUnreadMock,
  onIncomingMessageMock,
  refreshUnreadMessageCountMock,
} = vi.hoisted(() => {
    return {
      channelOnCalls: [] as Array<{ topic: string; config: { table: string; filter: string }; callback: (payload: { new: unknown }) => void }>,
      channelNameCalls: [] as string[],
      createdChannels: [] as Array<{
        topic: string;
        subscribed: boolean;
        statusCallback: ((status: string, err?: { message: string }) => void) | null;
        on: ReturnType<typeof vi.fn>;
        subscribe: ReturnType<typeof vi.fn>;
      }>,
      getSessionMock: vi.fn(),
      rpcMock: vi.fn(),
      sendMessageMock: vi.fn(),
      markConversationReadMock: vi.fn(),
      markConversationReadIfUnreadMock: vi.fn(),
      onIncomingMessageMock: vi.fn(),
      refreshUnreadMessageCountMock: vi.fn(),
    };
  });

// Simulates RealtimeClient's own internal "topic -> channel" registry --
// a channel stays in here until its (async) removal actually resolves,
// exactly matching the real reuse-by-topic behavior this fix defends
// against.
const registry = new Map<string, ReturnType<typeof makeFakeChannel>>();
const pendingRemovals: Array<() => void> = [];

type FakeChannelStatusCallback = (status: string, err?: { message: string }) => void;

function makeFakeChannel(topic: string) {
  const fakeChannel = {
    topic,
    subscribed: false,
    statusCallback: null as FakeChannelStatusCallback | null,
    on: vi.fn((_event: string, config: { table: string; filter: string }, callback: (payload: { new: unknown }) => void) => {
      // Mirrors realtime-js's own real guard in RealtimeChannel.on():
      // `if (this.channelAdapter.isJoined() || this.channelAdapter.isJoining()) throw ...`
      if (fakeChannel.subscribed) {
        throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`);
      }
      channelOnCalls.push({ topic, config, callback });
      return fakeChannel;
    }),
    // Mirrors realtime-js's real .subscribe(statusCallback) signature --
    // captures whatever callback ConversationThread passes so tests can
    // simulate a later CHANNEL_ERROR/TIMED_OUT the same way the real
    // client would invoke it, without this fake auto-firing anything
    // beyond the initial SUBSCRIBED join.
    subscribe: vi.fn((statusCallback?: FakeChannelStatusCallback) => {
      fakeChannel.subscribed = true;
      fakeChannel.statusCallback = statusCallback ?? null;
      statusCallback?.("SUBSCRIBED");
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

// Only overrides the one hook ConversationThread reads -- everything else
// (the Provider component itself, its other hooks) is untouched. This lets
// the back-to-back-events tests below observe refreshUnreadMessageCount's
// own call count directly, without needing a real NotificationsProvider
// ancestor or a live get_my_unread_conversation_count RPC round trip.
vi.mock("@/components/notifications/NotificationsProvider", async () => {
  const actual = await vi.importActual<typeof import("@/components/notifications/NotificationsProvider")>(
    "@/components/notifications/NotificationsProvider",
  );
  return { ...actual, useRefreshUnreadMessageCount: () => refreshUnreadMessageCountMock };
});

import { ConversationDetailClient } from "@/components/messaging/ConversationDetailClient";
import { ConversationThread } from "@/components/messaging/ConversationThread";

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

/** Renders ConversationThread directly (not through ConversationDetailClient,
 * which never forwards onIncomingMessage to any of its callers today) so
 * the back-to-back-events tests below can observe onIncomingMessage's own
 * call count -- the exact "wasNew-dependent side effect" the timing
 * concern is about, alongside markConversationRead/refreshUnreadMessageCount. */
function renderThread(overrides: Partial<ComponentProps<typeof ConversationThread>> = {}) {
  return render(
    <ConversationThread
      context={sampleContext()}
      initialMessages={[sampleMessage({ messageId: "m1", body: "First message" })]}
      initialCursor={null}
      loadEarlier={loadEarlierMock}
      otherPartyId="other-user-1"
      initialIsBlocked={false}
      onIncomingMessage={onIncomingMessageMock}
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

/**
 * Status visibility (small diagnostic/reliability slice, no behavior
 * change): ConversationThread's own .subscribe() now passes a status
 * callback, mirroring NotificationsProvider's exact existing pattern
 * (same two statuses logged, same generic err?.message ?? status
 * shape). This is observability only -- no resubscribe, no timer, no
 * refetch is introduced; realtime-js's own internal rejoin handling is
 * untouched.
 */
describe("ConversationThread Realtime -- subscribe status visibility", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("1. passes a status callback function to subscribe()", () => {
    renderConversation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    expect(typeof channel.subscribe.mock.calls[0][0]).toBe("function");
  });

  it("2. SUBSCRIBED does not emit an error", () => {
    renderConversation();
    expect(consoleErrorSpy).not.toHaveBeenCalledWith("Realtime message subscription failed:", expect.anything());
  });

  it("3. CHANNEL_ERROR emits a safe console error, with no message body/user id/conversation id in the logged text", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });

    expect(consoleErrorSpy).toHaveBeenCalledWith("Realtime message subscription failed:", "boom");
    const loggedText = consoleErrorSpy.mock.calls.map((call: unknown[]) => call.join(" ")).join(" ");
    expect(loggedText).not.toMatch(/conv-1|other-user-1|Hi there|First message/);
  });

  it("4. TIMED_OUT emits a safe console error", () => {
    renderConversation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("TIMED_OUT");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Realtime message subscription failed:", "TIMED_OUT");
  });

  it("CLOSED does not emit an error -- a normal unmount/conversationId-change cleanup is not an application failure", () => {
    renderConversation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("CLOSED");

    expect(consoleErrorSpy).not.toHaveBeenCalledWith("Realtime message subscription failed:", expect.anything());
  });

  it("9. no reconnect/resubscribe/refetch is triggered by a status callback -- CHANNEL_ERROR only logs, it never calls .channel()/.subscribe() again or loadEarlier", () => {
    renderConversation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    const channelCallsBefore = channelNameCalls.length;
    const subscribeCallsBefore = channel.subscribe.mock.calls.length;

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });

    expect(channelNameCalls).toHaveLength(channelCallsBefore);
    expect(channel.subscribe.mock.calls).toHaveLength(subscribeCallsBefore);
    expect(loadEarlierMock).not.toHaveBeenCalled();
  });
});

/**
 * Fix-proving tests for the `wasNew` timing bug the P1 messaging Realtime
 * reliability audit identified and a prior reproduction test confirmed:
 *
 *   let wasNew = false;
 *   setMessages((prev) => { ...; wasNew = next !== prev; return next; });
 *   if (wasNew) { ... }
 *
 * That pattern assumed the setMessages updater always runs synchronously
 * before the very next line -- true only for the FIRST update pending for
 * a hook since its last render. A second incoming postgres_changes INSERT
 * event processed before any render flushes (proven reproducible: fired
 * synchronously back-to-back inside one act(), exactly as below) found
 * this hook already had a pending update, so its own updater ran only
 * later, during the real render -- leaving that second event's own
 * `wasNew` still false at the moment its `if (wasNew && ...)` check ran,
 * even though the message was correctly appended once React actually
 * rendered. The fix (ConversationThread.tsx's own seenMessageIdsRef)
 * decides "is this a new message id" synchronously, before setMessages is
 * ever called, and keeps that decision (and the ref itself) fully
 * independent of when any updater actually executes.
 *
 * Both events in each test below are still fired as two synchronous
 * statements inside a single act() call, with no `await` and no separate
 * act() boundary between them -- this must keep proving the fix under the
 * exact same no-render-flush-between-them condition that reproduced the
 * original bug, not a weakened, sequential version of it.
 */
describe("ConversationThread Realtime -- back-to-back incoming events (wasNew timing bug, fixed)", () => {
  it("1/2/3/4. two distinct incoming messages fired synchronously within the same act(): both render once, and BOTH now trigger onIncomingMessage/markConversationRead/refreshUnreadMessageCount", async () => {
    renderThread();
    const registration = channelOnCalls[channelOnCalls.length - 1];

    // This component's own separate mount-time mark-read-on-open effect
    // already calls markConversationReadIfUnread(...).then(() =>
    // refreshUnreadMessageCount()) once, independently of any incoming
    // message -- let that unrelated promise chain fully settle first, so
    // the baseline captured below (and the delta asserted afterward) only
    // reflects what the two incoming events themselves caused.
    await act(() => Promise.resolve());
    const refreshCountBefore = refreshUnreadMessageCountMock.mock.calls.length;

    act(() => {
      registration.callback({
        new: { id: "msg-a", conversation_id: "conv-1", sender_id: "other-user-1", body: "First incoming", created_at: "2026-02-01T12:00:00.000Z" },
      });
      registration.callback({
        new: { id: "msg-b", conversation_id: "conv-1", sender_id: "other-user-1", body: "Second incoming", created_at: "2026-02-01T12:00:01.000Z" },
      });
    });

    // 1. Both messages must render exactly once each.
    expect(screen.getAllByText("First incoming")).toHaveLength(1);
    expect(screen.getAllByText("Second incoming")).toHaveLength(1);

    // 2/3. Fixed behavior: BOTH distinct events now trigger their own
    // side effects -- this is the exact regression the previous
    // reproduction test proved was broken (it observed 1, not 2, before
    // this fix).
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(2);
    expect(markConversationReadMock).toHaveBeenCalledTimes(2);
    expect(markConversationReadMock).toHaveBeenNthCalledWith(1, "conv-1");
    expect(markConversationReadMock).toHaveBeenNthCalledWith(2, "conv-1");

    // 4. refreshUnreadMessageCount is chained via .then() off each
    // markConversationRead call's own promise -- flush that microtask
    // queue before reading its call count.
    await act(() => Promise.resolve());
    expect(refreshUnreadMessageCountMock.mock.calls.length - refreshCountBefore).toBe(2);
  });

  it("5/6. duplicate event: the SAME message id fired twice back-to-back within the same act() still dedupes correctly -- one rendered message, side effects run exactly once", () => {
    renderThread();
    const registration = channelOnCalls[channelOnCalls.length - 1];
    const row = { id: "msg-dup", conversation_id: "conv-1", sender_id: "other-user-1", body: "Duplicate incoming", created_at: "2026-02-01T12:00:00.000Z" };

    act(() => {
      registration.callback({ new: row });
      registration.callback({ new: row });
    });

    expect(screen.getAllByText("Duplicate incoming")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
  });

  it("7. a message id already present in the thread's initial messages produces no duplicate render and no side effects when Realtime later replays it", () => {
    // seenMessageIdsRef is seeded from initialMessages at mount -- this
    // proves that seed actually works, not just the ref's own in-callback
    // add() calls.
    renderThread({ initialMessages: [sampleMessage({ messageId: "msg-already-loaded", body: "Already loaded", isMine: false })] });
    const registration = channelOnCalls[channelOnCalls.length - 1];

    act(() => {
      registration.callback({
        new: { id: "msg-already-loaded", conversation_id: "conv-1", sender_id: "other-user-1", body: "Already loaded", created_at: "2026-02-01T09:00:00.000Z" },
      });
    });

    expect(screen.getAllByText("Already loaded")).toHaveLength(1);
    expect(onIncomingMessageMock).not.toHaveBeenCalled();
    expect(markConversationReadMock).not.toHaveBeenCalled();
  });

  it("9a. own-message race: a Realtime echo arriving BEFORE the send RPC resolves still renders exactly once, and the RPC's own later append is a no-op via appendMessageIfNew", async () => {
    let resolveSend: (value: { ok: true; messageId: string; createdAt: string }) => void = () => {};
    sendMessageMock.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    renderThread();
    const registration = channelOnCalls[channelOnCalls.length - 1];

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "My own message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());

    // The Realtime echo of this same send lands before the RPC's own HTTP
    // response does. isMine is derived from sender_id !== otherPartyId, so
    // this is indistinguishable from a genuine echo of the viewer's own
    // just-sent message.
    act(() => {
      registration.callback({
        new: { id: "msg-own-race-a", conversation_id: "conv-1", sender_id: "viewer-own-id", body: "My own message", created_at: "2026-02-01T12:00:00.000Z" },
      });
    });
    expect(screen.getAllByText("My own message", { selector: "p" })).toHaveLength(1);
    // isMine messages never drive onIncomingMessage/markConversationRead,
    // echo or not.
    expect(onIncomingMessageMock).not.toHaveBeenCalled();
    expect(markConversationReadMock).not.toHaveBeenCalled();

    resolveSend({ ok: true, messageId: "msg-own-race-a", createdAt: "2026-02-01T12:00:00.000Z" });
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
    expect(screen.getAllByText("My own message", { selector: "p" })).toHaveLength(1);
  });

  it("9b. own-message race: the send RPC resolving BEFORE the Realtime echo arrives still renders exactly once", async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: "msg-own-race-b", createdAt: "2026-02-01T12:00:00.000Z" });
    renderThread();
    const registration = channelOnCalls[channelOnCalls.length - 1];

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "My other own message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getAllByText("My other own message", { selector: "p" })).toHaveLength(1));

    act(() => {
      registration.callback({
        new: { id: "msg-own-race-b", conversation_id: "conv-1", sender_id: "viewer-own-id", body: "My other own message", created_at: "2026-02-01T12:00:00.000Z" },
      });
    });

    expect(screen.getAllByText("My other own message", { selector: "p" })).toHaveLength(1);
    expect(onIncomingMessageMock).not.toHaveBeenCalled();
    expect(markConversationReadMock).not.toHaveBeenCalled();
  });
});
