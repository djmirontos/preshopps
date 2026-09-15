import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { startConversationFromOrder } from "@/lib/messaging/start-conversation-from-order";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("startConversationFromOrder", () => {
  it("calls start_conversation_from_order with the order public code and body only", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    await startConversationFromOrder("PSO-ABC123", "Your order is ready for pickup!");

    expect(rpcMock).toHaveBeenCalledWith("start_conversation_from_order", {
      p_order_public_code: "PSO-ABC123",
      p_body: "Your order is ready for pickup!",
    });
  });

  it("never sends any argument beyond the order public code and body -- no buyerId/shopId/conversationId parameter exists", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    await startConversationFromOrder("PSO-ABC123", "hi");

    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_order_public_code"]);
  });

  it("returns conversationId/messageId/createdAt/conversationCreated on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({
      ok: true,
      conversationId: "conv-1",
      messageId: "msg-1",
      createdAt: "2026-01-05T00:00:00.000Z",
      conversationCreated: true,
    });
  });

  it("maps ORDER_NOT_FOUND to the safe 'couldn't open this conversation' copy, never revealing why", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "ORDER_NOT_FOUND" } });
    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "ORDER_NOT_FOUND" });
  });

  it("maps INTERACTION_BLOCKED to the safe 'can't message this buyer' copy, never revealing the specific reason", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "INTERACTION_BLOCKED" } });
    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("maps MESSAGE_EMPTY and MESSAGE_TOO_LONG safely", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "MESSAGE_EMPTY" } });
    expect(await startConversationFromOrder("PSO-ABC123", "")).toEqual({ ok: false, code: "MESSAGE_EMPTY" });

    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "MESSAGE_TOO_LONG" } });
    expect(await startConversationFromOrder("PSO-ABC123", "x".repeat(4001))).toEqual({ ok: false, code: "MESSAGE_TOO_LONG" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres detail: relation xyz", details: "23505" } });
    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("every mapped error message is one of the three safe, generic buckets -- never a raw backend string", async () => {
    const { START_CONVERSATION_FROM_ORDER_ERROR_MESSAGES } = await import("@/lib/messaging/start-conversation-from-order");
    const allowedMessages = new Set([
      "We couldn't open this conversation right now.",
      "You can't message this buyer right now.",
      "Please enter a message.",
      "Messages can be up to 4000 characters.",
      "Something went wrong. Please try again.",
    ]);

    for (const message of Object.values(START_CONVERSATION_FROM_ORDER_ERROR_MESSAGES)) {
      expect(allowedMessages.has(message)).toBe(true);
    }
  });

  it("never returns a buyerId or shopId field under any outcome", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    const okResult = await startConversationFromOrder("PSO-ABC123", "hi");
    expect(okResult).not.toHaveProperty("buyerId");
    expect(okResult).not.toHaveProperty("shopId");
  });
});
