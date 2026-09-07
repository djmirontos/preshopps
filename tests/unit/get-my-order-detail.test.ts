import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyOrderDetail } from "@/lib/orders/get-my-order-detail";

function row(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "order-1",
    order_public_code: "PSO-ABC12345",
    shop_id: "shop-1",
    shop_slug: "annes-closet",
    shop_name: "Anne's Closet",
    status: "pending",
    fulfillment_method: "meetup",
    buyer_note: null,
    created_at: "2026-01-05T00:00:00.000Z",
    pending_cancellation_request_id: null,
    pending_cancellation_reason: null,
    order_item_id: "item-1",
    listing_id: "listing-1",
    listing_public_code_snapshot: "PLS-XYZ",
    listing_title_snapshot: "Uniqlo Airism Cotton T-Shirt",
    listing_cover_image_snapshot_path: null,
    item_quantity: 2,
    item_price_cents_snapshot: 45000,
    item_status: "pending",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyOrderDetail", () => {
  it("calls get_my_order_detail with only the public code (no client-supplied buyer id)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getMyOrderDetail("PSO-ABC12345");
    expect(rpcMock).toHaveBeenCalledWith("get_my_order_detail", { p_public_code: "PSO-ABC12345" });
  });

  it("returns not_found when the RPC returns zero rows", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getMyOrderDetail("PSO-GONE");
    expect(result).toEqual({ status: "not_found" });
  });

  it("maps a single-item order to OrderDetail, deriving totalCents from the items", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyOrderDetail("PSO-ABC12345");

    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.order).toMatchObject({
      orderId: "order-1",
      orderPublicCode: "PSO-ABC12345",
      shopSlug: "annes-closet",
      shopName: "Anne's Closet",
      status: "pending",
      fulfillmentMethod: "meetup",
      buyerNote: null,
      pendingCancellationRequestId: null,
      pendingCancellationReason: null,
      totalCents: 90000, // 2 * 45000
    });
    expect(result.order.items).toEqual([
      {
        orderItemId: "item-1",
        listingId: "listing-1",
        listingPublicCode: "PLS-XYZ",
        title: "Uniqlo Airism Cotton T-Shirt",
        imageUrl: undefined,
        quantity: 2,
        priceCentsSnapshot: 45000,
        status: "pending",
      },
    ]);
  });

  it("groups multiple order_item rows into one order with a multi-item list", async () => {
    rpcMock.mockResolvedValue({
      data: [
        row({ order_item_id: "item-1", listing_title_snapshot: "Item A", item_quantity: 1, item_price_cents_snapshot: 10000 }),
        row({ order_item_id: "item-2", listing_title_snapshot: "Item B", item_quantity: 2, item_price_cents_snapshot: 20000 }),
      ],
      error: null,
    });

    const result = await getMyOrderDetail("PSO-ABC12345");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.order.items).toHaveLength(2);
    expect(result.order.totalCents).toBe(1 * 10000 + 2 * 20000);
  });

  it("preserves the buyer note when present", async () => {
    rpcMock.mockResolvedValue({ data: [row({ buyer_note: "Call before arriving." })], error: null });
    const result = await getMyOrderDetail("PSO-ABC12345");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.order.buyerNote).toBe("Call before arriving.");
  });

  it("surfaces a pending cancellation request id/reason when present", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ pending_cancellation_request_id: "req-1", pending_cancellation_reason: "Changed my mind" })],
      error: null,
    });
    const result = await getMyOrderDetail("PSO-ABC12345");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.order.pendingCancellationRequestId).toBe("req-1");
    expect(result.order.pendingCancellationReason).toBe("Changed my mind");
  });

  it("returns status: error on an RPC error, distinct from not_found", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyOrderDetail("PSO-ABC12345");
    expect(result).toEqual({ status: "error" });
  });

  it("returns status: error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyOrderDetail("PSO-ABC12345");
    expect(result).toEqual({ status: "error" });
  });
});
