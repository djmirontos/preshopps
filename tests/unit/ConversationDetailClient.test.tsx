import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { ConversationMessage } from "@/lib/messaging/get-conversation-messages";

const {
  sendMessageMock,
  markConversationReadMock,
  markConversationReadIfUnreadMock,
  markConversationUnreadMock,
  setConversationArchivedMock,
  setConversationMutedMock,
  submitReportMock,
  blockUserMock,
  unblockUserMock,
  channelOnCalls,
  channelNameCalls,
  subscribeMock,
  removeChannelMock,
  getSessionMock,
  rpcMock,
} = vi.hoisted(() => {
  const channelOnCalls: Array<{ event: string; config: { event: string; schema: string; table: string; filter: string }; callback: (payload: { new: unknown }) => void }> = [];
  const channelNameCalls: string[] = [];
  const subscribeMock = vi.fn();
  const removeChannelMock = vi.fn();
  return {
    sendMessageMock: vi.fn(),
    markConversationReadMock: vi.fn(),
    markConversationReadIfUnreadMock: vi.fn(),
    markConversationUnreadMock: vi.fn(),
    setConversationArchivedMock: vi.fn(),
    setConversationMutedMock: vi.fn(),
    submitReportMock: vi.fn(),
    blockUserMock: vi.fn(),
    unblockUserMock: vi.fn(),
    channelOnCalls,
    channelNameCalls,
    subscribeMock,
    removeChannelMock,
    // Only exercised by the "Realtime message subscription" describe
    // block below and the NotificationsProvider-wrapped badge tests --
    // ConversationDetailClient's OWN messages:<id> subscription
    // deliberately does not await getSession() (out of this task's
    // scope, see its own effect comment), so these two only matter when
    // a test wraps the component in a real NotificationsProvider, whose
    // subscription does.
    getSessionMock: vi.fn(),
    rpcMock: vi.fn(),
  };
});

/** Minimal fake channel: `.on()` records every registration (so tests can
 * grab the latest callback and invoke it directly to simulate an incoming
 * Realtime event), `.subscribe()` returns itself, matching the real
 * @supabase/supabase-js v2 channel builder API closely enough for this
 * component's own usage. */
function makeFakeChannel() {
  const fakeChannel = {
    on: vi.fn((event: string, config: never, callback: (payload: { new: unknown }) => void) => {
      channelOnCalls.push({ event, config: config as unknown as (typeof channelOnCalls)[number]["config"], callback });
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

vi.mock("@/lib/moderation/report-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/moderation/report-actions")>("@/lib/moderation/report-actions");
  return { ...actual, submitReport: submitReportMock };
});

vi.mock("@/lib/messaging/block-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messaging/block-actions")>("@/lib/messaging/block-actions");
  return { ...actual, blockUser: blockUserMock, unblockUser: unblockUserMock };
});

import { ConversationDetailClient } from "@/components/messaging/ConversationDetailClient";
import { NotificationsProvider, useUnreadMessageCount } from "@/components/notifications/NotificationsProvider";

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

/** Every previously-passing test keeps working unchanged behaviorally --
 * this just supplies the two new required block-related props
 * (otherPartyId/initialIsBlocked) with sane defaults so each existing
 * `render(...)` call site doesn't have to be individually retyped. */
function renderConversation(overrides: Partial<ComponentProps<typeof ConversationDetailClient>> = {}) {
  return render(
    <ConversationDetailClient
      context={sampleContext()}
      initialMessages={[]}
      initialCursor={null}
      loadEarlier={loadEarlierMock}
      otherPartyId="other-user-1"
      initialIsBlocked={false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadEarlierMock.mockReset();
  markConversationReadIfUnreadMock.mockResolvedValue({ ok: true });
  markConversationReadMock.mockResolvedValue({ ok: true });
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: 0, error: null });
});

/** Grabs the callback most recently registered specifically for the
 * messages table's INSERT subscription (filtered by table, not just "the
 * last one registered overall") so a test can invoke it directly to
 * simulate an incoming Realtime event without a real websocket -- some
 * tests below also wrap the component in a real NotificationsProvider,
 * whose own notifications:<id> subscription registers into this same
 * array (asynchronously, after its own getSession() resolves), so "last
 * overall" would be unreliable once both are present. */
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

