import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyShopOrders } from "@/lib/seller/get-my-shop-orders";

function row(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "order-1",
    order_public_code: "PSO-ABC12345",
    buyer_display_name: "Jane D.",
    status: "pending",
    fulfillment_method: "meetup",
    created_at: "2026-01-05T00:00:00.000Z",
    item_count: 2,
    total_cents: 90000,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyShopOrders", () => {
  it("calls get_my_shop_orders with the limit and null cursor on first page (no client-supplied shop id)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getMyShopOrders(20);
    expect(rpcMock).toHaveBeenCalledWith("get_my_shop_orders", {
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the cursor through on subsequent pages", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyShopOrders(20, { createdAt: "2026-01-01T00:00:00.000Z", id: "order-5" });
    expect(rpcMock).toHaveBeenCalledWith("get_my_shop_orders", {
      p_limit: 20,
      p_before_created_at: "2026-01-01T00:00:00.000Z",
      p_before_id: "order-5",
    });
  });

  it("maps rows to SellerOrderSummary, never exposing a buyer id or email", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyShopOrders(20);
    expect(result.hadError).toBe(false);
    expect(result.orders).toEqual([
      {
        orderId: "order-1",
        orderPublicCode: "PSO-ABC12345",
        buyerDisplayName: "Jane D.",
        status: "pending",
        fulfillmentMethod: "meetup",
        createdAt: "2026-01-05T00:00:00.000Z",
        itemCount: 2,
        totalCents: 90000,
      },
    ]);
    expect(JSON.stringify(result.orders)).not.toMatch(/@/);
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ order_id: "o1", created_at: "2026-01-05T00:00:00.000Z" }), row({ order_id: "o2", created_at: "2026-01-04T00:00:00.000Z" })],
      error: null,
    });
    const result = await getMyShopOrders(2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-04T00:00:00.000Z", id: "o2" });
  });

  it("returns nextCursor: null when fewer rows than the limit come back (last page)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyShopOrders(20);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError true, empty orders, on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyShopOrders(20);
    expect(result).toEqual({ orders: [], hadError: true, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyShopOrders(20);
    expect(result).toEqual({ orders: [], hadError: true, nextCursor: null });
  });

  it("returns an empty list (not an error) when the caller has no shop or the shop has no orders", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getMyShopOrders(20);
    expect(result).toEqual({ orders: [], hadError: false, nextCursor: null });
  });
});
