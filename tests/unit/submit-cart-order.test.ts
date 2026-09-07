import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { submitCartOrder, ORDER_ERROR_MESSAGES } from "@/lib/cart/submit-cart-order";
import type { CartLineDisplay } from "@/lib/cart/map-cart-row";

function makeRow(overrides: Partial<CartLineDisplay> = {}): CartLineDisplay {
  return {
    cartItemId: "ci-listing-1",
    listingId: "listing-1",
    publicCode: "PLS-ABC",
    title: "Nike Air Max 270",
    imageUrl: undefined,
    priceCents: 250000,
    priceCentsSnapshot: 250000,
    priceChanged: false,
    status: "available",
    isInquiryOnly: false,
    quantity: 2,
    availableQuantity: 5,
    isSubmittable: true,
    unavailableReason: null,
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    fulfillmentMethods: ["meetup", "shipping"],
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("submitCartOrder", () => {
  it("calls submit_cart_order directly with each row's own cartItemId -- no separate lookup call", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-ABC", item_count: 1, total_cents: 500000, status: "pending" }],
      error: null,
    });

    const result = await submitCartOrder({ rows: [makeRow()], fulfillmentChoices: { "shop-1": "meetup" } });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("submit_cart_order", {
      p_cart_item_ids: ["ci-listing-1"],
      p_fulfillment_choices: [{ shop_id: "shop-1", method: "meetup" }],
      p_buyer_note: null,
    });
    expect(result).toEqual({
      ok: true,
      orders: [{ orderId: "o1", shopId: "shop-1", orderPublicCode: "PSO-ABC", itemCount: 1, totalCents: 500000 }],
      submittedListingIds: ["listing-1"],
    });
  });

  it("never calls set_cart_item_quantity", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await submitCartOrder({ rows: [makeRow()], fulfillmentChoices: { "shop-1": "meetup" } });
    expect(rpcMock).not.toHaveBeenCalledWith("set_cart_item_quantity", expect.anything());
  });

  it("handles multiple sellers in one submission -- one fulfillment entry per shop, a single submit_cart_order call", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-1", item_count: 1, total_cents: 100000, status: "pending" },
        { order_id: "o2", shop_id: "shop-2", order_public_code: "PSO-2", item_count: 1, total_cents: 200000, status: "pending" },
      ],
      error: null,
    });

    const rows = [
      makeRow({ cartItemId: "ci-1", listingId: "listing-1", shopId: "shop-1" }),
      makeRow({ cartItemId: "ci-2", listingId: "listing-2", shopId: "shop-2" }),
    ];

    const result = await submitCartOrder({ rows, fulfillmentChoices: { "shop-1": "meetup", "shop-2": "shipping" } });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("submit_cart_order", {
      p_cart_item_ids: ["ci-1", "ci-2"],
      p_fulfillment_choices: expect.arrayContaining([
        { shop_id: "shop-1", method: "meetup" },
        { shop_id: "shop-2", method: "shipping" },
      ]),
      p_buyer_note: null,
    });
    expect(result.ok).toBe(true);
  });

  it("never passes a client-supplied buyer/user id", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await submitCartOrder({ rows: [makeRow()], fulfillmentChoices: { "shop-1": "meetup" } });

    const [, args] = rpcMock.mock.calls[0];
    expect(Object.keys(args as object)).not.toEqual(expect.arrayContaining(["p_buyer_id", "p_user_id", "user_id", "buyer_id"]));
  });

  it("returns NO_ELIGIBLE_ITEMS without calling the RPC when given zero rows", async () => {
    const result = await submitCartOrder({ rows: [], fulfillmentChoices: {} });
    expect(result).toEqual({ ok: false, code: "NO_ELIGIBLE_ITEMS" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns FULFILLMENT_INVALID without calling the RPC when a shop has no chosen method", async () => {
    const result = await submitCartOrder({ rows: [makeRow()], fulfillmentChoices: {} });
    expect(result).toEqual({ ok: false, code: "FULFILLMENT_INVALID" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps a known error DETAIL from submit_cart_order to its error code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "price changed", details: "PRICE_CHANGED" } });

    const result = await submitCartOrder({ rows: [makeRow()], fulfillmentChoices: { "shop-1": "meetup" } });

    expect(result).toEqual({ ok: false, code: "PRICE_CHANGED" });
    expect(ORDER_ERROR_MESSAGES.PRICE_CHANGED).not.toMatch(/postgres|sql|constraint|23p/i);
  });

  it("maps an unrecognized/missing error DETAIL to UNKNOWN, never leaking the raw message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint "orders_pkey"' } });

    const result = await submitCartOrder({ rows: [makeRow()], fulfillmentChoices: { "shop-1": "meetup" } });

    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
    expect(ORDER_ERROR_MESSAGES.UNKNOWN).not.toMatch(/constraint|duplicate key/i);
  });

  it("returns UNKNOWN when submit_cart_order throws (network failure)", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));

    const result = await submitCartOrder({ rows: [makeRow()], fulfillmentChoices: { "shop-1": "meetup" } });

    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
