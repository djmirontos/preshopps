import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { submitBuyNowOrder } from "@/lib/cart/submit-buy-now-order";

const BASE_INPUT = {
  listingId: "listing-1",
  quantity: 1,
  fulfillmentMethod: "meetup" as const,
  expectedPriceCents: 250000,
};

beforeEach(() => {
  rpcMock.mockReset();
});

describe("submitBuyNowOrder -- baseline (no behavioral coverage existed before A2.2.2a)", () => {
  it("calls submit_buy_now_order with the expected payload and maps a successful result", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-BN1", item_count: 1, total_cents: 250000, status: "pending" }],
      error: null,
    });

    const result = await submitBuyNowOrder(BASE_INPUT);

    expect(rpcMock).toHaveBeenCalledWith("submit_buy_now_order", {
      p_listing_id: "listing-1",
      p_quantity: 1,
      p_fulfillment_method: "meetup",
      p_expected_price_cents: 250000,
      p_buyer_note: null,
    });
    expect(result).toEqual({
      ok: true,
      orders: [{ orderId: "o1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
      submittedListingIds: ["listing-1"],
    });
  });

  it("returns UNKNOWN (never throws) when the RPC call itself throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await submitBuyNowOrder(BASE_INPUT);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("submitBuyNowOrder -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2a)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_buy_now_order") {
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

    const result = await submitBuyNowOrder(BASE_INPUT);

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

    const result = await submitBuyNowOrder(BASE_INPUT);

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

    const result = await submitBuyNowOrder(BASE_INPUT);

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only seller_suspended (unrelated) exists -- generic error preserved", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await submitBuyNowOrder(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic error preserved", async () => {
    mockBlocked([]);

    const result = await submitBuyNowOrder(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_buy_now_order") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await submitBuyNowOrder(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "price changed", details: "PRICE_CHANGED" } });

    const result = await submitBuyNowOrder(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "PRICE_CHANGED" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("LISTING_NOT_ORDERABLE (a seller-side listing condition) never calls the lookup or shows Account-status guidance", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not orderable", details: "LISTING_NOT_ORDERABLE" } });

    const result = await submitBuyNowOrder(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "LISTING_NOT_ORDERABLE" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful submission", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-BN1", item_count: 1, total_cents: 250000, status: "pending" }],
      error: null,
    });

    await submitBuyNowOrder(BASE_INPUT);

    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});
