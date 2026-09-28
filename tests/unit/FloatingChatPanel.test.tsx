import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { LoadConversationForPanelResult } from "@/lib/messaging/load-conversation-for-panel";
import type { ConversationSummary } from "@/lib/messaging/get-my-conversations";

const {
  loadConversationForPanelMock,
  loadEarlierMessagesForPanelMock,
  loadConversationsForMessagingCenterMock,
  loadMoreConversationsForMessagingCenterMock,
  markConversationReadMock,
  markConversationReadIfUnreadMock,
  markConversationUnreadMock,
  setConversationArchivedMock,
  setConversationMutedMock,
  sendMessageMock,
  blockUserMock,
  unblockUserMock,
  submitReportMock,
  channelOnCalls,
  channelNameCalls,
  subscribeMock,
  removeChannelMock,
  getSessionMock,
  rpcMock,
} = vi.hoisted(() => {
  const channelOnCalls: Array<{ config: { table: string; filter: string }; callback: (payload: { new: unknown }) => void }> = [];
  const channelNameCalls: string[] = [];
  return {
    loadConversationForPanelMock: vi.fn(),
    loadEarlierMessagesForPanelMock: vi.fn(),
    loadConversationsForMessagingCenterMock: vi.fn(),
    loadMoreConversationsForMessagingCenterMock: vi.fn(),
    markConversationReadMock: vi.fn(),
    markConversationReadIfUnreadMock: vi.fn(),
    markConversationUnreadMock: vi.fn(),
    setConversationArchivedMock: vi.fn(),
    setConversationMutedMock: vi.fn(),
    sendMessageMock: vi.fn(),
    blockUserMock: vi.fn(),
    unblockUserMock: vi.fn(),
    submitReportMock: vi.fn(),
    channelOnCalls,
    channelNameCalls,
    subscribeMock: vi.fn(),
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
    subscribe: vi.fn(() => {
      subscribeMock();
      return fakeChannel;
    }),
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

vi.mock("@/lib/messaging/load-conversation-for-panel", () => ({
  loadConversationForPanel: loadConversationForPanelMock,
  loadEarlierMessagesForPanel: loadEarlierMessagesForPanelMock,
}));

vi.mock("@/lib/messaging/load-conversations-for-messaging-center", () => ({
  loadConversationsForMessagingCenter: loadConversationsForMessagingCenterMock,
  loadMoreConversationsForMessagingCenter: loadMoreConversationsForMessagingCenterMock,
}));

vi.mock("@/lib/messaging/send-message", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messaging/send-message")>("@/lib/messaging/send-message");
  return { ...actual, sendMessage: sendMessageMock };
});

vi.mock("@/lib/messaging/conversation-state", () => ({
  markConversationRead: markConversationReadMock,
  markConversationReadIfUnread: markConversationReadIfUnreadMock,
  markConversationUnread: markConversationUnreadMock,
  setConversationArchived: setConversationArchivedMock,
  setConversationMuted: setConversationMutedMock,
}));

vi.mock("@/lib/messaging/block-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messaging/block-actions")>("@/lib/messaging/block-actions");
  return { ...actual, blockUser: blockUserMock, unblockUser: unblockUserMock };
});

vi.mock("@/lib/moderation/report-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/moderation/report-actions")>("@/lib/moderation/report-actions");
  return { ...actual, submitReport: submitReportMock };
});

import { FloatingChatPanel } from "@/components/messaging/FloatingChatPanel";
import { FloatingMessengerProvider, useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";

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

function readyResult(overrides: Partial<Extract<LoadConversationForPanelResult, { status: "found" }>> = {}): LoadConversationForPanelResult {
  return {
    status: "found",
    context: sampleContext(),
    initialMessages: [],
    initialCursor: null,
    otherPartyId: "other-user-1",
    initialIsBlocked: false,
    ...overrides,
  };
}

function sampleConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
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
    listingImageUrl: undefined,
    otherPartyDisplayName: null,
    otherPartyAvatarUrl: undefined,
    lastMessageAt: "2026-02-01T10:00:00.000Z",
    lastMessagePreview: "Hello",
    lastMessageIsMine: false,
    isUnread: false,
    isArchived: false,
    isMuted: false,
    ...overrides,
  };
}

