import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { createReview, updateReview } from "@/lib/reviews/review-actions";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("createReview", () => {
  it("calls create_review with only order id, rating, body, and image paths -- no client-supplied buyer/shop id", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: "review-1", created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    await createReview("order-1", 5, "Great!", []);
    expect(rpcMock).toHaveBeenCalledWith("create_review", {
      p_order_id: "order-1",
      p_rating: 5,
      p_body: "Great!",
      p_image_paths: [],
    });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_image_paths", "p_order_id", "p_rating"]);
  });

  it("returns ok:true with the created review id on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: "review-1", created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    const result = await createReview("order-1", 5, null, []);
    expect(result).toEqual({ ok: true, reviewId: "review-1", createdAt: "2026-01-01T00:00:00.000Z" });
  });

  it("maps ORDER_NOT_REVIEWABLE and REVIEW_ALREADY_EXISTS to safe copy, never a raw DB error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "ORDER_NOT_REVIEWABLE" } });
    const result = await createReview("order-1", 5, null, []);
    expect(result).toEqual({ ok: false, code: "ORDER_NOT_REVIEWABLE" });

    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "REVIEW_ALREADY_EXISTS" } });
    const second = await createReview("order-1", 5, null, []);
    expect(second).toEqual({ ok: false, code: "REVIEW_ALREADY_EXISTS" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking a raw postgres error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await createReview("order-1", 5, null, []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws (network failure)", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await createReview("order-1", 5, null, []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

/** Dispatches by RPC name, throwing on any unrecognized name so a stray/
 * unexpected RPC call fails the test loudly rather than silently. */
function mockBlocked(restrictions: { restriction_type: string }[]) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "create_review") {
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

describe("createReview -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2g.1)", () => {
  it("attaches the buying-access message and link when buyer_restricted is confirmed", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("account_suspended wins when both account_suspended and buyer_restricted are active", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }, { restriction_type: "account_suspended" }]);

    const result = await createReview("order-1", 5, null, []);

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only seller_suspended (unrelated to a buyer caller, and never checked by create_review at all) exists -- generic result preserved", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic result preserved (also covers a deleted-caller or mutual-block collision with no active caller restriction)", async () => {
    mockBlocked([]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "create_review") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself rejects", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "create_review") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.reject(new Error("network down"));
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not reviewable", details: "ORDER_NOT_REVIEWABLE" } });

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "ORDER_NOT_REVIEWABLE" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions", expect.anything());
  });

  it("never calls get_my_active_restrictions on a successful submission", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: "review-1", created_at: "2026-01-01T00:00:00.000Z" }], error: null });

    const result = await createReview("order-1", 5, null, []);

    expect(result.ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions", expect.anything());
  });
});

describe("createReview -- collision/privacy safety (A2.2.2g.1)", () => {
  it("a mutual block with an empty caller-restriction lookup shows only the generic message, never a link -- proves only the safe generic fallback, not the actual backend cause", async () => {
    mockBlocked([]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a deleted caller (the RPC's own caller-deleted check, which fires before any restriction check) with an empty lookup also resolves through the same generic fallback", async () => {
    mockBlocked([]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(result).not.toHaveProperty("restriction");
  });

  it("a caller with a confirmed buyer_restricted restriction who is ALSO mutually blocked from the seller still gets the presentation attached -- this is a true, currently-active fact about the caller's own status, and proves only that the safe presentation logic ran, never that the restriction (rather than the block, which create_review checks first) was the proximate cause of this specific denial", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });
  });

  it("a caller with only an unrelated seller_suspended restriction (e.g. from their own separate shop) gets the generic message -- the seller's own status never leaks through, and create_review never even checks a seller's restriction", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await createReview("order-1", 5, null, []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
    expect(JSON.stringify(result)).not.toMatch(/seller/i);
  });
});

describe("updateReview", () => {
  it("calls update_review with only review id, rating, body, and image paths", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: "review-1", updated_at: "2026-01-02T00:00:00.000Z" }], error: null });
    await updateReview("review-1", 3, "Updated text", []);
    expect(rpcMock).toHaveBeenCalledWith("update_review", {
      p_review_id: "review-1",
      p_rating: 3,
      p_body: "Updated text",
      p_image_paths: [],
    });
  });

  it("maps REVIEW_EDIT_WINDOW_CLOSED to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "REVIEW_EDIT_WINDOW_CLOSED" } });
    const result = await updateReview("review-1", 3, null, []);
    expect(result).toEqual({ ok: false, code: "REVIEW_EDIT_WINDOW_CLOSED" });
  });

  it("maps NOT_REVIEW_AUTHOR to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_REVIEW_AUTHOR" } });
    const result = await updateReview("review-1", 3, null, []);
    expect(result).toEqual({ ok: false, code: "NOT_REVIEW_AUTHOR" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await updateReview("review-1", 3, null, []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
