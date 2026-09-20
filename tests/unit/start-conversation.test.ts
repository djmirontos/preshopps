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

describe("startConversation -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2f.1)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation") {
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

  it("attaches the buying-access message and link when buyer_restricted is confirmed", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: {
        message: "Your buying access is currently restricted.",
        ctaLabel: "View account status",
        href: "/account#account-status",
      },
    });
  });

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await startConversation("shop-1", "hi");

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

  it("account_suspended wins when both account_suspended and buyer_restricted are active", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }, { restriction_type: "account_suspended" }]);

    const result = await startConversation("shop-1", "hi");

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only seller_suspended (unrelated to a buyer caller) exists -- generic result preserved, and the seller's restriction type is never revealed", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic result preserved (also covers a deleted/unavailable-seller or block collision)", async () => {
    mockBlocked([]);

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself rejects", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.reject(new Error("network down"));
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "LISTING_NOT_MESSAGEABLE" } });

    const result = await startConversation("shop-1", "hi", "listing-1");

    expect(result).toEqual({ ok: false, code: "LISTING_NOT_MESSAGEABLE" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful start", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });

    const result = await startConversation("shop-1", "hi");

    expect(result.ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});

describe("startConversation -- collision/privacy safety (A2.2.2f.1)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation") {
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

  it("a restricted target seller (the RPC's own, never-surfaced check) with an empty caller-restriction lookup shows only the generic message, never a link", async () => {
    // The seller being restricted is what actually triggered this
    // INTERACTION_BLOCKED, but that is never checked from the caller's
    // side -- the caller's own lookup correctly finds nothing relevant to
    // them, so no presentation is ever attached.
    mockBlocked([]);

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a mutual block with an empty caller-restriction lookup shows only the generic message, never a link", async () => {
    mockBlocked([]);

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a caller with only an unrelated seller_suspended restriction gets the generic message -- the seller's own restriction type never leaks through, whether it is theirs or the caller's own unrelated fact", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await startConversation("shop-1", "hi");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(JSON.stringify(result)).not.toMatch(/seller/i);
  });
});