/** Test-only trigger: a button that calls openConversation via the real
 * context, exactly like ConversationsListClient/ListingActions do. */
function OpenButton({ conversationId, label }: { conversationId: string; label: string }) {
  const { openConversation } = useFloatingMessenger();
  return (
    <button type="button" onClick={() => openConversation(conversationId)}>
      {label}
    </button>
  );
}

function renderPanel({ initialUnreadMessageCount = 0 }: { initialUnreadMessageCount?: number } = {}) {
  return render(
    <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={initialUnreadMessageCount} initialUnreadNotificationCount={0}>
      <FloatingMessengerProvider>
        <OpenButton conversationId="conv-1" label="Open conv-1" />
        <OpenButton conversationId="conv-2" label="Open conv-2" />
        <FloatingChatPanel isAuthenticated={true} />
      </FloatingMessengerProvider>
    </NotificationsProvider>,
  );
}

function latestMessagesCallback() {
  const registration = channelOnCalls[channelOnCalls.length - 1];
  return registration.callback;
}

function fireIncomingMessage(row: { id: string; conversation_id: string; sender_id: string; body: string; created_at: string }) {
  const callback = latestMessagesCallback();
  act(() => {
    callback({ new: row });
  });
}

/** jsdom hardcodes scrollHeight/clientHeight to 0 on every element (no
 * real layout) -- stubbed on the shared prototype so the minimize/
 * restore scroll-reconciliation tests below have a known "content taller
 * than the visible area" shape to assert scrollTop against. See
 * ConversationThread-scroll.test.tsx for the fuller scroll-behavior
 * suite; this file only covers the minimize/restore-specific case. */
const STUBBED_SCROLL_HEIGHT = 1000;
const STUBBED_CLIENT_HEIGHT = 400;

beforeEach(() => {
  vi.clearAllMocks();
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  rpcMock.mockResolvedValue({ data: 0, error: null });
  markConversationReadMock.mockResolvedValue({ ok: true });
  markConversationReadIfUnreadMock.mockResolvedValue({ ok: true });
  loadConversationForPanelMock.mockResolvedValue(readyResult());
  loadConversationsForMessagingCenterMock.mockResolvedValue({ conversations: [], hadError: false, nextCursor: null });
  loadMoreConversationsForMessagingCenterMock.mockResolvedValue({ conversations: [], hadError: false, nextCursor: null });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: STUBBED_SCROLL_HEIGHT });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: STUBBED_CLIENT_HEIGHT });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

describe("FloatingChatPanel -- persistent launcher (collapsed state)", () => {
  it("is visible on desktop for a signed-in viewer even with nothing selected -- never gated on 'has a conversation been opened'", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();
  });

  it("renders nothing at all for a guest -- messaging stays sign-in-only", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
        <FloatingMessengerProvider>
          <FloatingChatPanel isAuthenticated={false} />
        </FloatingMessengerProvider>
      </NotificationsProvider>,
    );
    expect(screen.queryByRole("button", { name: /Messages/ })).not.toBeInTheDocument();
  });

  it("shows the authoritative unread-conversation count as a numeric badge, the same value the header/mobile-nav badges use", () => {
    renderPanel({ initialUnreadMessageCount: 3 });
    expect(screen.getByRole("button", { name: "Messages, 3 unread" })).toBeInTheDocument();
  });

  it("shows no badge at all when the unread count is zero", () => {
    renderPanel({ initialUnreadMessageCount: 0 });
    const launcher = screen.getByRole("button", { name: "Messages" });
    expect(launcher).not.toHaveTextContent(/\d/);
  });

  it("clicking the launcher opens the expanded messaging center", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByText("Select a conversation")).toBeInTheDocument());
  });

  it("persists across a swap of page content underneath it -- the root-level mount survives normal marketplace navigation", () => {
    function PageOne() {
      return <p>Page one</p>;
    }
    function PageTwo() {
      return <p>Page two</p>;
    }
    const { rerender } = render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
        <FloatingMessengerProvider>
          <PageOne />
          <FloatingChatPanel isAuthenticated={true} />
        </FloatingMessengerProvider>
      </NotificationsProvider>,
    );
    expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();

    rerender(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
        <FloatingMessengerProvider>
          <PageTwo />
          <FloatingChatPanel isAuthenticated={true} />
        </FloatingMessengerProvider>
      </NotificationsProvider>,
    );
    expect(screen.getByText("Page two")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();
  });
});

