import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { LoadConversationForPanelResult } from "@/lib/messaging/load-conversation-for-panel";

const {
  loadConversationForPanelMock,
  loadEarlierMessagesForPanelMock,
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

function renderPanel() {
  return render(
    <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
      <FloatingMessengerProvider>
        <OpenButton conversationId="conv-1" label="Open conv-1" />
        <OpenButton conversationId="conv-2" label="Open conv-2" />
        <FloatingChatPanel />
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
 * suite; this file only covers the minimize/restore-specific case (D). */
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
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: STUBBED_SCROLL_HEIGHT });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: STUBBED_CLIENT_HEIGHT });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

describe("FloatingChatPanel -- open/close lifecycle", () => {
  it("renders nothing when no conversation is open", () => {
    const { container } = renderPanel();
    expect(container.querySelector('[role="tooltip"]')?.parentElement).toBeFalsy();
    expect(screen.queryByRole("button", { name: "Minimize chat" })).not.toBeInTheDocument();
  });

  it("opening a conversation loads and shows it expanded", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));

    await waitFor(() => expect(loadConversationForPanelMock).toHaveBeenCalledWith("conv-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Close chat" })).toBeInTheDocument();
  });

  it("an inaccessible (not_found) conversation fails safely -- a plain message and a Close action, never a crash", async () => {
    loadConversationForPanelMock.mockResolvedValue({ status: "not_found" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));

    await waitFor(() => expect(screen.getByText("This conversation is no longer available.")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Close" })).not.toHaveLength(0);
  });

  it("a load error fails safely -- a plain message and a Close action, never a crash", async () => {
    loadConversationForPanelMock.mockResolvedValue({ status: "error" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));

    await waitFor(() => expect(screen.getByText("Unable to load this conversation right now.")).toBeInTheDocument());
  });

  it("one chat open at a time -- opening a second conversation replaces the first", async () => {
    loadConversationForPanelMock.mockImplementation(async (id: string) => readyResult({ context: sampleContext({ conversationId: id, shopName: `Shop ${id}` }) }));
    renderPanel();

    // The name renders twice at once (the always-mounted minimized pill
    // and the always-mounted expanded chrome header -- only one of the
    // two is ever visually shown via CSS, see FloatingChatPanel's own
    // file comment), so this asserts on the count instead of a single
    // unique match.
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getAllByText("Shop conv-1").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "Open conv-2" }));
    await waitFor(() => expect(screen.getAllByText("Shop conv-2").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("Shop conv-1")).toHaveLength(0);

    // Never more than one messages:<id> channel alive at once.
    await waitFor(() => expect(removeChannelMock).toHaveBeenCalled());
  });

  it("minimize hides the expanded chrome and shows the restore pill; restore reverses it", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    expect(screen.getByRole("button", { name: /Restore chat/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Restore chat/ }));
    expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument();
  });

  it("close removes the panel entirely", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close chat" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(screen.queryByRole("button", { name: "Minimize chat" })).not.toBeInTheDocument();
  });

  it("close does not call any mark-read/mark-unread action itself -- a future message for this conversation still updates the global badge normally", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    // Wait for the thread to have actually mounted and run its own
    // mount-time mark-read-if-unread call first -- otherwise clearing the
    // mocks here could race ahead of that call and produce a false pass.
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
    markConversationReadMock.mockClear();
    markConversationReadIfUnreadMock.mockClear();
    markConversationUnreadMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));

    expect(markConversationReadMock).not.toHaveBeenCalled();
    expect(markConversationReadIfUnreadMock).not.toHaveBeenCalled();
    expect(markConversationUnreadMock).not.toHaveBeenCalled();
  });
});