describe("ConversationDetailClient -- composer", () => {
  it("disables Send while the draft is empty", () => {
    renderConversation();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("sends a message and appends it on a confirmed response", async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: "msg-new", createdAt: "2026-02-01T11:00:00.000Z" });
    renderConversation();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-1", "Hello!"));
    expect(await screen.findByText("Hello!")).toBeInTheDocument();
    // Draft clears after a confirmed send.
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("blocks sending an empty/whitespace-only message", () => {
    renderConversation();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("enforces the 4000-character max via the textarea's own maxLength", () => {
    renderConversation();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "x".repeat(5000) } });
    expect(textarea.value.length).toBe(4000);
  });

  it("guards against duplicate rapid clicks -- Send is disabled while a send is pending", async () => {
    let resolveSend: (value: unknown) => void = () => {};
    sendMessageMock.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    renderConversation();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    resolveSend({ ok: true, messageId: "msg-new", createdAt: "2026-02-01T11:00:00.000Z" });
  });

  it("shows a safe error message when send_message fails", async () => {
    sendMessageMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    renderConversation();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument());
  });

  it("hides the composer entirely and shows a restrained message when canSend is false", () => {
    renderConversation({ context: sampleContext({ canSend: false }) });
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
    expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument();
  });
});

describe("ConversationDetailClient -- message history", () => {
  it("renders existing history, preserved even in a blocked conversation", () => {
    renderConversation({
      context: sampleContext({ canSend: false }),
      initialMessages: [sampleMessage({ body: "This is history from before the block." })],
    });
    expect(screen.getByText("This is history from before the block.")).toBeInTheDocument();
  });

  it("shows the external-link safety warning under a message containing a URL, in plain text (never a clickable link)", () => {
    renderConversation({ initialMessages: [sampleMessage({ body: "Check this out: https://example.com/deal" })] });
    expect(screen.getByText(/external link — open carefully/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /example\.com/i })).not.toBeInTheDocument();
  });

  it("shows a Load earlier button when a cursor is present, and prepends the fetched page on click", async () => {
    loadEarlierMock.mockResolvedValue({
      messages: [sampleMessage({ messageId: "old-1", body: "An older message" })],
      hadError: false,
      nextCursor: null,
    });
    renderConversation({
      initialMessages: [sampleMessage({ messageId: "recent-1", body: "A recent message" })],
      initialCursor: { createdAt: "2026-02-01T09:00:00.000Z", id: "recent-1" },
    });

    fireEvent.click(screen.getByRole("button", { name: /load earlier/i }));
    await waitFor(() => expect(screen.getByText("An older message")).toBeInTheDocument());
    expect(screen.getByText("A recent message")).toBeInTheDocument();
  });
});

describe("ConversationDetailClient -- state controls", () => {
  it("toggles archive via a direct conversation_user_states update, not an RPC", async () => {
    setConversationArchivedMock.mockResolvedValue({ ok: true });
    renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Archive conversation" }));
    await waitFor(() => expect(setConversationArchivedMock).toHaveBeenCalledWith("conv-1", true));
  });

  it("toggles mute via a direct conversation_user_states update", async () => {
    setConversationMutedMock.mockResolvedValue({ ok: true });
    renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Mute conversation" }));
    await waitFor(() => expect(setConversationMutedMock).toHaveBeenCalledWith("conv-1", true));
  });

  it("marks the conversation unread via a direct conversation_user_states update", async () => {
    markConversationUnreadMock.mockResolvedValue({ ok: true });
    renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(markConversationUnreadMock).toHaveBeenCalledWith("conv-1"));
  });

  it("labels every state control for accessibility", () => {
    renderConversation();
    expect(screen.getByRole("button", { name: "Mute conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as unread" })).toBeInTheDocument();
  });
});

