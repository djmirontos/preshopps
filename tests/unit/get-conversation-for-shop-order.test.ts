import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { getConversationForShopOrder } from "@/lib/messaging/get-conversation-for-shop-order";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getConversationForShopOrder", () => {
  it("calls get_conversation_for_shop_order with only the order public code", async () => {
    rpcMock.mockResolvedValue({ data: [{ conversation_id: "conv-1" }], error: null });
    await getConversationForShopOrder("PSO-ABC123");

    expect(rpcMock).toHaveBeenCalledWith("get_conversation_for_shop_order", {
      p_order_public_code: "PSO-ABC123",
    });
  });

  it("never sends any argument beyond the order public code -- no buyerId/shopId parameter exists", async () => {
    rpcMock.mockResolvedValue({ data: [{ conversation_id: "conv-1" }], error: null });
    await getConversationForShopOrder("PSO-ABC123");

    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args)).toEqual(["p_order_public_code"]);
  });

  it("returns the conversation id when one row is found", async () => {
    rpcMock.mockResolvedValue({ data: [{ conversation_id: "conv-1" }], error: null });
    const result = await getConversationForShopOrder("PSO-ABC123");

    expect(result).toEqual({ ok: true, conversationId: "conv-1" });
  });

  it("returns conversationId: null when zero rows are returned -- a normal 'no conversation yet' outcome, not an error", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getConversationForShopOrder("PSO-ABC123");

    expect(result).toEqual({ ok: true, conversationId: null });
  });

  it("maps an RPC error to the safe generic copy, never the raw message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation orders does not exist" } });
    const result = await getConversationForShopOrder("PSO-ABC123");

    expect(result).toEqual({ ok: false, error: "We couldn't open this conversation right now." });
  });

  it("maps a thrown network error to the same safe generic copy", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getConversationForShopOrder("PSO-ABC123");

    expect(result).toEqual({ ok: false, error: "We couldn't open this conversation right now." });
  });

  it("never returns a buyerId or shopId field under any outcome", async () => {
    rpcMock.mockResolvedValue({ data: [{ conversation_id: "conv-1" }], error: null });
    const okResult = await getConversationForShopOrder("PSO-ABC123");
    expect(okResult).not.toHaveProperty("buyerId");
    expect(okResult).not.toHaveProperty("shopId");

    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const errResult = await getConversationForShopOrder("PSO-ABC123");
    expect(errResult).not.toHaveProperty("buyerId");
    expect(errResult).not.toHaveProperty("shopId");
  });
});
