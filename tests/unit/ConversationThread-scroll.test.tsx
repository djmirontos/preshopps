import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { ConversationMessage } from "@/lib/messaging/get-conversation-messages";

const {
  sendMessageMock,
  markConversationReadMock,
  markConversationReadIfUnreadMock,
  channelOnCalls,
  channelNameCalls,
  removeChannelMock,
  getSessionMock,
  rpcMock,
} = vi.hoisted(() => {
  const channelOnCalls: Array<{ config: { table: string; filter: string }; callback: (payload: { new: unknown }) => void }> = [];
  const channelNameCalls: string[] = [];
  return {
    sendMessageMock: vi.fn(),
    markConversationReadMock: vi.fn(),
    markConversationReadIfUnreadMock: vi.fn(),
    channelOnCalls,
    channelNameCalls,
    removeChannelMock: vi.fn(),
    getSessionMock: vi.fn(),
    rpcMock: vi.fn(),
  };
});

function makeFakeChannel() {
  const fakeChannel = {
    on: vi.fn((_event: string, config: never, callback: (payload: { new: unknown }) => void) => {
      channelOnCalls.push({ config: config as unknown as (typeof channelOnCalls)[number]["config"], callback });
      return fakeChannel;
    }),
    subscribe: vi.fn(() => fakeChannel),
  };
  return fakeChannel;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
    channel: (name: string) => {
      channelNameCalls.push(name);
      return makeFakeChannel();
    },
    removeChannel: removeChannelMock,
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

function latestMessagesCallback() {
  const messageRegistrations = channelOnCalls.filter((registration) => registration.config.table === "messages");
  const registration = messageRegistrations[messageRegistrations.length - 1];
  if (!registration) throw new Error("No postgres_changes subscription was registered for messages");
  return registration.callback;
}

function fireIncomingMessage(row: { id: string; conversation_id: string; sender_id: string; body: string; created_at: string }) {
  act(() => {
    latestMessagesCallback()({ new: row });
  });
}

/** jsdom never computes real layout, so scrollHeight/clientHeight are
 * hardcoded to 0 on every element regardless of content -- stubbing them
 * on the shared prototype gives every element in a test a fixed, known
 * "content is taller than the visible area" shape (1000px of content in
 * a 400px-tall viewport), which is what makes the scrollTop assertions
 * below meaningful instead of trivially 0 either way. scrollTop itself
 * is left alone -- jsdom already implements it as a plain, real,
 * per-element mutable numeric property (setting/reading it doesn't
 * require real layout), exactly what ConversationThread's own
 * `el.scrollTop = el.scrollHeight` and the near-bottom calculation need. */
const STUBBED_SCROLL_HEIGHT = 1000;
const STUBBED_CLIENT_HEIGHT = 400;

beforeEach(() => {
  vi.clearAllMocks();
  loadEarlierMock.mockReset();
  markConversationReadIfUnreadMock.mockResolvedValue({ ok: true });
  markConversationReadMock.mockResolvedValue({ ok: true });
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  rpcMock.mockResolvedValue({ data: 0, error: null });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: STUBBED_SCROLL_HEIGHT });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: STUBBED_CLIENT_HEIGHT });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

/** scrollHeight(1000) - scrollTop - clientHeight(400) <= 120 (the
 * component's own NEAR_BOTTOM_THRESHOLD_PX) is "near bottom". */
const NEAR_BOTTOM_SCROLL_TOP = 550; // 1000-550-400=50, near bottom
const SCROLLED_UP_SCROLL_TOP = 50; // 1000-50-400=550, not near bottom

describe("ConversationThread scrolling -- initial load (Requirement A)", () => {
  it("scrolls to the latest message once the initial messages have rendered", () => {
    renderConversation();
    const container = screen.getByTestId("messages-scroll-container");
    expect(container.scrollTop).toBe(STUBBED_SCROLL_HEIGHT);
  });

  it("scrolls to the bottom even with a long history of initial messages, without requiring the viewer to scroll manually", () => {
    const initialMessages = Array.from({ length: 20 }, (_, i) => sampleMessage({ messageId: `m${i}`, body: `Message ${i}` }));
    renderConversation({ initialMessages });
    const container = screen.getByTestId("messages-scroll-container");
    expect(container.scrollTop).toBe(STUBBED_SCROLL_HEIGHT);
  });
});