describe("ConversationDetailClient -- mark-read-on-open", () => {
  it("calls markConversationReadIfUnread with this conversation's id on mount", async () => {
    renderConversation();
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
  });

  it("calls it only once for the same mounted conversation, even across re-renders", async () => {
    const { rerender } = renderConversation();
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledTimes(1));

    // A re-render with the same conversationId (e.g. after sending a
    // message, which updates local `messages` state) must not re-trigger
    // the mark-read-on-open effect.
    rerender(
      <ConversationDetailClient
        context={sampleContext()}
        initialMessages={[{ messageId: "m1", isMine: true, body: "hi", createdAt: "2026-02-01T10:00:00.000Z" }]}
        initialCursor={null}
        loadEarlier={loadEarlierMock}
        otherPartyId="other-user-1"
        initialIsBlocked={false}
      />,
    );
    expect(markConversationReadIfUnreadMock).toHaveBeenCalledTimes(1);
  });

  it("calls it again when navigating to a different conversation (new conversationId)", async () => {
    const { rerender } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));

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
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-2"));
    expect(markConversationReadIfUnreadMock).toHaveBeenCalledTimes(2);
  });

  it("never sends a message and never touches archive/mute as a side effect of opening", async () => {
    renderConversation({ context: sampleContext({ isArchived: true, isMuted: true }) });
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalled());

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(setConversationArchivedMock).not.toHaveBeenCalled();
    expect(setConversationMutedMock).not.toHaveBeenCalled();
    // The archived/muted icon-button state still reflects what was passed in.
    expect(screen.getByRole("button", { name: "Unmute conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unarchive conversation" })).toBeInTheDocument();
  });

  it("still opens and marks read a blocked (can_send: false) conversation, with history visible", async () => {
    renderConversation({
      context: sampleContext({ canSend: false }),
      initialMessages: [{ messageId: "m1", isMine: false, body: "Old message before block", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
    expect(screen.getByText("Old message before block")).toBeInTheDocument();
    expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument();
  });

  it("manual Mark unread still works after the mount auto-mark-read call", async () => {
    markConversationUnreadMock.mockResolvedValue({ ok: true });
    renderConversation();

    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));

    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(markConversationUnreadMock).toHaveBeenCalledWith("conv-1"));
  });
});

describe("ConversationDetailClient -- conversation report (PRD 31)", () => {
  it("renders a single restrained Report action in the header, targeting this exact conversation", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-77" }) });
    expect(screen.getByRole("button", { name: "Report conversation" })).toBeInTheDocument();
  });

  it("submits with targetType conversation and the exact conversation id -- never a message id", async () => {
    submitReportMock.mockResolvedValue({ ok: true, reportId: "report-1", createdAt: "now" });
    renderConversation({ context: sampleContext({ conversationId: "conv-77" }) });

    fireEvent.click(screen.getByRole("button", { name: "Report conversation" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "harassment" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }));

    await waitFor(() => expect(submitReportMock).toHaveBeenCalledWith("conversation", "conv-77", "harassment", null));
  });

  it("is always treated as authenticated -- this page already redirects a guest before ever mounting", () => {
    renderConversation();
    fireEvent.click(screen.getByRole("button", { name: "Report conversation" }));
    // An authenticated caller goes straight to the reason dialog, never the sign-in gate.
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
  });

  it("does not add a report affordance beside every message -- exactly one appears, in the header", () => {
    renderConversation({
      initialMessages: [sampleMessage({ messageId: "m1" }), sampleMessage({ messageId: "m2" }), sampleMessage({ messageId: "m3" })],
    });
    expect(screen.getAllByRole("button", { name: "Report conversation" })).toHaveLength(1);
  });
});