describe("FloatingChatPanel -- expanded two-column messaging center", () => {
  it("renders both the conversation list column and the right pane at once", async () => {
    loadConversationsForMessagingCenterMock.mockResolvedValue({
      conversations: [sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet" })],
      hadError: false,
      nextCursor: null,
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    await waitFor(() => expect(screen.getByText("Anne's Closet")).toBeInTheDocument());
    expect(screen.getByText("Select a conversation")).toBeInTheDocument();
  });

  it("shows the conversation list's own empty state when there are no conversations", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByText("No messages yet.")).toBeInTheDocument());
  });

  it("shows 'Select a conversation' in the right pane when nothing has been selected -- never auto-selects one", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByText("Select a conversation")).toBeInTheDocument());
  });

  it("a rejected list fetch shows a real error (not stuck loading forever, not a false empty state), and retries when the panel is reopened", async () => {
    loadConversationsForMessagingCenterMock.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    await waitFor(() => expect(screen.getByText("Unable to load your messages right now.")).toBeInTheDocument());
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
    expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(1);

    // Reopening retries the fetch rather than staying stuck on the
    // failure for the rest of the session.
    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({
      conversations: [sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet" })],
      hadError: false,
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    await waitFor(() => expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Anne's Closet")).toBeInTheDocument());
  });

  it("an in-band hadError list result is also retried when the panel is reopened", async () => {
    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({ conversations: [], hadError: true, nextCursor: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    await waitFor(() => expect(screen.getByText("Unable to load your messages right now.")).toBeInTheDocument());
    expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(1);

    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({
      conversations: [sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet" })],
      hadError: false,
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    await waitFor(() => expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Anne's Closet")).toBeInTheDocument());
  });

  it("REGRESSION (owner QA): a successful empty first load does not stay stale once conversations later exist and the panel is reopened", async () => {
    // First open: genuinely empty at that moment (e.g. nothing yet, or a
    // fetch that raced something) -- a real success, not a failure.
    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({ conversations: [], hadError: false, nextCursor: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByText("No messages yet.")).toBeInTheDocument());
    expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(1);

    // Conversations now exist (e.g. Mark as Unread on an existing one, or
    // a new one arriving) -- Mark as Unread itself never fires the
    // list's own new_message-driven refresh (it's a plain
    // conversation_user_states update, not send_message), so nothing
    // else will pick this up on its own before the panel is reopened.
    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({
      conversations: [sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet" })],
      hadError: false,
      nextCursor: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    await waitFor(() => expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Anne's Closet")).toBeInTheDocument());
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
  });

  it("REGRESSION (owner QA, exact sequence): the list refreshes when Mark as Unread's closeConversation returns to the list, WITHOUT requiring a minimize/reopen", async () => {
    // 1. Floating panel has a successful empty list state.
    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({ conversations: [], hadError: false, nextCursor: null });
    markConversationUnreadMock.mockResolvedValue({ ok: true });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByText("No messages yet.")).toBeInTheDocument());
    expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(1);

    // 2. A conversation is opened through the existing direct-open path
    // while the panel remains open (isOpen never changes here).
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());

    // 4. Conversations are now available from the list loader by the
    // time Mark as Unread completes.
    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({
      conversations: [sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet" })],
      hadError: false,
      nextCursor: null,
    });

    // 3. Mark as Unread succeeds; closeConversation() returns the
    // still-open panel to "Select a conversation" -- the panel is never
    // minimized or reopened anywhere in this sequence.
    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(screen.getByText("Select a conversation")).toBeInTheDocument());

    // Expected: the list refreshes and displays them without a
    // minimize/reopen -- exactly one additional fetch (not zero, and not
    // more than one from any duplicate trigger).
    await waitFor(() => expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Anne's Closet")).toBeInTheDocument());
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
  });

  it("an older, still in-flight list fetch cannot overwrite a newer return-to-list refresh", async () => {
    let resolveInitial: (value: { conversations: ConversationSummary[]; hadError: boolean; nextCursor: null }) => void = () => {};
    loadConversationsForMessagingCenterMock.mockReturnValueOnce(new Promise((resolve) => (resolveInitial = resolve)));
    markConversationUnreadMock.mockResolvedValue({ ok: true });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());

    // The newer refresh's own fetch resolves first, with the real data.
    loadConversationsForMessagingCenterMock.mockResolvedValueOnce({
      conversations: [sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet" })],
      hadError: false,
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(loadConversationsForMessagingCenterMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Anne's Closet")).toBeInTheDocument());

    // The OLDER initial fetch (still pending from before Mark as Unread)
    // finally resolves now, empty -- it must not overwrite the newer,
    // already-applied real result.
    resolveInitial({ conversations: [], hadError: false, nextCursor: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("Anne's Closet")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
  });

  it("selecting a conversation renders its thread in the right pane", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));

    await waitFor(() => expect(loadConversationForPanelMock).toHaveBeenCalledWith("conv-1"));
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
    expect(screen.queryByText("Select a conversation")).not.toBeInTheDocument();
  });

  it("selecting a different conversation swaps the right pane -- it never opens a second window", async () => {
    loadConversationForPanelMock.mockImplementation(async (id: string) => readyResult({ context: sampleContext({ conversationId: id, shopName: `Shop ${id}` }) }));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getAllByText("Shop conv-1").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "Open conv-2" }));
    await waitFor(() => expect(screen.getAllByText("Shop conv-2").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("Shop conv-1")).toHaveLength(0);

    // Never more than one messages:<id> channel alive at once -- the
    // first is torn down before the second is created.
    await waitFor(() => expect(removeChannelMock).toHaveBeenCalled());
  });

  it("an inaccessible (not_found) selected conversation fails safely in the right pane, never a crash", async () => {
    loadConversationForPanelMock.mockResolvedValue({ status: "not_found" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));

    await waitFor(() => expect(screen.getByText("This conversation is no longer available.")).toBeInTheDocument());
  });

  it("a load error fails safely in the right pane, never a crash", async () => {
    loadConversationForPanelMock.mockResolvedValue({ status: "error" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));

    await waitFor(() => expect(screen.getByText("Unable to load this conversation right now.")).toBeInTheDocument());
  });

  it("minimizing hides the expanded center and shows the launcher again", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize messaging center" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();
  });

  it("closing collapses back to the launcher (non-destructive) rather than removing messenger access", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close messaging center" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close messaging center" }));
    // The launcher is still there and still opens the center again.
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize messaging center" })).toBeInTheDocument());
  });

  it("close does not call any mark-read/mark-unread action itself -- a future message for this conversation still updates the global badge normally", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
    markConversationReadMock.mockClear();
    markConversationReadIfUnreadMock.mockClear();
    markConversationUnreadMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Close messaging center" }));

    expect(markConversationReadMock).not.toHaveBeenCalled();
    expect(markConversationReadIfUnreadMock).not.toHaveBeenCalled();
    expect(markConversationUnreadMock).not.toHaveBeenCalled();
  });

  it("BUG REPRO (owner QA): the conversation list keeps showing its already-loaded conversations after Mark as Unread closes the selected conversation, and after reopening", async () => {
    loadConversationsForMessagingCenterMock.mockResolvedValue({
      conversations: [
        sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet" }),
        sampleConversation({ conversationId: "conv-2", shopName: "Bob's Shop" }),
      ],
      hadError: false,
      nextCursor: null,
    });
    markConversationUnreadMock.mockResolvedValue({ ok: true });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    // "Anne's Closet" can legitimately appear twice once the thread loads
    // (the list row AND the selected thread's own identity header both
    // show the shop name) -- getAllByText, not getByText, is correct here.
    await waitFor(() => expect(screen.getAllByText("Anne's Closet").length).toBeGreaterThan(0));
    expect(screen.getByText("Bob's Shop")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(screen.getByText("Select a conversation")).toBeInTheDocument());

    // The list must still show both existing conversations -- it must
    // never fall back to "No messages yet" for data that already loaded
    // successfully.
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Anne's Closet").length).toBeGreaterThan(0);
    expect(screen.getByText("Bob's Shop")).toBeInTheDocument();

    // Reopening (selecting the other existing conversation from the
    // still-populated list) must also work normally.
    fireEvent.click(screen.getByRole("button", { name: "Open conv-2" }));
    await waitFor(() => expect(screen.getAllByLabelText("Message").length).toBeGreaterThan(0));
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
  });

  it("stays within the viewport -- capped against 100vw, never a fixed size that could overflow a narrower desktop window", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize messaging center" })).toBeInTheDocument());

    // The expanded chrome itself (not the outer fixed positioning
    // wrapper) carries the width/max-width classes.
    const chrome = screen.getByRole("button", { name: "Minimize messaging center" }).closest("div.overflow-hidden");
    expect(chrome?.className).toMatch(/max-w-\[calc\(100vw-3rem\)\]/);
    expect(chrome?.className).toMatch(/w-\[800px\]/);
  });

  it("remains fixed bottom-right, ~24px off both edges, and hidden below the lg breakpoint", async () => {
    renderPanel();
    const wrapper = screen.getByRole("button", { name: "Messages" }).closest("div.fixed");
    expect(wrapper?.className).toMatch(/bottom-6/);
    expect(wrapper?.className).toMatch(/right-6/);
    expect(wrapper?.className).toMatch(/\bhidden\b/);
    expect(wrapper?.className).toMatch(/lg:block/);
  });
});

describe("FloatingChatPanel -- Realtime while a conversation is selected and visible", () => {
  it("appends an incoming message live", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(channelOnCalls.length).toBeGreaterThan(0));

    fireIncomingMessage({ id: "msg-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "Hello there", created_at: "2026-02-01T10:00:00.000Z" });

    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("a duplicate/replayed message id is not appended twice", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(channelOnCalls.length).toBeGreaterThan(0));

    const row = { id: "msg-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "Hello there", created_at: "2026-02-01T10:00:00.000Z" };
    fireIncomingMessage(row);
    fireIncomingMessage(row);

    expect(screen.getAllByText("Hello there")).toHaveLength(1);
  });
});

describe("FloatingChatPanel -- collapsed/minimized read-state semantics", () => {
  it("does not auto-mark an incoming message read while collapsed", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize messaging center" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    markConversationReadMock.mockClear();

    fireIncomingMessage({ id: "msg-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "While collapsed", created_at: "2026-02-01T10:00:00.000Z" });

    expect(markConversationReadMock).not.toHaveBeenCalled();
  });

  it("restoring after a collapsed-unread message reconciles read state (marks read, refreshes the authoritative count)", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize messaging center" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    markConversationReadIfUnreadMock.mockClear();
    rpcMock.mockClear();

    fireIncomingMessage({ id: "msg-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "While collapsed", created_at: "2026-02-01T10:00:00.000Z" });

    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
  });

  it("restoring re-snaps to the latest message when the viewer was near the bottom before minimizing", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize messaging center" })).toBeInTheDocument());

    const container = screen.getByTestId("messages-scroll-container");
    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    // Simulates a real browser's own behavior: scrollTop changes made
    // while an element is display:none don't take effect (jsdom itself
    // doesn't model this, so the test forces the same starting point by
    // hand) -- restoring should re-snap to the bottom regardless, since
    // the viewer was reading the latest messages before minimizing.
    container.scrollTop = 0;

    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    expect(container.scrollTop).toBe(STUBBED_SCROLL_HEIGHT);
  });

  it("restoring does NOT force a scroll when the viewer had deliberately scrolled up before minimizing -- no jarring re-scroll, no loop", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize messaging center" })).toBeInTheDocument());

    const container = screen.getByTestId("messages-scroll-container");
    container.scrollTop = 50; // 1000-50-400=550, not near bottom
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole("button", { name: "Minimize messaging center" }));
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));

    expect(container.scrollTop).toBe(50);
  });
});
