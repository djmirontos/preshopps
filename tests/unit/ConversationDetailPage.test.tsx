import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { ConversationContext, ConversationContextResult } from "@/lib/messaging/get-conversation-context";
import type { GetConversationMessagesResult } from "@/lib/messaging/get-conversation-messages";
import type { ConversationBlockStateResult } from "@/lib/messaging/get-conversation-block-state";

const {
  getAuthUserMock,
  getConversationContextMock,
  getConversationMessagesMock,
  getConversationBlockStateMock,
  redirectMock,
  notFoundMock,
  refreshMock,
} = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getConversationContextMock: vi.fn<(id: string) => Promise<ConversationContextResult>>(),
  getConversationMessagesMock: vi.fn<() => Promise<GetConversationMessagesResult>>(),
  getConversationBlockStateMock: vi.fn<(id: string) => Promise<ConversationBlockStateResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/messaging/get-conversation-context", () => ({
  getConversationContext: getConversationContextMock,
}));

vi.mock("@/lib/messaging/get-conversation-messages", () => ({
  getConversationMessages: getConversationMessagesMock,
}));

vi.mock("@/lib/messaging/get-conversation-block-state", () => ({
  getConversationBlockState: getConversationBlockStateMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
  useRouter: () => ({ refresh: refreshMock }),
}));

import ConversationDetailPage from "@/app/messages/[conversationId]/page";

const params = Promise.resolve({ conversationId: "conv-1" });

function sampleContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationId: "conv-1",
    conversationType: "listing_inquiry",
    viewerRole: "initiator",
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    shopLogoUrl: undefined,
    listingId: "listing-1",
    listingPublicCode: "PLS-AAA",
    listingTitle: "Uniqlo Shirt",
    listingStatus: "available",
    listingImageUrl: undefined,
    otherPartyDisplayName: null,
    otherPartyAvatarUrl: undefined,
    isArchived: false,
    isMuted: false,
    canSend: true,
    ...overrides,
  };
}

describe("ConversationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversationMessagesMock.mockResolvedValue({ messages: [], hadError: false, nextCursor: null });
    getConversationBlockStateMock.mockResolvedValue({ status: "found", state: { otherPartyId: "other-user-1", isBlockedByViewer: false } });
  });

  it("redirects a guest to sign-in with the conversation's own path preserved as next=", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(ConversationDetailPage({ params })).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?next=${encodeURIComponent("/messages/conv-1")}`,
    );
    expect(getConversationContextMock).not.toHaveBeenCalled();
  });

  it("renders the header identity and listing context for the caller's own conversation", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getConversationContextMock.mockResolvedValue({ status: "found", context: sampleContext() });

    render(await ConversationDetailPage({ params }));

    expect(screen.getByRole("heading", { level: 1, name: "Anne's Closet" })).toBeInTheDocument();
    expect(screen.getByText("Uniqlo Shirt")).toBeInTheDocument();
  });

  it("calls Next's notFound() for another user's conversation, identical to a nonexistent one", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getConversationContextMock.mockResolvedValue({ status: "not_found" });

    await expect(ConversationDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("shows a safe error state (not a crash) on a backend read failure", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getConversationContextMock.mockResolvedValue({ status: "error" });

    render(await ConversationDetailPage({ params }));
    expect(screen.getByText(/unable to load this conversation right now/i)).toBeInTheDocument();
  });

  it("never renders a raw conversation/shop/listing UUID as visible text", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getConversationContextMock.mockResolvedValue({ status: "found", context: sampleContext() });

    render(await ConversationDetailPage({ params }));
    expect(screen.queryByText(/conv-1|shop-1|listing-1/)).not.toBeInTheDocument();
  });

  it("disables the composer and shows a restrained message when the backend reports the interaction as blocked", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getConversationContextMock.mockResolvedValue({ status: "found", context: sampleContext({ canSend: false }) });

    render(await ConversationDetailPage({ params }));
    expect(screen.getByText("You can't send messages in this conversation.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });

  it("shows Unblock when get_conversation_block_state reports the viewer already blocked the other party", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getConversationContextMock.mockResolvedValue({ status: "found", context: sampleContext() });
    getConversationBlockStateMock.mockResolvedValue({ status: "found", state: { otherPartyId: "other-user-1", isBlockedByViewer: true } });

    render(await ConversationDetailPage({ params }));
    expect(screen.getByRole("button", { name: /^Unblock this/ })).toBeInTheDocument();
  });

  it("shows Block (not Unblock) as a safe fallback if block-state resolution fails while context still succeeds", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getConversationContextMock.mockResolvedValue({ status: "found", context: sampleContext() });
    getConversationBlockStateMock.mockResolvedValue({ status: "error" });

    render(await ConversationDetailPage({ params }));
    expect(screen.getByRole("button", { name: /^Block this/ })).toBeInTheDocument();
  });
});