describe("ConversationDetailClient -- Block / Unblock (PRD 30)", () => {
  it("shows a Block action when not currently blocked", () => {
    renderConversation({ initialIsBlocked: false });
    expect(screen.getByRole("button", { name: /^Block this/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Block this/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows an Unblock action when already blocked", () => {
    renderConversation({ initialIsBlocked: true });
    expect(screen.getByRole("button", { name: /^Unblock this/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Unblock this/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("labels the action using the other party's role -- 'seller' when viewing as the initiator", () => {
    renderConversation({ context: sampleContext({ viewerRole: "initiator" }), initialIsBlocked: false });
    expect(screen.getByRole("button", { name: "Block this seller" })).toBeInTheDocument();
  });

  it("labels the action using the other party's role -- 'buyer' when viewing as the seller", () => {
    renderConversation({ context: sampleContext({ viewerRole: "seller" }), initialIsBlocked: false });
    expect(screen.getByRole("button", { name: "Block this buyer" })).toBeInTheDocument();
  });

  it("Block requires confirmation -- clicking it opens a dialog rather than calling block_user immediately", () => {
    renderConversation({ initialIsBlocked: false });
    fireEvent.click(screen.getByRole("button", { name: /^Block this/ }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(blockUserMock).not.toHaveBeenCalled();
  });

  it("confirming Block calls block_user with the other party's id and flips the UI to Unblock", async () => {
    blockUserMock.mockResolvedValue({ ok: true, blockedId: "other-user-1", createdAt: "now" });
    renderConversation({ otherPartyId: "other-user-1", initialIsBlocked: false });

    fireEvent.click(screen.getByRole("button", { name: /^Block this/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));

    await waitFor(() => expect(blockUserMock).toHaveBeenCalledWith("other-user-1"));
    expect(await screen.findByRole("button", { name: /^Unblock this/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cancel on the block confirmation closes the dialog without calling block_user", () => {
    renderConversation({ initialIsBlocked: false });
    fireEvent.click(screen.getByRole("button", { name: /^Block this/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(blockUserMock).not.toHaveBeenCalled();
  });

  it("shows a friendly error and keeps the confirmation dialog open if block_user fails", async () => {
    blockUserMock.mockResolvedValue({ ok: false, code: "USER_NOT_FOUND" });
    renderConversation({ initialIsBlocked: false });

    fireEvent.click(screen.getByRole("button", { name: /^Block this/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));

    expect(await screen.findByText(/couldn't find this user/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Unblock is direct -- no confirmation dialog -- and calls unblock_user immediately", async () => {
    unblockUserMock.mockResolvedValue({ ok: true });
    renderConversation({ otherPartyId: "other-user-1", initialIsBlocked: true });

    fireEvent.click(screen.getByRole("button", { name: /^Unblock this/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(unblockUserMock).toHaveBeenCalledWith("other-user-1"));
    expect(await screen.findByRole("button", { name: /^Block this/ })).toBeInTheDocument();
  });

  it("shows a friendly error, without a dialog, if unblock_user fails", async () => {
    unblockUserMock.mockResolvedValue({ ok: false, code: "NOT_AUTHENTICATED" });
    renderConversation({ initialIsBlocked: true });

    fireEvent.click(screen.getByRole("button", { name: /^Unblock this/ }));

    expect(await screen.findByText(/please sign in/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("existing message history remains visible immediately after blocking -- no history is cleared client-side", async () => {
    blockUserMock.mockResolvedValue({ ok: true, blockedId: "other-user-1", createdAt: "now" });
    renderConversation({
      initialMessages: [sampleMessage({ body: "A message from before the block" })],
      initialIsBlocked: false,
    });

    fireEvent.click(screen.getByRole("button", { name: /^Block this/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

    await waitFor(() => expect(blockUserMock).toHaveBeenCalled());
    expect(screen.getByText("A message from before the block")).toBeInTheDocument();
  });

  it("the composer hides immediately after a confirmed Block, even though context.canSend was true at page load", async () => {
    blockUserMock.mockResolvedValue({ ok: true, blockedId: "other-user-1", createdAt: "now" });
    renderConversation({ context: sampleContext({ canSend: true }), initialIsBlocked: false });

    expect(screen.getByLabelText("Message")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Block this/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

    await waitFor(() => expect(screen.queryByLabelText("Message")).not.toBeInTheDocument());
    expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument();
  });

  it("the composer reappears after Unblock restores allowed interaction, when the original context already allowed sending", async () => {
    unblockUserMock.mockResolvedValue({ ok: true });
    renderConversation({ context: sampleContext({ canSend: true }), initialIsBlocked: true });

    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Unblock this/ }));

    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
  });

  it("never calls submitReport as a side effect of blocking -- blocking is not an automatic report", async () => {
    blockUserMock.mockResolvedValue({ ok: true, blockedId: "other-user-1", createdAt: "now" });
    renderConversation({ initialIsBlocked: false });

    fireEvent.click(screen.getByRole("button", { name: /^Block this/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

    await waitFor(() => expect(blockUserMock).toHaveBeenCalled());
    expect(submitReportMock).not.toHaveBeenCalled();
  });
});

describe("ConversationDetailClient -- Realtime message subscription", () => {
  it("subscribes to postgres_changes INSERT on messages, filtered to this conversation's id", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });

    expect(channelNameCalls).toContain("messages:conv-1");
    const registration = channelOnCalls[channelOnCalls.length - 1];
    expect(registration.event).toBe("postgres_changes");
    expect(registration.config).toMatchObject({
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: "conversation_id=eq.conv-1",
    });
    expect(subscribeMock).toHaveBeenCalled();
  });

  it("removes the channel on unmount", () => {
    const { unmount } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });
    unmount();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("removes the old channel and opens a new one filtered to the new conversation when conversationId changes", () => {
    const { rerender } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }) });
    expect(channelNameCalls).toContain("messages:conv-1");

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

    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(channelNameCalls).toContain("messages:conv-2");
  });

  it("appends an incoming INSERT immediately, without refetching the whole thread", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });

    fireIncomingMessage({
      id: "msg-realtime-1",
      conversation_id: "conv-1",
      sender_id: "other-user-1",
      body: "Hello from realtime",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    expect(screen.getByText("Hello from realtime")).toBeInTheDocument();
  });

  it("derives isMine from sender_id vs otherPartyId -- a message from the other party renders on the left", () => {
    const { container } = renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });

    fireIncomingMessage({
      id: "msg-theirs",
      conversation_id: "conv-1",
      sender_id: "other-user-1",
      body: "Their message",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    const item = screen.getByText("Their message").closest("li");
    expect(item?.className).toContain("justify-start");
    void container;
  });

  it("a message NOT from otherPartyId renders as mine, on the right", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });

    fireIncomingMessage({
      id: "msg-mine-echo",
      conversation_id: "conv-1",
      sender_id: "some-other-session-of-mine",
      body: "My own echoed message",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    const item = screen.getByText("My own echoed message").closest("li");
    expect(item?.className).toContain("justify-end");
  });

  it("marks the conversation read when a new incoming (not-mine) message arrives while open, without any Seen UI", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });
    markConversationReadMock.mockClear();

    fireIncomingMessage({
      id: "msg-incoming",
      conversation_id: "conv-1",
      sender_id: "other-user-1",
      body: "Are you there?",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    expect(markConversationReadMock).toHaveBeenCalledWith("conv-1");
    expect(screen.queryByText(/seen/i)).not.toBeInTheDocument();
  });

  it("does not mark read for an incoming echo of the viewer's own message", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });
    markConversationReadMock.mockClear();

    fireIncomingMessage({
      id: "msg-own-echo",
      conversation_id: "conv-1",
      sender_id: "viewer-own-id",
      body: "Something I sent",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    expect(markConversationReadMock).not.toHaveBeenCalled();
  });

  it("RPC-returned message + a matching Realtime event for the same id renders exactly once", async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: "msg-dup", createdAt: "2026-02-01T11:00:00.000Z" });
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(await screen.findByText("Hello!")).toBeInTheDocument();

    fireIncomingMessage({
      id: "msg-dup",
      conversation_id: "conv-1",
      sender_id: "viewer-own-id",
      body: "Hello!",
      created_at: "2026-02-01T11:00:00.000Z",
    });

    expect(screen.getAllByText("Hello!")).toHaveLength(1);
  });

  it("Realtime-first, then a matching RPC response second, still renders exactly once (no timing assumption)", async () => {
    let resolveSend: (value: { ok: true; messageId: string; createdAt: string }) => void = () => {};
    sendMessageMock.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Race condition test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());

    // The Realtime broadcast for this same message arrives before the RPC
    // HTTP response does.
    fireIncomingMessage({
      id: "msg-race",
      conversation_id: "conv-1",
      sender_id: "viewer-own-id",
      body: "Race condition test",
      created_at: "2026-02-01T11:05:00.000Z",
    });
    // Scoped to the message-bubble <p> only -- the still-unsent-cleared
    // composer textarea also legitimately contains this exact text at
    // this point in the race, which is not what this assertion means to
    // count.
    expect(screen.getAllByText("Race condition test", { selector: "p" })).toHaveLength(1);

    resolveSend({ ok: true, messageId: "msg-race", createdAt: "2026-02-01T11:05:00.000Z" });
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
    expect(screen.getAllByText("Race condition test", { selector: "p" })).toHaveLength(1);
  });

  it("multiple incoming messages preserve chronological order", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });

    fireIncomingMessage({ id: "m1", conversation_id: "conv-1", sender_id: "other-user-1", body: "First", created_at: "2026-02-01T12:00:00.000Z" });
    fireIncomingMessage({ id: "m2", conversation_id: "conv-1", sender_id: "viewer-own-id", body: "Second", created_at: "2026-02-01T12:01:00.000Z" });
    fireIncomingMessage({ id: "m3", conversation_id: "conv-1", sender_id: "other-user-1", body: "Third", created_at: "2026-02-01T12:02:00.000Z" });

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    const firstIndex = items.findIndex((text) => text?.includes("First"));
    const secondIndex = items.findIndex((text) => text?.includes("Second"));
    const thirdIndex = items.findIndex((text) => text?.includes("Third"));
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  it("a message for a different conversation_id is ignored -- defense in depth alongside the server-side filter", () => {
    renderConversation({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" });

    fireIncomingMessage({
      id: "msg-unrelated",
      conversation_id: "conv-999",
      sender_id: "other-user-1",
      body: "This belongs to a different conversation",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    expect(screen.queryByText("This belongs to a different conversation")).not.toBeInTheDocument();
  });
});

/** Wraps ConversationDetailClient in a real, live NotificationsProvider
 * (same fake createClient() as the rest of this file, extended with
 * auth.getSession/rpc) plus a small probe reading unreadMessageCount --
 * proves the "authoritative recalculation, not a local guess" behavior
 * end-to-end: mark-read really does trigger a get_my_conversations
 * refetch that updates the shared Messages badge count. */
function UnreadMessageCountProbe() {
  const count = useUnreadMessageCount();
  return <p data-testid="probe-message-count">{count}</p>;
}

function renderConversationWithProvider(overrides: Partial<ComponentProps<typeof ConversationDetailClient>> = {}, initialUnreadMessageCount = 5) {
  return render(
    <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={initialUnreadMessageCount} initialUnreadNotificationCount={0}>
      <UnreadMessageCountProbe />
      <ConversationDetailClient
        context={sampleContext()}
        initialMessages={[]}
        initialCursor={null}
        loadEarlier={loadEarlierMock}
        otherPartyId="other-user-1"
        initialIsBlocked={false}
        {...overrides}
      />
    </NotificationsProvider>,
  );
}

describe("ConversationDetailClient -- Messages badge recalculation (authoritative, not guessed)", () => {
  it("recalculates unreadMessageCount from the server after the mount-time mark-read-if-unread completes", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderConversationWithProvider({ context: sampleContext({ conversationId: "conv-1" }) }, 99);

    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
    await waitFor(() => expect(screen.getByTestId("probe-message-count")).toHaveTextContent("1"));
    expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count");
  });

  it("does not simply zero the badge -- other unread conversations remain counted after recalculation", async () => {
    // Three still-unread conversations remain even after this one was
    // just read -- the recalculation must reflect all of them, not
    // pretend everything is now read.
    rpcMock.mockResolvedValue({ data: 3, error: null });
    renderConversationWithProvider({ context: sampleContext({ conversationId: "conv-1" }) }, 99);

    await waitFor(() => expect(screen.getByTestId("probe-message-count")).toHaveTextContent("3"));
  });

  it("recalculates the Messages badge again when an incoming (not-mine) message is marked read while the thread is open", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    renderConversationWithProvider({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" }, 5);

    await waitFor(() => expect(screen.getByTestId("probe-message-count")).toHaveTextContent("0"));

    // A second, still-unread conversation now exists by the time this
    // message arrives and gets marked read.
    rpcMock.mockResolvedValue({ data: 1, error: null });

    fireIncomingMessage({
      id: "msg-incoming",
      conversation_id: "conv-1",
      sender_id: "other-user-1",
      body: "Are you there?",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    await waitFor(() => expect(screen.getByTestId("probe-message-count")).toHaveTextContent("1"));
  });

  it("never recalculates for an incoming echo of the viewer's own message (no mark-read happens for it)", async () => {
    renderConversationWithProvider({ context: sampleContext({ conversationId: "conv-1" }), otherPartyId: "other-user-1" }, 5);
    await waitFor(() => expect(screen.getByTestId("probe-message-count")).toHaveTextContent("0")); // mount-time recalculation already ran
    rpcMock.mockClear();

    fireIncomingMessage({
      id: "msg-own-echo",
      conversation_id: "conv-1",
      sender_id: "viewer-own-id",
      body: "Something I sent",
      created_at: "2026-02-01T12:00:00.000Z",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
