import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyConversations } from "@/lib/messaging/get-my-conversations";

function row(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: "conv-1",
    conversation_type: "listing_inquiry",
    viewer_role: "initiator",
    shop_id: "shop-1",
    shop_slug: "annes-closet",
    shop_name: "Anne's Closet",
    shop_logo_storage_path: null,
    listing_id: "listing-1",
    listing_public_code: "PLS-AAA",
    listing_title: "Uniqlo Shirt",
    listing_cover_image_storage_path: null,
    other_party_display_name: null,
    other_party_avatar_storage_path: null,
    last_message_at: "2026-02-01T10:00:00.000Z",
    last_message_preview: "Is this still available?",
    last_message_is_mine: true,
    is_unread: false,
    is_archived: false,
    is_muted: false,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyConversations", () => {
  it("calls get_my_conversations with the limit, null cursor, and archived flag on first page (no client-supplied user id)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getMyConversations(20);
    expect(rpcMock).toHaveBeenCalledWith("get_my_conversations", {
      p_limit: 20,
      p_before_last_message_at: null,
      p_before_id: null,
      p_archived: false,
    });
  });

  it("passes archived=true through when requested", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyConversations(20, undefined, true);
    expect(rpcMock).toHaveBeenCalledWith("get_my_conversations", {
      p_limit: 20,
      p_before_last_message_at: null,
      p_before_id: null,
      p_archived: true,
    });
  });

  it("passes the cursor through on subsequent pages", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyConversations(20, { lastMessageAt: "2026-01-01T00:00:00.000Z", id: "conv-5" });
    expect(rpcMock).toHaveBeenCalledWith("get_my_conversations", {
      p_limit: 20,
      p_before_last_message_at: "2026-01-01T00:00:00.000Z",
      p_before_id: "conv-5",
      p_archived: false,
    });
  });

  it("maps rows to ConversationSummary", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyConversations(20);
    expect(result.hadError).toBe(false);
    expect(result.conversations).toEqual([
      {
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
        listingImageUrl: undefined,
        otherPartyDisplayName: null,
        otherPartyAvatarUrl: undefined,
        lastMessageAt: "2026-02-01T10:00:00.000Z",
        lastMessagePreview: "Is this still available?",
        lastMessageIsMine: true,
        isUnread: false,
        isArchived: false,
        isMuted: false,
      },
    ]);
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ conversation_id: "c1", last_message_at: "2026-02-01T00:00:00.000Z" }), row({ conversation_id: "c2", last_message_at: "2026-01-30T00:00:00.000Z" })],
      error: null,
    });
    const result = await getMyConversations(2);
    expect(result.nextCursor).toEqual({ lastMessageAt: "2026-01-30T00:00:00.000Z", id: "c2" });
  });

  it("returns nextCursor: null when fewer rows than the limit come back (last page)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyConversations(20);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError true, empty conversations, on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyConversations(20);
    expect(result).toEqual({ conversations: [], hadError: true, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyConversations(20);
    expect(result).toEqual({ conversations: [], hadError: true, nextCursor: null });
  });
});