describe("FloatingChatPanel -- Realtime while expanded", () => {
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

describe("FloatingChatPanel -- minimized read-state semantics", () => {
  it("does not auto-mark an incoming message read while minimized", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    markConversationReadMock.mockClear();

    fireIncomingMessage({ id: "msg-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "While minimized", created_at: "2026-02-01T10:00:00.000Z" });

    expect(markConversationReadMock).not.toHaveBeenCalled();
  });

  it("shows an unread indicator on the pill after a message arrives while minimized", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));

    expect(screen.getByRole("button", { name: /Restore chat/ })).toHaveAccessibleName(/Restore chat/);

    fireIncomingMessage({ id: "msg-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "While minimized", created_at: "2026-02-01T10:00:00.000Z" });

    expect(screen.getByRole("button", { name: /new message/i })).toBeInTheDocument();
  });

  it("restoring after a minimized-unread message reconciles read state (marks read, refreshes the authoritative count)", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    markConversationReadIfUnreadMock.mockClear();
    rpcMock.mockClear();

    fireIncomingMessage({ id: "msg-1", conversation_id: "conv-1", sender_id: "other-user-1", body: "While minimized", created_at: "2026-02-01T10:00:00.000Z" });

    fireEvent.click(screen.getByRole("button", { name: /Restore chat/ }));

    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    // The pill's own local unread dot is cleared on restore too.
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    expect(screen.queryByRole("button", { name: /new message/i })).not.toBeInTheDocument();
  });

  it("restoring re-snaps to the latest message when the viewer was near the bottom before minimizing (Requirement D)", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());

    const container = screen.getByTestId("messages-scroll-container");
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    // Simulates a real browser's own behavior: scrollTop changes made
    // while an element is display:none don't take effect (jsdom itself
    // doesn't model this, so the test forces the same starting point by
    // hand) -- restoring should re-snap to the bottom regardless, since
    // the viewer was reading the latest messages before minimizing.
    container.scrollTop = 0;

    fireEvent.click(screen.getByRole("button", { name: /Restore chat/ }));

    expect(container.scrollTop).toBe(STUBBED_SCROLL_HEIGHT);
  });

  it("restoring does NOT force a scroll when the viewer had deliberately scrolled up before minimizing -- no jarring re-scroll, no loop", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());

    const container = screen.getByTestId("messages-scroll-container");
    container.scrollTop = 50; // 1000-50-400=550, not near bottom
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));
    fireEvent.click(screen.getByRole("button", { name: /Restore chat/ }));

    expect(container.scrollTop).toBe(50);
  });
});

describe("FloatingChatPanel -- desktop positioning (Issue 2: was flush against the bottom edge)", () => {
  it("the positioned wrapper sits a comfortable 24px off both the bottom and right edges, not flush against them", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());

    const wrapper = screen.getByRole("button", { name: "Minimize chat" }).closest("div.fixed");
    expect(wrapper?.className).toMatch(/bottom-6/);
    expect(wrapper?.className).toMatch(/right-6/);
    expect(wrapper?.className).not.toMatch(/\bbottom-0\b/);
  });

  it("the minimized pill uses the exact same offset as the expanded panel -- both are children of the one positioned wrapper, so there is nothing to keep in sync separately", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Minimize chat" }));

    const pill = screen.getByRole("button", { name: /Restore chat/ });
    const wrapper = pill.closest("div.fixed");
    expect(wrapper?.className).toMatch(/bottom-6/);
    expect(wrapper?.className).toMatch(/right-6/);
    // The pill itself is a direct child of that one positioned wrapper --
    // confirms there's no separate/duplicated offset for the minimized case.
    expect(pill.parentElement).toBe(wrapper);
  });

  it("remains hidden below the lg breakpoint (mobile is unaffected by this positioning change)", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());

    const wrapper = screen.getByRole("button", { name: "Minimize chat" }).closest("div.fixed");
    expect(wrapper?.className).toMatch(/\bhidden\b/);
    expect(wrapper?.className).toMatch(/lg:block/);
  });

  it("the panel's own width/height caps are unchanged -- only the edge offsets moved", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Minimize chat" })).toBeInTheDocument());

    const wrapper = screen.getByRole("button", { name: "Minimize chat" }).closest("div.fixed");
    expect(wrapper?.className).toMatch(/w-\[360px\]/);
    expect(wrapper?.className).toMatch(/max-w-\[calc\(100vw-3rem\)\]/);
  });
});
