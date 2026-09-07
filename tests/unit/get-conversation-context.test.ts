import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getConversationContext } from "@/lib/messaging/get-conversation-context";

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
    listing_status: "available",
    listing_cover_image_storage_path: null,
    other_party_display_name: null,
    other_party_avatar_storage_path: null,
    is_archived: false,
    is_muted: false,
    can_send: true,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getConversationContext", () => {
  it("calls get_conversation_context with only the conversation id (no client-supplied user id)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getConversationContext("conv-1");
    expect(rpcMock).toHaveBeenCalledWith("get_conversation_context", { p_conversation_id: "conv-1" });
  });

  it("returns not_found when the RPC returns zero rows (another user's conversation or nonexistent -- indistinguishable)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getConversationContext("conv-missing");
    expect(result).toEqual({ status: "not_found" });
  });

  it("maps a found row to ConversationContext", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getConversationContext("conv-1");
    expect(result).toEqual({
      status: "found",
      context: {
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
      },
    });
  });

  it("surfaces can_send: false when the backend reports the interaction is blocked", async () => {
    rpcMock.mockResolvedValue({ data: [row({ can_send: false })], error: null });
    const result = await getConversationContext("conv-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.context.canSend).toBe(false);
  });

  it("returns status: error on an RPC error, distinct from not_found", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getConversationContext("conv-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns status: error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getConversationContext("conv-1");
    expect(result).toEqual({ status: "error" });
  });
});
