import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { upsertReviewReply } from "@/lib/reviews/review-reply-actions";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("upsertReviewReply", () => {
  it("calls upsert_review_reply with only review id and body -- no client-supplied seller/shop id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ review_id: "review-1", reply_created_at: "2026-01-01T00:00:00.000Z", reply_updated_at: null }],
      error: null,
    });
    await upsertReviewReply("review-1", "Thanks for the order!");
    expect(rpcMock).toHaveBeenCalledWith("upsert_review_reply", { p_review_id: "review-1", p_body: "Thanks for the order!" });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_review_id"]);
  });

  it("returns ok:true with reply timestamps on success (first reply)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ review_id: "review-1", reply_created_at: "2026-01-01T00:00:00.000Z", reply_updated_at: null }],
      error: null,
    });
    const result = await upsertReviewReply("review-1", "Thanks!");
    expect(result).toEqual({ ok: true, reviewId: "review-1", replyCreatedAt: "2026-01-01T00:00:00.000Z", replyUpdatedAt: null });
  });

  it("maps REPLY_EDIT_WINDOW_CLOSED to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "REPLY_EDIT_WINDOW_CLOSED" } });
    const result = await upsertReviewReply("review-1", "Edited");
    expect(result).toEqual({ ok: false, code: "REPLY_EDIT_WINDOW_CLOSED" });
  });

  it("maps NOT_REVIEW_SELLER to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_REVIEW_SELLER" } });
    const result = await upsertReviewReply("review-1", "Reply");
    expect(result).toEqual({ ok: false, code: "NOT_REVIEW_SELLER" });
  });

  it("maps an unrecognized error detail to UNKNOWN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await upsertReviewReply("review-1", "Reply");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await upsertReviewReply("review-1", "Reply");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("exports no delete/remove function -- there is no delete path anywhere in the backend", async () => {
    const reviewReplyActions = await import("@/lib/reviews/review-reply-actions");
    const exportNames = Object.keys(reviewReplyActions);
    expect(exportNames.some((name) => /delete|remove/i.test(name))).toBe(false);
  });
});

/** Dispatches by RPC name, throwing on any unrecognized name so a stray/
 * unexpected RPC call fails the test loudly rather than silently. */
function mockBlocked(restrictions: { restriction_type: string }[]) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "upsert_review_reply") {
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

describe("upsertReviewReply -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2g.2)", () => {
  it("attaches the selling-access message and link when seller_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("account_suspended wins when both account_suspended and seller_suspended are active", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }, { restriction_type: "account_suspended" }]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated to a seller caller, and never checked by upsert_review_reply at all) exists -- generic result preserved", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic result preserved (also covers a deleted-caller or mutual-block collision with no active caller restriction)", async () => {
    mockBlocked([]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "upsert_review_reply") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself rejects", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "upsert_review_reply") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.reject(new Error("network down"));
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_REVIEW_SELLER" } });

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "NOT_REVIEW_SELLER" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions", expect.anything());
  });

  it("never calls get_my_active_restrictions on a successful submission", async () => {
    rpcMock.mockResolvedValue({
      data: [{ review_id: "review-1", reply_created_at: "2026-01-01T00:00:00.000Z", reply_updated_at: null }],
      error: null,
    });

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result.ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions", expect.anything());
  });
});

describe("upsertReviewReply -- collision/privacy safety (A2.2.2g.2)", () => {
  it("a mutual block with an empty caller-restriction lookup shows only the generic message, never a link -- proves only the safe generic fallback, not the actual backend cause", async () => {
    mockBlocked([]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a deleted caller (the RPC's own caller-deleted check, which fires before any restriction check) with an empty lookup also resolves through the same generic fallback", async () => {
    mockBlocked([]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a caller with a confirmed seller_suspended restriction who is ALSO mutually blocked from the buyer still gets the presentation attached -- this is a true, currently-active fact about the caller's own status, and proves only that the safe presentation logic ran, never that the restriction (rather than the block, which upsert_review_reply checks first) was the proximate cause of this specific denial", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("a caller with only an unrelated buyer_restricted restriction (e.g. from their own separate buying activity) gets the generic message -- the buyer's own status never leaks through, and upsert_review_reply never even checks a buyer's restriction", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await upsertReviewReply("review-1", "Thanks!");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(JSON.stringify(result)).not.toMatch(/buyer/i);
  });
});
