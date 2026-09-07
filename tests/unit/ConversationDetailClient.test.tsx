import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { ConversationMessage } from "@/lib/messaging/get-conversation-messages";

const {
  sendMessageMock,
  markConversationReadIfUnreadMock,
  markConversationUnreadMock,
  setConversationArchivedMock,
  setConversationMutedMock,
} = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  markConversationReadIfUnreadMock: vi.fn(),
  markConversationUnreadMock: vi.fn(),
  setConversationArchivedMock: vi.fn(),
  setConversationMutedMock: vi.fn(),
}));

vi.mock("@/lib/messaging/send-message", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messaging/send-message")>("@/lib/messaging/send-message");
  return { ...actual, sendMessage: sendMessageMock };
});

vi.mock("@/lib/messaging/conversation-state", () => ({
  markConversationReadIfUnread: markConversationReadIfUnreadMock,
  markConversationUnread: markConversationUnreadMock,
  setConversationArchived: setConversationArchivedMock,
  setConversationMuted: setConversationMutedMock,
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  loadEarlierMock.mockReset();
  markConversationReadIfUnreadMock.mockResolvedValue({ ok: true });
});

describe("ConversationDetailClient -- composer", () => {
  it("disables Send while the draft is empty", () => {
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("sends a message and appends it on a confirmed response", async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: "msg-new", createdAt: "2026-02-01T11:00:00.000Z" });
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-1", "Hello!"));
    expect(await screen.findByText("Hello!")).toBeInTheDocument();
    // Draft clears after a confirmed send.
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("blocks sending an empty/whitespace-only message", () => {
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("enforces the 4000-character max via the textarea's own maxLength", () => {
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "x".repeat(5000) } });
    expect(textarea.value.length).toBe(4000);
  });

  it("guards against duplicate rapid clicks -- Send is disabled while a send is pending", async () => {
    let resolveSend: (value: unknown) => void = () => {};
    sendMessageMock.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    resolveSend({ ok: true, messageId: "msg-new", createdAt: "2026-02-01T11:00:00.000Z" });
  });

  it("shows a safe error message when send_message fails", async () => {
    sendMessageMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument());
  });

  it("hides the composer entirely and shows a restrained message when canSend is false", () => {
    render(<ConversationDetailClient context={sampleContext({ canSend: false })} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
    expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument();
  });
});

describe("ConversationDetailClient -- message history", () => {
  it("renders existing history, preserved even in a blocked conversation", () => {
    render(
      <ConversationDetailClient
        context={sampleContext({ canSend: false })}
        initialMessages={[sampleMessage({ body: "This is history from before the block." })]}
        initialCursor={null}
        loadEarlier={loadEarlierMock}
      />,
    );
    expect(screen.getByText("This is history from before the block.")).toBeInTheDocument();
  });

  it("shows the external-link safety warning under a message containing a URL, in plain text (never a clickable link)", () => {
    render(
      <ConversationDetailClient
        context={sampleContext()}
        initialMessages={[sampleMessage({ body: "Check this out: https://example.com/deal" })]}
        initialCursor={null}
        loadEarlier={loadEarlierMock}
      />,
    );
    expect(screen.getByText(/external link — open carefully/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /example\.com/i })).not.toBeInTheDocument();
  });

  it("shows a Load earlier button when a cursor is present, and prepends the fetched page on click", async () => {
    loadEarlierMock.mockResolvedValue({
      messages: [sampleMessage({ messageId: "old-1", body: "An older message" })],
      hadError: false,
      nextCursor: null,
    });
    render(
      <ConversationDetailClient
        context={sampleContext()}
        initialMessages={[sampleMessage({ messageId: "recent-1", body: "A recent message" })]}
        initialCursor={{ createdAt: "2026-02-01T09:00:00.000Z", id: "recent-1" }}
        loadEarlier={loadEarlierMock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load earlier/i }));
    await waitFor(() => expect(screen.getByText("An older message")).toBeInTheDocument());
    expect(screen.getByText("A recent message")).toBeInTheDocument();
  });
});

describe("ConversationDetailClient -- state controls", () => {
  it("toggles archive via a direct conversation_user_states update, not an RPC", async () => {
    setConversationArchivedMock.mockResolvedValue({ ok: true });
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive conversation" }));
    await waitFor(() => expect(setConversationArchivedMock).toHaveBeenCalledWith("conv-1", true));
  });

  it("toggles mute via a direct conversation_user_states update", async () => {
    setConversationMutedMock.mockResolvedValue({ ok: true });
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);

    fireEvent.click(screen.getByRole("button", { name: "Mute conversation" }));
    await waitFor(() => expect(setConversationMutedMock).toHaveBeenCalledWith("conv-1", true));
  });

  it("marks the conversation unread via a direct conversation_user_states update", async () => {
    markConversationUnreadMock.mockResolvedValue({ ok: true });
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(markConversationUnreadMock).toHaveBeenCalledWith("conv-1"));
  });

  it("labels every state control for accessibility", () => {
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);
    expect(screen.getByRole("button", { name: "Mute conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as unread" })).toBeInTheDocument();
  });
});

describe("ConversationDetailClient -- mark-read-on-open", () => {
  it("calls markConversationReadIfUnread with this conversation's id on mount", async () => {
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
  });

  it("calls it only once for the same mounted conversation, even across re-renders", async () => {
    const { rerender } = render(
      <ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />,
    );
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
      />,
    );
    expect(markConversationReadIfUnreadMock).toHaveBeenCalledTimes(1);
  });

  it("calls it again when navigating to a different conversation (new conversationId)", async () => {
    const { rerender } = render(
      <ConversationDetailClient context={sampleContext({ conversationId: "conv-1" })} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />,
    );
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));

    rerender(
      <ConversationDetailClient context={sampleContext({ conversationId: "conv-2" })} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />,
    );
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-2"));
    expect(markConversationReadIfUnreadMock).toHaveBeenCalledTimes(2);
  });

  it("never sends a message and never touches archive/mute as a side effect of opening", async () => {
    render(<ConversationDetailClient context={sampleContext({ isArchived: true, isMuted: true })} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);
    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalled());

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(setConversationArchivedMock).not.toHaveBeenCalled();
    expect(setConversationMutedMock).not.toHaveBeenCalled();
    // The archived/muted icon-button state still reflects what was passed in.
    expect(screen.getByRole("button", { name: "Unmute conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unarchive conversation" })).toBeInTheDocument();
  });

  it("still opens and marks read a blocked (can_send: false) conversation, with history visible", async () => {
    render(
      <ConversationDetailClient
        context={sampleContext({ canSend: false })}
        initialMessages={[{ messageId: "m1", isMine: false, body: "Old message before block", createdAt: "2026-01-01T00:00:00.000Z" }]}
        initialCursor={null}
        loadEarlier={loadEarlierMock}
      />,
    );

    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));
    expect(screen.getByText("Old message before block")).toBeInTheDocument();
    expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument();
  });

  it("manual Mark unread still works after the mount auto-mark-read call", async () => {
    markConversationUnreadMock.mockResolvedValue({ ok: true });
    render(<ConversationDetailClient context={sampleContext()} initialMessages={[]} initialCursor={null} loadEarlier={loadEarlierMock} />);

    await waitFor(() => expect(markConversationReadIfUnreadMock).toHaveBeenCalledWith("conv-1"));

    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(markConversationUnreadMock).toHaveBeenCalledWith("conv-1"));
  });
});
