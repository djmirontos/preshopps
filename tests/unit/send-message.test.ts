import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { sendMessage } from "@/lib/messaging/send-message";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("sendMessage", () => {
  it("calls send_message with only conversation id and body (no client-supplied sender id, and viewerRole never reaches the RPC)", async () => {
    rpcMock.mockResolvedValue({ data: [{ message_id: "msg-1", conversation_id: "conv-1", message_created_at: "2026-01-05T00:00:00.000Z" }], error: null });
    await sendMessage("conv-1", "Hello there", "initiator");
    expect(rpcMock).toHaveBeenCalledWith("send_message", { p_conversation_id: "conv-1", p_body: "Hello there" });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_conversation_id"]);
  });

  it("returns the message id and timestamp on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ message_id: "msg-1", conversation_id: "conv-1", message_created_at: "2026-01-05T00:00:00.000Z" }], error: null });
    const result = await sendMessage("conv-1", "hi", "initiator");
    expect(result).toEqual({ ok: true, messageId: "msg-1", createdAt: "2026-01-05T00:00:00.000Z" });
  });

  it("maps INTERACTION_BLOCKED", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "INTERACTION_BLOCKED" } });
    const result = await sendMessage("conv-1", "hi", "initiator");
    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("maps MESSAGE_EMPTY", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "MESSAGE_EMPTY" } });
    const result = await sendMessage("conv-1", "   ", "initiator");
    expect(result).toEqual({ ok: false, code: "MESSAGE_EMPTY" });
  });

  it("maps MESSAGE_TOO_LONG", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "MESSAGE_TOO_LONG" } });
    const result = await sendMessage("conv-1", "x".repeat(4001), "initiator");
    expect(result).toEqual({ ok: false, code: "MESSAGE_TOO_LONG" });
  });

  it("maps NOT_CONVERSATION_PARTICIPANT", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_CONVERSATION_PARTICIPANT" } });
    const result = await sendMessage("conv-1", "hi", "initiator");
    expect(result).toEqual({ ok: false, code: "NOT_CONVERSATION_PARTICIPANT" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking a raw database error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation messages does not exist", details: "42P01" } });
    const result = await sendMessage("conv-1", "hi", "initiator");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws (network failure)", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await sendMessage("conv-1", "hi", "initiator");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

/** Shared mock helper for every restriction-aware describe block below --
 * dispatches by RPC name, throwing on any unrecognized name so a stray/
 * unexpected RPC call fails the test loudly rather than silently. */
function mockBlocked(restrictions: { restriction_type: string }[]) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "send_message") {
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

describe("sendMessage -- buyer (initiator) INTERACTION_BLOCKED restriction-aware presentation (A2.2.2f.3)", () => {
  it("attaches the buying-access message and link when buyer_restricted is confirmed", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await sendMessage("conv-1", "hi", "initiator");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await sendMessage("conv-1", "hi", "initiator");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("account_suspended wins when both account_suspended and buyer_restricted are active", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }, { restriction_type: "account_suspended" }]);

    const result = await sendMessage("conv-1", "hi", "initiator");

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only seller_suspended (unrelated to a buyer caller) exists -- generic result preserved, and the seller's restriction type is never revealed", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await sendMessage("conv-1", "hi", "initiator");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });
});

describe("sendMessage -- seller INTERACTION_BLOCKED restriction-aware presentation (A2.2.2f.3)", () => {
  it("attaches the selling-access message and link when seller_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await sendMessage("conv-1", "hi", "seller");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await sendMessage("conv-1", "hi", "seller");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("account_suspended wins when both account_suspended and seller_suspended are active", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }, { restriction_type: "account_suspended" }]);

    const result = await sendMessage("conv-1", "hi", "seller");

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated to a seller caller) exists -- generic result preserved, and the buyer's restriction type is never revealed", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await sendMessage("conv-1", "hi", "seller");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });
});

describe.each([["initiator" as const], ["seller" as const]])("sendMessage -- %s role: generic-fallback and gating safety (A2.2.2f.3)", (viewerRole) => {
  it("does not attach a restriction when the restriction result is empty -- generic result preserved (also covers an other-participant-restricted or mutual-block collision)", async () => {
    mockBlocked([]);

    const result = await sendMessage("conv-1", "hi", viewerRole);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "send_message") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await sendMessage("conv-1", "hi", viewerRole);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself rejects", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "send_message") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.reject(new Error("network down"));
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await sendMessage("conv-1", "hi", viewerRole);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_CONVERSATION_PARTICIPANT" } });

    const result = await sendMessage("conv-1", "hi", viewerRole);

    expect(result).toEqual({ ok: false, code: "NOT_CONVERSATION_PARTICIPANT" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions", expect.anything());
  });

  it("never calls get_my_active_restrictions on a successful send", async () => {
    rpcMock.mockResolvedValue({ data: [{ message_id: "msg-1", conversation_id: "conv-1", message_created_at: "2026-01-05T00:00:00.000Z" }], error: null });

    const result = await sendMessage("conv-1", "hi", viewerRole);

    expect(result.ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions", expect.anything());
  });
});

describe("sendMessage -- collision/privacy safety (A2.2.2f.3)", () => {
  it("buyer viewer: an other-participant (seller) restriction with an empty caller-restriction lookup shows only the generic message, never a link -- this proves only the safe generic fallback, not which backend collision occurred", async () => {
    mockBlocked([]);

    const result = await sendMessage("conv-1", "hi", "initiator");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("seller viewer: an other-participant (buyer) restriction with an empty caller-restriction lookup shows only the generic message, never a link -- this proves only the safe generic fallback, not which backend collision occurred (send_message checks the buyer's restriction before the seller's, so this is the exact scenario where a confirmed seller-side match would NOT be provably the cause -- here the lookup is empty, so no presentation attaches at all)", async () => {
    mockBlocked([]);

    const result = await sendMessage("conv-1", "hi", "seller");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a mutual block with an empty caller-restriction lookup shows only the generic message, never a link -- likewise proves only the safe fallback, not the actual cause", async () => {
    mockBlocked([]);

    const result = await sendMessage("conv-1", "hi", "initiator");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a deleted caller collision (the RPC's own caller-deleted check, which fires before any restriction check) still resolves through this same generic-fallback path when the restriction lookup itself returns nothing -- proves only the fallback, not the actual backend branch", async () => {
    mockBlocked([]);

    const result = await sendMessage("conv-1", "hi", "seller");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a seller caller with only an unrelated buyer_restricted restriction (e.g. from their own separate buying activity) gets the generic message -- the buyer participant's own status never leaks through, whether it is theirs or the caller's own unrelated fact", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await sendMessage("conv-1", "hi", "seller");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(JSON.stringify(result)).not.toMatch(/buyer/i);
  });

  it("a buyer caller with only an unrelated seller_suspended restriction (e.g. from their own separate shop) gets the generic message -- the seller participant's own status never leaks through", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await sendMessage("conv-1", "hi", "initiator");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(JSON.stringify(result)).not.toMatch(/seller/i);
  });
});
