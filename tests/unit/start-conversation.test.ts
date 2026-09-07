import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { startConversation } from "@/lib/messaging/start-conversation";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("startConversation", () => {
  it("calls start_conversation with shop id, body, and listing id (no client-supplied sender/initiator id)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    await startConversation("shop-1", "Is this still available?", "listing-1");
    expect(rpcMock).toHaveBeenCalledWith("start_conversation", {
      p_shop_id: "shop-1",
      p_body: "Is this still available?",
      p_listing_id: "listing-1",
    });
  });

  it("passes null listing id for a general shop inquiry", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    await startConversation("shop-1", "Do you ship internationally?");
    expect(rpcMock).toHaveBeenCalledWith("start_conversation", {
      p_shop_id: "shop-1",
      p_body: "Do you ship internationally?",
      p_listing_id: null,
    });
  });

  it("never sends any argument beyond shop id, body, and listing id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    await startConversation("shop-1", "hi");
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_listing_id", "p_shop_id"]);
  });

  it("maps CANNOT_MESSAGE_OWN_SHOP", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "CANNOT_MESSAGE_OWN_SHOP" } });
    const result = await startConversation("shop-1", "hi");
    expect(result).toEqual({ ok: false, code: "CANNOT_MESSAGE_OWN_SHOP" });
  });

  it("maps LISTING_NOT_MESSAGEABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "LISTING_NOT_MESSAGEABLE" } });
    const result = await startConversation("shop-1", "hi", "listing-1");
    expect(result).toEqual({ ok: false, code: "LISTING_NOT_MESSAGEABLE" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await startConversation("shop-1", "hi");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await startConversation("shop-1", "hi");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns the conversation id and created flag on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: false }],
      error: null,
    });
    const result = await startConversation("shop-1", "another message");
    expect(result).toEqual({ ok: true, conversationId: "conv-1", conversationCreated: false });
  });
});
