import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { ConversationSummary, GetMyConversationsResult } from "@/lib/messaging/get-my-conversations";

const { getAuthUserMock, getMyConversationsMock, redirectMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyConversationsMock: vi.fn<() => Promise<GetMyConversationsResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/messaging/get-my-conversations", () => ({
  getMyConversations: getMyConversationsMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import MessagesPage from "@/app/messages/page";

function makeConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversationId: "11111111-1111-1111-1111-111111111111",
    conversationType: "listing_inquiry",
    viewerRole: "initiator",
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    shopLogoUrl: undefined,
    listingId: "listing-1",
    listingPublicCode: "PLS-AAA",
    listingTitle: "Uniqlo Shirt",
    listingImageUrl: undefined,
    otherPartyDisplayName: null,
    otherPartyAvatarUrl: undefined,
    lastMessageAt: "2026-02-01T10:00:00.000Z",
    lastMessagePreview: "Is this still available?",
    lastMessageIsMine: true,
    isUnread: false,
    isArchived: false,
    isMuted: false,
    ...overrides,
  };
}

function makeParams(view?: string) {
  return { searchParams: Promise.resolve(view ? { view } : {}) };
}

describe("MessagesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with next=/messages before fetching any conversation data", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(MessagesPage(makeParams())).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fmessages");
    expect(getMyConversationsMock).not.toHaveBeenCalled();
  });

  it("shows the empty state for an authenticated user with no conversations", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyConversationsMock.mockResolvedValue({ conversations: [], hadError: false, nextCursor: null });

    render(await MessagesPage(makeParams()));

    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
  });

  it("renders one h1 and the populated conversation list with shop identity and preview", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyConversationsMock.mockResolvedValue({ conversations: [makeConversation()], hadError: false, nextCursor: null });

    render(await MessagesPage(makeParams()));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Messages" })).toBeInTheDocument();
    expect(screen.getByText("Anne's Closet")).toBeInTheDocument();
    expect(screen.getByText(/is this still available/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Anne's Closet/ })).toHaveAttribute(
      "href",
      "/messages/11111111-1111-1111-1111-111111111111",
    );
  });

  it("shows listing context (Re: <title>) for a listing-linked conversation", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyConversationsMock.mockResolvedValue({ conversations: [makeConversation()], hadError: false, nextCursor: null });

    render(await MessagesPage(makeParams()));
    expect(screen.getByText(/re: uniqlo shirt/i)).toBeInTheDocument();
  });

  it("visually distinguishes an unread conversation without relying on color alone (bold text plus a dot)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyConversationsMock.mockResolvedValue({
      conversations: [makeConversation({ isUnread: true, lastMessageIsMine: false })],
      hadError: false,
      nextCursor: null,
    });

    render(await MessagesPage(makeParams()));
    // Bold identity name is the semantic/visual unread signal; sr-only text
    // makes it available to assistive tech too, satisfying "not color only".
    expect(screen.getByText("Anne's Closet")).toHaveClass("font-semibold");
    expect(screen.getByText("(unread)", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("requests the archived view via get_my_conversations(archived=true) when ?view=archived", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyConversationsMock.mockResolvedValue({ conversations: [], hadError: false, nextCursor: null });

    render(await MessagesPage(makeParams("archived")));

    expect(getMyConversationsMock).toHaveBeenCalledWith(20, undefined, true);
    expect(screen.getByText("No archived conversations.")).toBeInTheDocument();
  });

  it("never renders a raw conversation UUID as visible text", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyConversationsMock.mockResolvedValue({ conversations: [makeConversation()], hadError: false, nextCursor: null });

    render(await MessagesPage(makeParams()));
    expect(screen.queryByText(/11111111-1111-1111-1111-111111111111/)).not.toBeInTheDocument();
  });

  it("shows a safe error state (not a crash) when the RPC fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyConversationsMock.mockResolvedValue({ conversations: [], hadError: true, nextCursor: null });

    render(await MessagesPage(makeParams()));
    expect(screen.getByText(/unable to load your messages right now/i)).toBeInTheDocument();
  });
});
