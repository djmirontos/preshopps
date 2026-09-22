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

const RECONCILE_RPC = "get_conversation_messages";

function rpcRow(overrides: Partial<{ message_id: string; is_mine: boolean; body: string; created_at: string }> = {}) {
  return { message_id: "m", is_mine: false, body: "body", created_at: "2026-02-01T12:00:00.000Z", ...overrides };
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Renders the thread and lets its automatic first-SUBSCRIBED
 * reconciliation (this task's own fix for the initial-load ->
 * first-subscribe gap -- see the dedicated describe block below for its
 * own tests) fully settle first, as a neutral empty no-op, then clears
 * rpcMock's own call history. Every pre-existing reconnect-cycle test in
 * this file was written and reviewed before that fix existed, asserting
 * reconciliation call counts relative to ITS OWN simulated reconnect --
 * this keeps every one of those assertions valid unchanged, rather than
 * needing every single one hand-adjusted for a +1 baseline call every
 * mount now also produces. The dedicated first-subscribe-reconciliation
 * tests further down deliberately do NOT use this helper -- they need to
 * observe that exact baseline call directly.
 */
async function renderThreadAndSettleInitialReconciliation(overrides: Partial<ComponentProps<typeof ConversationThread>> = {}) {
  rpcMock.mockResolvedValue({ data: [], error: null });
  const result = renderThread(overrides);
  await act(() => flushAsync());
  rpcMock.mockClear();
  return result;
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
  // A valid, empty, harmless default for get_conversation_messages -- every
  // mount now also fires one first-subscribe reconciliation fetch (this
  // task's own fix), so this must resolve to a real no-op shape, not the
  // previous placeholder `data: 0` (a shape getLatestConversationMessages
  // itself would reject as invalid, logging a needless error on every
  // single test in this file that doesn't otherwise care about it).
  rpcMock.mockResolvedValue({ data: [], error: null });
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
  it("8. no migration file was added or changed by this fix -- only separately-approved 0094 follows 0093", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newer = migrationFiles.filter((f) => f > "0093_seller_order_messaging.sql");
    expect(newer).toEqual([
      "0094_published_listing_editing.sql",
      "0095_restriction_visibility_notifications.sql",
      "0096_restriction_visibility_notifications.sql",
      "0097_fix_apply_user_restriction_output_collision.sql",
      "0098_fix_submit_report_output_collision.sql",
      "0099_schedule_pending_order_expiry.sql",
      "0100_allow_incomplete_fair_condition_draft.sql",
      "0101_auto_assign_brand_new_condition.sql",
    ]);
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

/**
 * Reconnect reconciliation (P1, client-only per the locked MVP decision):
 * realtime-js's own automatic rejoin does not replay postgres_changes
 * events missed while a channel was disconnected, so a genuine reconnect
 * (SUBSCRIBED -> CHANNEL_ERROR/TIMED_OUT -> SUBSCRIBED, confirmed via
 * @supabase/phoenix's own source to reuse the same channel/joinPush and
 * re-invoke this exact status callback) triggers a single fetch of the
 * current newest page (getLatestConversationMessages, this task's own new
 * client-side wrapper) and merges anything missing via the same
 * seenMessageIdsRef + appendMessageIfNew mechanism already proven for the
 * live path. rpcMock (this file's existing fake Supabase client mock) is
 * what backs getLatestConversationMessages's own supabase.rpc() call --
 * no separate module mock needed.
 *
 * Every test below uses renderThreadAndSettleInitialReconciliation (not
 * plain renderThread) so its own assertions are unaffected by the FIRST
 * SUBSCRIBED also now reconciling (P1-1 fix, see the dedicated describe
 * block further down for those tests) -- the helper lets that baseline
 * call settle as a harmless no-op and clears its call history first.
 */
describe("ConversationThread Realtime -- reconnect reconciliation", () => {
  it("2. SUBSCRIBED -> CHANNEL_ERROR -> SUBSCRIBED triggers exactly one reconciliation fetch", async () => {
    await renderThreadAndSettleInitialReconciliation();
    rpcMock.mockResolvedValue({ data: [], error: null });
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    channel.statusCallback?.("SUBSCRIBED");
    await act(() => Promise.resolve());

    expect(rpcMock).toHaveBeenCalledWith(RECONCILE_RPC, expect.objectContaining({ p_conversation_id: "conv-1" }));
    expect(rpcMock.mock.calls.filter((call) => call[0] === RECONCILE_RPC)).toHaveLength(1);
  });

  it("3. SUBSCRIBED -> TIMED_OUT -> SUBSCRIBED also triggers reconciliation", async () => {
    await renderThreadAndSettleInitialReconciliation();
    rpcMock.mockResolvedValue({ data: [], error: null });
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("TIMED_OUT");
    channel.statusCallback?.("SUBSCRIBED");
    await act(() => Promise.resolve());

    expect(rpcMock.mock.calls.filter((call) => call[0] === RECONCILE_RPC)).toHaveLength(1);
  });

  it("CLOSED during normal cleanup never triggers reconciliation", async () => {
    await renderThreadAndSettleInitialReconciliation();
    rpcMock.mockResolvedValue({ data: [], error: null });
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("CLOSED");
    channel.statusCallback?.("SUBSCRIBED");
    await act(() => Promise.resolve());

    expect(rpcMock.mock.calls.filter((call) => call[0] === RECONCILE_RPC)).toHaveLength(0);
  });

  it("4. one missed message appears after reconnect", async () => {
    await renderThreadAndSettleInitialReconciliation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    rpcMock.mockResolvedValue({
      data: [rpcRow({ message_id: "missed-1", body: "Missed while offline", created_at: "2026-02-01T13:00:00.000Z" })],
      error: null,
    });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    expect(screen.getAllByText("Missed while offline")).toHaveLength(1);
  });

  it("5. multiple missed messages render in chronological order", async () => {
    await renderThreadAndSettleInitialReconciliation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    rpcMock.mockResolvedValue({
      data: [
        rpcRow({ message_id: "missed-b", body: "Second missed", created_at: "2026-02-01T13:01:00.000Z" }),
        rpcRow({ message_id: "missed-a", body: "First missed", created_at: "2026-02-01T13:00:00.000Z" }),
      ],
      error: null,
    });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    const firstIndex = items.findIndex((text) => text?.includes("First missed"));
    const secondIndex = items.findIndex((text) => text?.includes("Second missed"));
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("6. a message id already known locally is not duplicated when reconciliation also returns it", async () => {
    await renderThreadAndSettleInitialReconciliation({ initialMessages: [sampleMessage({ messageId: "already-known", body: "Already known" })] });
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    rpcMock.mockResolvedValue({
      data: [
        rpcRow({ message_id: "already-known", body: "Already known", created_at: "2026-02-01T10:00:00.000Z" }),
        rpcRow({ message_id: "genuinely-new", body: "Genuinely new", created_at: "2026-02-01T13:00:00.000Z" }),
      ],
      error: null,
    });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    expect(screen.getAllByText("Already known")).toHaveLength(1);
    expect(screen.getAllByText("Genuinely new")).toHaveLength(1);
  });

  it("7/8. previously loaded older messages and earlierCursor both remain intact after reconciliation", async () => {
    loadEarlierMock.mockResolvedValue({
      messages: [sampleMessage({ messageId: "older-1", body: "An older message" })],
      hadError: false,
      nextCursor: null,
    });
    await renderThreadAndSettleInitialReconciliation({ initialCursor: { createdAt: "2026-02-01T09:00:00.000Z", id: "cursor-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(screen.getAllByText("An older message")).toHaveLength(1));
    expect(loadEarlierMock).toHaveBeenCalledWith("conv-1", { createdAt: "2026-02-01T09:00:00.000Z", id: "cursor-1" });

    const channel = latestChannelForTopicPrefix("messages:conv-1");
    rpcMock.mockResolvedValue({
      data: [rpcRow({ message_id: "missed-1", body: "Missed while offline", created_at: "2026-02-01T13:00:00.000Z" })],
      error: null,
    });
    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    // Older loaded message survives, the new message appended, and
    // "Load earlier" (now cursor-exhausted from the mocked response
    // above) is gone for the correct reason -- nextCursor: null -- not
    // because reconciliation reset or corrupted it.
    expect(screen.getAllByText("An older message")).toHaveLength(1);
    expect(screen.getAllByText("Missed while offline")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();
  });

  it("9. a live Realtime INSERT for a message that reconciliation's own (slower) fetch later also returns is not duplicated", async () => {
    await renderThreadAndSettleInitialReconciliation();
    let resolveRpc: (value: { data: unknown; error: null }) => void = () => {};
    rpcMock.mockImplementation((name: string) => {
      if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
      return new Promise((resolve) => {
        resolveRpc = resolve;
      });
    });
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    const registration = channelOnCalls[channelOnCalls.length - 1];

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    channel.statusCallback?.("SUBSCRIBED"); // reconciliation fetch now in flight, unresolved

    // The live channel keeps receiving events during the outage window too
    // (this is the SAME channel/binding, never torn down) -- a live INSERT
    // for the message the slow fetch will also eventually return.
    act(() => {
      registration.callback({
        new: { id: "race-msg", conversation_id: "conv-1", sender_id: "other-user-1", body: "Race message", created_at: "2026-02-01T13:00:00.000Z" },
      });
    });
    expect(screen.getAllByText("Race message")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRpc({ data: [rpcRow({ message_id: "race-msg", body: "Race message", created_at: "2026-02-01T13:00:00.000Z" })], error: null });
      await Promise.resolve();
    });

    expect(screen.getAllByText("Race message")).toHaveLength(1);
    // No second onIncomingMessage/markConversationRead for the same id via
    // the reconciliation batch -- seenMessageIdsRef already had it.
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
  });

  it("10. a delayed live Realtime replay AFTER reconciliation already merged the same message is deduped", async () => {
    await renderThreadAndSettleInitialReconciliation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    const registration = channelOnCalls[channelOnCalls.length - 1];
    rpcMock.mockResolvedValue({
      data: [rpcRow({ message_id: "reconciled-msg", body: "Reconciled message", created_at: "2026-02-01T13:00:00.000Z" })],
      error: null,
    });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });
    expect(screen.getAllByText("Reconciled message")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);

    // The same message replayed live afterward (e.g. a stray re-delivery).
    act(() => {
      registration.callback({
        new: { id: "reconciled-msg", conversation_id: "conv-1", sender_id: "other-user-1", body: "Reconciled message", created_at: "2026-02-01T13:00:00.000Z" },
      });
    });

    expect(screen.getAllByText("Reconciled message")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
  });

  it("11. a visible thread reconciling multiple missed incoming messages fires onIncomingMessage/markConversationRead/refreshUnreadMessageCount exactly once each, not once per message", async () => {
    await renderThreadAndSettleInitialReconciliation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    await act(() => Promise.resolve());
    const refreshCountBefore = refreshUnreadMessageCountMock.mock.calls.length;

    rpcMock.mockResolvedValue({
      data: [
        rpcRow({ message_id: "batch-1", body: "Batch message 1", created_at: "2026-02-01T13:00:00.000Z" }),
        rpcRow({ message_id: "batch-2", body: "Batch message 2", created_at: "2026-02-01T13:01:00.000Z" }),
        rpcRow({ message_id: "batch-3", body: "Batch message 3", created_at: "2026-02-01T13:02:00.000Z" }),
      ],
      error: null,
    });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledWith("conv-1");
    await act(() => Promise.resolve());
    expect(refreshUnreadMessageCountMock.mock.calls.length - refreshCountBefore).toBe(1);
  });

  it("12. a minimized thread reconciling missed messages fires onIncomingMessage once but never markConversationRead", async () => {
    await renderThreadAndSettleInitialReconciliation({ isMinimized: true });
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    rpcMock.mockResolvedValue({
      data: [
        rpcRow({ message_id: "min-1", body: "Minimized batch 1", created_at: "2026-02-01T13:00:00.000Z" }),
        rpcRow({ message_id: "min-2", body: "Minimized batch 2", created_at: "2026-02-01T13:01:00.000Z" }),
      ],
      error: null,
    });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).not.toHaveBeenCalled();
  });

  it("13. a reconciliation batch containing only the viewer's own messages triggers no onIncomingMessage/markConversationRead", async () => {
    await renderThreadAndSettleInitialReconciliation();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    rpcMock.mockResolvedValue({
      data: [rpcRow({ message_id: "own-1", is_mine: true, body: "My own missed message", created_at: "2026-02-01T13:00:00.000Z" })],
      error: null,
    });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    expect(screen.getAllByText("My own missed message")).toHaveLength(1);
    expect(onIncomingMessageMock).not.toHaveBeenCalled();
    expect(markConversationReadMock).not.toHaveBeenCalled();
  });

  describe("scroll behavior after reconciliation", () => {
    /** Same stubbing convention as ConversationThread-scroll.test.tsx --
     * jsdom never computes real layout, so scrollHeight/clientHeight are
     * fixed here to give every test a known "content taller than the
     * visible area" shape, making scrollTop assertions meaningful. */
    const STUBBED_SCROLL_HEIGHT = 1000;
    const STUBBED_CLIENT_HEIGHT = 400;
    const NEAR_BOTTOM_SCROLL_TOP = 550; // 1000-550-400=50, near bottom
    const SCROLLED_UP_SCROLL_TOP = 50; // 1000-50-400=550, not near bottom

    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: STUBBED_SCROLL_HEIGHT });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: STUBBED_CLIENT_HEIGHT });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    });

    it("14. a near-bottom thread follows to the latest reconciled message", async () => {
      await renderThreadAndSettleInitialReconciliation();
      const container = screen.getByTestId("messages-scroll-container");
      container.scrollTop = NEAR_BOTTOM_SCROLL_TOP;
      fireEvent.scroll(container);

      const channel = latestChannelForTopicPrefix("messages:conv-1");
      rpcMock.mockResolvedValue({
        data: [rpcRow({ message_id: "scroll-missed", body: "Scroll missed", created_at: "2026-02-01T13:00:00.000Z" })],
        error: null,
      });
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      await act(async () => {
        channel.statusCallback?.("SUBSCRIBED");
        await Promise.resolve();
      });

      expect(container.scrollTop).toBe(STUBBED_SCROLL_HEIGHT);
    });

    it("15. a scrolled-up thread is not forced back to the bottom by reconciliation", async () => {
      await renderThreadAndSettleInitialReconciliation();
      const container = screen.getByTestId("messages-scroll-container");
      container.scrollTop = SCROLLED_UP_SCROLL_TOP;
      fireEvent.scroll(container);

      const channel = latestChannelForTopicPrefix("messages:conv-1");
      rpcMock.mockResolvedValue({
        data: [rpcRow({ message_id: "scroll-missed-2", body: "Scroll missed 2", created_at: "2026-02-01T13:00:00.000Z" })],
        error: null,
      });
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      await act(async () => {
        channel.statusCallback?.("SUBSCRIBED");
        await Promise.resolve();
      });

      expect(container.scrollTop).toBe(SCROLLED_UP_SCROLL_TOP);
    });
  });

  it("16. a reconciliation fetch failure preserves existing messages, logs safely, and shows no user-facing backend error", async () => {
    await renderThreadAndSettleInitialReconciliation({ initialMessages: [sampleMessage({ messageId: "m1", body: "First message" })] });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });

    expect(screen.getAllByText("First message")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/raw backend detail/);
    consoleErrorSpy.mockRestore();
  });

  it("17. an overlapping reconnect while a reconciliation fetch is still in flight does not launch a second fetch", async () => {
    await renderThreadAndSettleInitialReconciliation();
    let resolveRpc: (value: { data: unknown; error: null }) => void = () => {};
    rpcMock.mockImplementation((name: string) => {
      if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
      return new Promise((resolve) => {
        resolveRpc = resolve;
      });
    });
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    channel.statusCallback?.("SUBSCRIBED"); // fetch #1 now in flight, unresolved
    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
    channel.statusCallback?.("SUBSCRIBED"); // must not launch a second overlapping fetch

    expect(rpcMock.mock.calls.filter((call) => call[0] === RECONCILE_RPC)).toHaveLength(1);

    await act(async () => {
      resolveRpc({ data: [], error: null });
      await Promise.resolve();
    });
  });

  it("18. a later reconnect after the previous reconciliation has fully completed runs again", async () => {
    await renderThreadAndSettleInitialReconciliation();
    rpcMock.mockResolvedValue({ data: [], error: null });
    const channel = latestChannelForTopicPrefix("messages:conv-1");

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });
    expect(rpcMock.mock.calls.filter((call) => call[0] === RECONCILE_RPC)).toHaveLength(1);

    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });
    expect(rpcMock.mock.calls.filter((call) => call[0] === RECONCILE_RPC)).toHaveLength(2);
  });

  it("20. no migration file was added or changed by this feature -- only separately-approved 0094 follows 0093", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newer = migrationFiles.filter((f) => f > "0093_seller_order_messaging.sql");
    expect(newer).toEqual([
      "0094_published_listing_editing.sql",
      "0095_restriction_visibility_notifications.sql",
      "0096_restriction_visibility_notifications.sql",
      "0097_fix_apply_user_restriction_output_collision.sql",
      "0098_fix_submit_report_output_collision.sql",
      "0099_schedule_pending_order_expiry.sql",
      "0100_allow_incomplete_fair_condition_draft.sql",
      "0101_auto_assign_brand_new_condition.sql",
    ]);
  });

  /**
   * Coalescing fix for the race a plain in-flight guard alone leaves open:
   * reconnect #1 starts fetch A; the channel drops and rejoins AGAIN while
   * A is still running; without remembering that second request, any
   * message that arrived only during the second outage (i.e. after A had
   * already read the DB) could stay missing until some later reconnect or
   * a full reload. ConversationThread's own reconciliationPending closure
   * flag (set whenever a reconnect wants to reconcile while a fetch is
   * already in flight, consulted once in that fetch's own `finally` block)
   * fixes this by running exactly one additional fetch afterward.
   */
  describe("reconnect reconciliation -- queued/coalesced follow-up fetch", () => {
    it("1/2/3/4/5. a second reconnect while fetch A is pending starts no concurrent fetch, is retained, and runs as fetch B once A settles -- a message that exists only in fetch B renders", async () => {
      await renderThreadAndSettleInitialReconciliation();
      let resolveFetchA: (value: { data: unknown; error: null }) => void = () => {};
      let reconcileCallCount = 0;
      rpcMock.mockImplementation((name: string) => {
        if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return new Promise((resolve) => {
            resolveFetchA = resolve;
          });
        }
        return Promise.resolve({
          data: [rpcRow({ message_id: "only-in-fetch-b", body: "Only in fetch B", created_at: "2026-02-01T14:00:00.000Z" })],
          error: null,
        });
      });
      const channel = latestChannelForTopicPrefix("messages:conv-1");

      // 1. Reconnect #1 starts fetch A.
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      channel.statusCallback?.("SUBSCRIBED");
      expect(reconcileCallCount).toBe(1);

      // 2/3. Reconnect #2 while A is still pending -- no concurrent
      // second fetch; the request is retained instead of dropped.
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
      channel.statusCallback?.("SUBSCRIBED");
      expect(reconcileCallCount).toBe(1);

      // 4/5. A settles -- fetch B now starts automatically, and its own
      // message (never part of A's result) renders.
      await act(async () => {
        resolveFetchA({ data: [], error: null });
        await flushAsync();
      });

      expect(reconcileCallCount).toBe(2);
      expect(screen.getAllByText("Only in fetch B")).toHaveLength(1);
    });

    it("6. the queued follow-up fetch B still runs even when fetch A fails", async () => {
      await renderThreadAndSettleInitialReconciliation();
      let resolveFetchA: (value: { data: unknown; error: { message: string } | null }) => void = () => {};
      let reconcileCallCount = 0;
      rpcMock.mockImplementation((name: string) => {
        if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return new Promise((resolve) => {
            resolveFetchA = resolve;
          });
        }
        return Promise.resolve({
          data: [rpcRow({ message_id: "after-failed-a", body: "Arrived after A failed", created_at: "2026-02-01T14:00:00.000Z" })],
          error: null,
        });
      });
      const channel = latestChannelForTopicPrefix("messages:conv-1");

      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      channel.statusCallback?.("SUBSCRIBED"); // fetch A starts
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
      channel.statusCallback?.("SUBSCRIBED"); // queued while A pending
      expect(reconcileCallCount).toBe(1);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => {
        resolveFetchA({ data: null, error: { message: "boom" } }); // A fails
        await flushAsync();
      });
      consoleErrorSpy.mockRestore();

      expect(reconcileCallCount).toBe(2);
      expect(screen.getAllByText("Arrived after A failed")).toHaveLength(1);
    });

    it("7. three reconnect requests while fetch A is pending coalesce into exactly ONE follow-up fetch, not one per request", async () => {
      await renderThreadAndSettleInitialReconciliation();
      let resolveFetchA: (value: { data: unknown; error: null }) => void = () => {};
      let reconcileCallCount = 0;
      rpcMock.mockImplementation((name: string) => {
        if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return new Promise((resolve) => {
            resolveFetchA = resolve;
          });
        }
        return Promise.resolve({ data: [], error: null });
      });
      const channel = latestChannelForTopicPrefix("messages:conv-1");

      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      channel.statusCallback?.("SUBSCRIBED"); // fetch A starts
      // Three more reconnect cycles, all while A is still pending.
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom 2" });
      channel.statusCallback?.("SUBSCRIBED");
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom 3" });
      channel.statusCallback?.("SUBSCRIBED");
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom 4" });
      channel.statusCallback?.("SUBSCRIBED");
      expect(reconcileCallCount).toBe(1);

      await act(async () => {
        resolveFetchA({ data: [], error: null });
        await flushAsync();
      });

      // Coalesced: exactly one additional fetch, not three.
      expect(reconcileCallCount).toBe(2);
    });

    it("8. unmounting (cleanup) before fetch A resolves prevents the queued follow-up fetch from ever running", async () => {
      const { unmount } = await renderThreadAndSettleInitialReconciliation();
      let resolveFetchA: (value: { data: unknown; error: null }) => void = () => {};
      let reconcileCallCount = 0;
      rpcMock.mockImplementation((name: string) => {
        if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return new Promise((resolve) => {
            resolveFetchA = resolve;
          });
        }
        return Promise.resolve({ data: [], error: null });
      });
      const channel = latestChannelForTopicPrefix("messages:conv-1");

      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      channel.statusCallback?.("SUBSCRIBED"); // fetch A starts
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
      channel.statusCallback?.("SUBSCRIBED"); // queued while A pending
      expect(reconcileCallCount).toBe(1);

      unmount();
      resolvePendingRemovals();

      await act(async () => {
        resolveFetchA({ data: [], error: null });
        await flushAsync();
      });

      // cancelled (set by this effect's own cleanup) prevented the queued
      // follow-up from ever starting.
      expect(reconcileCallCount).toBe(1);
    });
  });

  /**
   * Chronological-ordering fix for a second race the coalescing fix
   * (above) doesn't address by itself: a message MISSED during the
   * outage (A) can be OLDER than a message that arrives LIVE (B) while
   * reconciliation is still pending -- this same channel/binding keeps
   * receiving events throughout, it is never torn down for the outage.
   * Blindly appending A after B (appendMessageIfNew always appends at
   * the end) rendered the conversation as M0 -> B -> A instead of the
   * correct M0 -> A -> B -- confirmed reproducible before this fix via
   * this exact scenario. ConversationThread's own reconciliation merge
   * now uses insertMessageInOrder (lib/messaging/message-list.ts) instead
   * of appendMessageIfNew for exactly this merge -- createdAt ascending,
   * messageId ascending as a deterministic tie-breaker -- while the live
   * handler and handleSend both keep using appendMessageIfNew unchanged
   * (correct there: a live/just-sent message is always the newest thing
   * that has ever existed).
   */
  describe("reconnect reconciliation -- chronological ordering when a live message races an older missed one", () => {
    it("1/2/3/4/5/6. live newer B arrives while reconciliation is pending, then reconciliation returns older-missing A + already-known B -- final order is M0 -> A -> B, B renders once, and side effects fire exactly once per genuinely new message (not repeated for B)", async () => {
      await renderThreadAndSettleInitialReconciliation({ initialMessages: [sampleMessage({ messageId: "M0", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });
      let resolveFetch: (value: { data: unknown; error: null }) => void = () => {};
      rpcMock.mockImplementation((name: string) => {
        if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      });
      const channel = latestChannelForTopicPrefix("messages:conv-1");
      const registration = channelOnCalls[channelOnCalls.length - 1];

      // 1. Reconciliation fetch starts (pending).
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      channel.statusCallback?.("SUBSCRIBED");

      // Live message B (later createdAt) arrives WHILE reconciliation is
      // still pending -- this channel/binding is never torn down for the
      // outage, so live delivery continues throughout.
      act(() => {
        registration.callback({
          new: { id: "B", conversation_id: "conv-1", sender_id: "other-user-1", body: "B", created_at: "2026-02-01T12:00:00.000Z" },
        });
      });
      expect(screen.getAllByText("B", { selector: "p" })).toHaveLength(1);
      expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
      expect(markConversationReadMock).toHaveBeenCalledTimes(1);

      // 2. Reconciliation now resolves with [A, B] chronologically -- A is
      // older-missing, B is the same id the live handler already rendered.
      await act(async () => {
        resolveFetch({
          data: [
            rpcRow({ message_id: "B", body: "B", created_at: "2026-02-01T12:00:00.000Z" }),
            rpcRow({ message_id: "A", body: "A", created_at: "2026-02-01T11:00:00.000Z" }),
          ],
          error: null,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // 3. Final rendered order: M0 -> A -> B.
      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      const m0Index = items.findIndex((text) => text.includes("M0"));
      const aIndex = items.findIndex((text) => text.includes("A") && !text.includes("M0"));
      const bIndex = items.findIndex((text) => text.includes("B"));
      expect(m0Index).toBeLessThan(aIndex);
      expect(aIndex).toBeLessThan(bIndex);

      // 4. B still renders exactly once (not duplicated by reconciliation).
      expect(screen.getAllByText("B", { selector: "p" })).toHaveLength(1);

      // 5/6. Side effects fired exactly once per genuinely new message --
      // once for B's live arrival, once more for A's reconciliation batch
      // (A is genuinely new and not-mine) -- never a repeat for B.
      expect(onIncomingMessageMock).toHaveBeenCalledTimes(2);
      expect(markConversationReadMock).toHaveBeenCalledTimes(2);
    });

    it("7. reverse race: reconciliation adds older-missing A first, then live B arrives afterward -- still renders M0 -> A -> B", async () => {
      await renderThreadAndSettleInitialReconciliation({ initialMessages: [sampleMessage({ messageId: "M0", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });
      const channel = latestChannelForTopicPrefix("messages:conv-1");
      const registration = channelOnCalls[channelOnCalls.length - 1];
      rpcMock.mockResolvedValue({
        data: [rpcRow({ message_id: "A", body: "A", created_at: "2026-02-01T11:00:00.000Z" })],
        error: null,
      });

      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      await act(async () => {
        channel.statusCallback?.("SUBSCRIBED");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      act(() => {
        registration.callback({
          new: { id: "B", conversation_id: "conv-1", sender_id: "other-user-1", body: "B", created_at: "2026-02-01T12:00:00.000Z" },
        });
      });

      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      const m0Index = items.findIndex((text) => text.includes("M0"));
      const aIndex = items.findIndex((text) => text.includes("A") && !text.includes("M0"));
      const bIndex = items.findIndex((text) => text.includes("B"));
      expect(m0Index).toBeLessThan(aIndex);
      expect(aIndex).toBeLessThan(bIndex);
    });

    it("8. multiple missing messages merge chronologically around an already-known live message, not just appended after it", async () => {
      await renderThreadAndSettleInitialReconciliation({ initialMessages: [sampleMessage({ messageId: "M0", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });
      const channel = latestChannelForTopicPrefix("messages:conv-1");
      const registration = channelOnCalls[channelOnCalls.length - 1];

      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      channel.statusCallback?.("SUBSCRIBED"); // reconciliation pending

      act(() => {
        registration.callback({
          new: { id: "middle-live", conversation_id: "conv-1", sender_id: "other-user-1", body: "MiddleLive", created_at: "2026-02-01T11:30:00.000Z" },
        });
      });

      rpcMock.mockImplementation((name: string) => {
        if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
        return Promise.resolve({
          data: [
            rpcRow({ message_id: "middle-live", body: "MiddleLive", created_at: "2026-02-01T11:30:00.000Z" }),
            rpcRow({ message_id: "before-middle", body: "BeforeMiddle", created_at: "2026-02-01T11:00:00.000Z" }),
            rpcRow({ message_id: "after-middle", body: "AfterMiddle", created_at: "2026-02-01T12:00:00.000Z" }),
          ],
          error: null,
        });
      });

      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
      await act(async () => {
        channel.statusCallback?.("SUBSCRIBED");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      const order = ["M0", "BeforeMiddle", "MiddleLive", "AfterMiddle"].map((label) => items.findIndex((text) => text.includes(label)));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order.every((i) => i !== -1)).toBe(true);
    });

    it("9. equal createdAt timestamps fall back to deterministic messageId ordering", async () => {
      await renderThreadAndSettleInitialReconciliation({ initialMessages: [sampleMessage({ messageId: "M0", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });
      const channel = latestChannelForTopicPrefix("messages:conv-1");
      const SAME_TIMESTAMP = "2026-02-01T11:00:00.000Z";
      rpcMock.mockResolvedValue({
        data: [
          rpcRow({ message_id: "id-b", body: "TieB", created_at: SAME_TIMESTAMP }),
          rpcRow({ message_id: "id-a", body: "TieA", created_at: SAME_TIMESTAMP }),
        ],
        error: null,
      });

      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      await act(async () => {
        channel.statusCallback?.("SUBSCRIBED");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      const aIndex = items.findIndex((text) => text.includes("TieA"));
      const bIndex = items.findIndex((text) => text.includes("TieB"));
      // "id-a" < "id-b" lexicographically -- deterministic tie-break.
      expect(aIndex).toBeLessThan(bIndex);
    });

    it("10/11. loaded older pages and earlierCursor both remain intact through an out-of-order reconciliation merge", async () => {
      loadEarlierMock.mockResolvedValue({
        messages: [sampleMessage({ messageId: "older-page", body: "OlderPageMessage", createdAt: "2026-02-01T08:00:00.000Z" })],
        hadError: false,
        nextCursor: null,
      });
      await renderThreadAndSettleInitialReconciliation({
        initialMessages: [sampleMessage({ messageId: "M0", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })],
        initialCursor: { createdAt: "2026-02-01T09:00:00.000Z", id: "cursor-1" },
      });

      fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
      await waitFor(() => expect(screen.getAllByText("OlderPageMessage")).toHaveLength(1));
      expect(loadEarlierMock).toHaveBeenCalledWith("conv-1", { createdAt: "2026-02-01T09:00:00.000Z", id: "cursor-1" });

      const channel = latestChannelForTopicPrefix("messages:conv-1");
      const registration = channelOnCalls[channelOnCalls.length - 1];
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom" });
      channel.statusCallback?.("SUBSCRIBED"); // reconciliation pending

      act(() => {
        registration.callback({
          new: { id: "B", conversation_id: "conv-1", sender_id: "other-user-1", body: "B", created_at: "2026-02-01T12:00:00.000Z" },
        });
      });

      rpcMock.mockImplementation((name: string) => {
        if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
        return Promise.resolve({
          data: [
            rpcRow({ message_id: "B", body: "B", created_at: "2026-02-01T12:00:00.000Z" }),
            rpcRow({ message_id: "A", body: "A", created_at: "2026-02-01T11:00:00.000Z" }),
          ],
          error: null,
        });
      });
      channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
      await act(async () => {
        channel.statusCallback?.("SUBSCRIBED");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // 10. The older loaded page survives, still first.
      const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(items[0]).toContain("OlderPageMessage");
      // 11. earlierCursor was exhausted by the mocked nextCursor: null
      // response above (a legitimate reason for the button to disappear),
      // never reset/corrupted by reconciliation.
      expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();
    });
  });
});

/**
 * P1-1: closes the initial-load -> first-Realtime-subscribe gap. Timeline:
 * (1) server fetches initialMessages, (2) page renders, (3) ConversationThread
 * mounts, (4) the Realtime channel begins subscribing, (5) first SUBSCRIBED
 * fires. A message inserted by the other party between (1) and (5) was
 * previously permanently missing from this mount -- not in initialMessages,
 * not delivered live (channel wasn't joined yet), and not reconciled (a
 * plain first-subscribe was never previously treated as a reconnect). Fixed
 * by reusing the exact same reconcileMissedMessages() mechanism on the very
 * first SUBSCRIBED too, not only on a later genuine reconnect -- see
 * ConversationThread.tsx's own updated `if (!hasSubscribedOnce ||
 * experiencedDisconnectAfterSubscribe)` condition.
 *
 * These tests deliberately do NOT use renderThreadAndSettleInitialReconciliation
 * -- they need to observe the raw first-subscribe reconciliation call
 * directly, which is exactly what that helper exists to neutralize for
 * every OTHER test in this file.
 */
describe("ConversationThread Realtime -- initial-load to first-subscribe reconciliation (P1-1 fix)", () => {
  it("1. the very first SUBSCRIBED now triggers exactly one reconciliation fetch", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    renderThread();
    await act(() => flushAsync());
    expect(rpcMock.mock.calls.filter((call) => call[0] === RECONCILE_RPC)).toHaveLength(1);
  });

  it("2. when every fetched message is already known, first-subscribe reconciliation is a clean no-op -- no duplicate render, no side effects, no scroll disturbance, no cursor change", async () => {
    rpcMock.mockResolvedValue({
      data: [rpcRow({ message_id: "m1", body: "First message", created_at: "2026-02-01T10:00:00.000Z" })],
      error: null,
    });
    renderThread({
      initialMessages: [sampleMessage({ messageId: "m1", body: "First message", createdAt: "2026-02-01T10:00:00.000Z" })],
      initialCursor: { createdAt: "2026-02-01T09:00:00.000Z", id: "cursor-1" },
    });

    await act(() => flushAsync());

    expect(screen.getAllByText("First message")).toHaveLength(1);
    expect(onIncomingMessageMock).not.toHaveBeenCalled();
    expect(markConversationReadMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Load earlier messages" })).toBeInTheDocument();
  });

  it("3/4. a message inserted between the initial fetch and first SUBSCRIBED is recovered and chronologically ordered correctly", async () => {
    rpcMock.mockResolvedValue({
      data: [
        rpcRow({ message_id: "m1", body: "M0", created_at: "2026-02-01T10:00:00.000Z" }),
        rpcRow({ message_id: "missed-m1", body: "MissedBeforeSubscribe", created_at: "2026-02-01T09:30:00.000Z" }),
      ],
      error: null,
    });
    renderThread({ initialMessages: [sampleMessage({ messageId: "m1", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });

    await act(() => flushAsync());

    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items.some((text) => text.includes("MissedBeforeSubscribe"))).toBe(true);
    // 4. Chronologically ordered (createdAt ascending) via
    // insertMessageInOrder, not just appended after M0 -- the missed
    // message's own createdAt (09:30) is BEFORE M0's (10:00).
    const missedIndex = items.findIndex((text) => text.includes("MissedBeforeSubscribe"));
    const m0Index = items.findIndex((text) => text.includes("M0"));
    expect(missedIndex).toBeLessThan(m0Index);
  });

  it("5. a visible thread's first-subscribe reconciliation batch fires onIncomingMessage/markConversationRead/refreshUnreadMessageCount exactly once for the whole batch", async () => {
    rpcMock.mockResolvedValue({
      data: [
        rpcRow({ message_id: "m1", body: "M0", created_at: "2026-02-01T10:00:00.000Z" }),
        rpcRow({ message_id: "missed-1", body: "MissedA", created_at: "2026-02-01T10:01:00.000Z" }),
        rpcRow({ message_id: "missed-2", body: "MissedB", created_at: "2026-02-01T10:02:00.000Z" }),
      ],
      error: null,
    });
    renderThread({ initialMessages: [sampleMessage({ messageId: "m1", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });

    await act(() => flushAsync());

    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    // markConversationRead is reconciliation-specific (the separate mount-
    // time mark-read-ON-OPEN effect calls markConversationReadIfUnread, a
    // distinct mock) -- exactly once proves the 3-message batch collapsed
    // to a single call, not one per message.
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledWith("conv-1");
    await act(() => flushAsync());
    // refreshUnreadMessageCount is chained off BOTH markConversationRead
    // (this reconciliation batch) AND the unrelated mount-time
    // markConversationReadIfUnread effect -- 2 total, not 3, is what
    // proves the batch itself only contributed one call, not one per
    // message.
    expect(refreshUnreadMessageCountMock).toHaveBeenCalledTimes(2);
  });

  it("6. a minimized thread's first-subscribe reconciliation fires onIncomingMessage but never markConversationRead", async () => {
    rpcMock.mockResolvedValue({
      data: [
        rpcRow({ message_id: "m1", body: "M0", created_at: "2026-02-01T10:00:00.000Z" }),
        rpcRow({ message_id: "missed-1", body: "MissedWhileMinimized", created_at: "2026-02-01T10:01:00.000Z" }),
      ],
      error: null,
    });
    renderThread({ initialMessages: [sampleMessage({ messageId: "m1", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })], isMinimized: true });

    await act(() => flushAsync());

    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).not.toHaveBeenCalled();
  });

  it("7. first-subscribe reconciliation racing a live Realtime event dedupes correctly", async () => {
    let resolveFetch: (value: { data: unknown; error: null }) => void = () => {};
    rpcMock.mockImplementation((name: string) => {
      if (name !== RECONCILE_RPC) return Promise.resolve({ data: 0, error: null });
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    });
    renderThread({ initialMessages: [sampleMessage({ messageId: "M0", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });
    // First-subscribe reconciliation now pending (fired synchronously
    // during mount, before this line ever runs).
    const registration = channelOnCalls[channelOnCalls.length - 1];

    act(() => {
      registration.callback({
        new: { id: "race-x", conversation_id: "conv-1", sender_id: "other-user-1", body: "RaceX", created_at: "2026-02-01T11:00:00.000Z" },
      });
    });
    expect(screen.getAllByText("RaceX")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({ data: [rpcRow({ message_id: "race-x", body: "RaceX", created_at: "2026-02-01T11:00:00.000Z" })], error: null });
      await flushAsync();
    });

    expect(screen.getAllByText("RaceX")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
  });

  it("8. a delayed live Realtime replay after first-subscribe reconciliation already merged the same message is deduped", async () => {
    rpcMock.mockResolvedValue({
      data: [rpcRow({ message_id: "reconciled-first", body: "ReconciledFirst", created_at: "2026-02-01T11:00:00.000Z" })],
      error: null,
    });
    renderThread({ initialMessages: [sampleMessage({ messageId: "M0", body: "M0", createdAt: "2026-02-01T10:00:00.000Z" })] });
    const registration = channelOnCalls[channelOnCalls.length - 1];

    await act(() => flushAsync());
    expect(screen.getAllByText("ReconciledFirst")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);

    act(() => {
      registration.callback({
        new: { id: "reconciled-first", conversation_id: "conv-1", sender_id: "other-user-1", body: "ReconciledFirst", created_at: "2026-02-01T11:00:00.000Z" },
      });
    });

    expect(screen.getAllByText("ReconciledFirst")).toHaveLength(1);
    expect(onIncomingMessageMock).toHaveBeenCalledTimes(1);
    expect(markConversationReadMock).toHaveBeenCalledTimes(1);
  });

  it("9. a first-subscribe reconciliation failure preserves current messages, logs safely, and shows no raw backend error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });
    renderThread({ initialMessages: [sampleMessage({ messageId: "m1", body: "First message" })] });

    await act(() => flushAsync());

    expect(screen.getAllByText("First message")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/raw backend detail/);
    consoleErrorSpy.mockRestore();
  });

  it("10. after a first-subscribe reconciliation failure, a later CHANNEL_ERROR -> SUBSCRIBED reconnect still triggers and succeeds", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } }); // the mount-time (first-subscribe) call fails
    renderThread();
    const channel = latestChannelForTopicPrefix("messages:conv-1");
    await act(() => flushAsync()); // let the failed first-subscribe fetch settle

    rpcMock.mockResolvedValue({
      data: [rpcRow({ message_id: "after-failure", body: "AfterFailure", created_at: "2026-02-01T13:00:00.000Z" })],
      error: null,
    });
    channel.statusCallback?.("CHANNEL_ERROR", { message: "boom again" });
    await act(async () => {
      channel.statusCallback?.("SUBSCRIBED");
      await flushAsync();
    });

    expect(screen.getAllByText("AfterFailure")).toHaveLength(1);
  });
});
