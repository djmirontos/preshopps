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

describe("startConversationFromOrder -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2f.2)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation_from_order") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({
          data: restrictions.map((r, i) => ({ restriction_id: `r${i}`, restriction_type: r.restriction_type, reason: "x", created_at: "2026-01-01T00:00:00.000Z" })),
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
  }

  it("attaches the selling-access message and link when seller_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: {
        message: "Your selling access is currently suspended.",
        ctaLabel: "View account status",
        href: "/account#account-status",
      },
    });
  });

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: {
        message: "Your account is currently suspended.",
        ctaLabel: "View account status",
        href: "/account#account-status",
      },
    });
  });

  it("account_suspended wins when both account_suspended and seller_suspended are active", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }, { restriction_type: "account_suspended" }]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated to a seller caller) exists -- generic result preserved, and the buyer's restriction type is never revealed", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic result preserved (also covers a deleted/unavailable-buyer or block collision)", async () => {
    mockBlocked([]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation_from_order") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself rejects", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation_from_order") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.reject(new Error("network down"));
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not found", details: "ORDER_NOT_FOUND" } });

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "ORDER_NOT_FOUND" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful submission", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result.ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});

describe("startConversationFromOrder -- collision/privacy safety (A2.2.2f.2)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation_from_order") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({
          data: restrictions.map((r, i) => ({ restriction_id: `r${i}`, restriction_type: r.restriction_type, reason: "x", created_at: "2026-01-01T00:00:00.000Z" })),
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
  }

  it("a restricted buyer (the RPC's own, never-surfaced check) with an empty caller-restriction lookup shows only the generic message, never a link -- this proves only the safe generic fallback, not which backend collision occurred", async () => {
    mockBlocked([]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a mutual block with an empty caller-restriction lookup shows only the generic message, never a link -- likewise proves only the safe fallback, not the actual cause", async () => {
    mockBlocked([]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a caller with only an unrelated buyer_restricted restriction (e.g. from their own separate buying activity) gets the generic message -- the buyer's own status never leaks through, whether it is theirs or the caller's own unrelated fact", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await startConversationFromOrder("PSO-ABC123", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(JSON.stringify(result)).not.toMatch(/buyer/i);
  });
});