describe("ConversationThread scrolling -- chronological order is unchanged", () => {
  it("still renders oldest-first, newest-last regardless of the new scroll behavior", () => {
    renderConversation({
      initialMessages: [
        sampleMessage({ messageId: "m1", body: "Oldest" }),
        sampleMessage({ messageId: "m2", body: "Middle" }),
        sampleMessage({ messageId: "m3", body: "Newest" }),
      ],
    });
    const bodies = screen.getAllByText(/Oldest|Middle|Newest/).map((el) => el.textContent);
    expect(bodies).toEqual(["Oldest", "Middle", "Newest"]);
  });
});

describe("ConversationThread scrolling -- sending a message (Requirement B)", () => {
  it("scrolls to the newly sent message", async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: "msg-new", createdAt: "2026-02-01T11:00:00.000Z" });
    renderConversation();
    const container = screen.getByTestId("messages-scroll-container");
    // Simulate having scrolled away from the bottom after the initial load.
    container.scrollTop = 0;

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    await waitFor(() => expect(container.scrollTop).toBe(STUBBED_SCROLL_HEIGHT));
  });
});

describe("ConversationThread scrolling -- incoming Realtime messages (Requirement C)", () => {
  it("follows to the bottom when an incoming message arrives while the viewer is already near it", () => {
    renderConversation();
    const container = screen.getByTestId("messages-scroll-container");
    container.scrollTop = NEAR_BOTTOM_SCROLL_TOP;
    fireEvent.scroll(container);

    fireIncomingMessage({ id: "msg-in-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "New message", created_at: "2026-02-01T12:00:00.000Z" });

    expect(container.scrollTop).toBe(STUBBED_SCROLL_HEIGHT);
  });

  it("does NOT force-scroll when an incoming message arrives while the viewer has deliberately scrolled up to read older messages", () => {
    renderConversation();
    const container = screen.getByTestId("messages-scroll-container");
    container.scrollTop = SCROLLED_UP_SCROLL_TOP;
    fireEvent.scroll(container);

    fireIncomingMessage({ id: "msg-in-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "New message", created_at: "2026-02-01T12:00:00.000Z" });

    expect(container.scrollTop).toBe(SCROLLED_UP_SCROLL_TOP);
    expect(screen.getByText("New message")).toBeInTheDocument();
  });

  it("a duplicate/replayed incoming message id neither double-appends nor causes a second scroll while the viewer is reading older messages", () => {
    renderConversation();
    const container = screen.getByTestId("messages-scroll-container");
    container.scrollTop = SCROLLED_UP_SCROLL_TOP;
    fireEvent.scroll(container);

    const row = { id: "msg-in-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "New message", created_at: "2026-02-01T12:00:00.000Z" };
    fireIncomingMessage(row);
    fireIncomingMessage(row);

    expect(screen.getAllByText("New message")).toHaveLength(1);
    expect(container.scrollTop).toBe(SCROLLED_UP_SCROLL_TOP);
  });
});

describe("ConversationThread scrolling -- loading older messages never jumps to the bottom", () => {
  it("preserves the viewer's current scroll position after a successful 'Load earlier'", async () => {
    loadEarlierMock.mockResolvedValue({
      messages: [sampleMessage({ messageId: "older-1", body: "An older message" })],
      hadError: false,
      nextCursor: null,
    });
    renderConversation({ initialCursor: { createdAt: "2026-01-01T00:00:00.000Z", id: "cursor-1" } });

    const container = screen.getByTestId("messages-scroll-container");
    container.scrollTop = SCROLLED_UP_SCROLL_TOP;
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));

    await waitFor(() => expect(loadEarlierMock).toHaveBeenCalled());
    await screen.findByText("An older message");

    expect(container.scrollTop).toBe(SCROLLED_UP_SCROLL_TOP);
  });
});
