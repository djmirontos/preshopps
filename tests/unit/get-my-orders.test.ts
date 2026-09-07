import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyOrders } from "@/lib/orders/get-my-orders";

function row(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "order-1",
    order_public_code: "PSO-ABC12345",
    shop_id: "shop-1",
    shop_slug: "annes-closet",
    shop_name: "Anne's Closet",
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

describe("getMyOrders", () => {
  it("calls get_my_orders with the limit and null cursor on first page", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getMyOrders(20);
    expect(rpcMock).toHaveBeenCalledWith("get_my_orders", {
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the cursor through on subsequent pages", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyOrders(20, { createdAt: "2026-01-01T00:00:00.000Z", id: "order-5" });
    expect(rpcMock).toHaveBeenCalledWith("get_my_orders", {
      p_limit: 20,
      p_before_created_at: "2026-01-01T00:00:00.000Z",
      p_before_id: "order-5",
    });
  });

  it("maps rows to OrderSummary", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyOrders(20);
    expect(result.hadError).toBe(false);
    expect(result.orders).toEqual([
      {
        orderId: "order-1",
        orderPublicCode: "PSO-ABC12345",
        shopId: "shop-1",
        shopSlug: "annes-closet",
        shopName: "Anne's Closet",
        status: "pending",
        fulfillmentMethod: "meetup",
        createdAt: "2026-01-05T00:00:00.000Z",
        itemCount: 2,
        totalCents: 90000,
      },
    ]);
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ order_id: "o1", created_at: "2026-01-05T00:00:00.000Z" }), row({ order_id: "o2", created_at: "2026-01-04T00:00:00.000Z" })],
      error: null,
    });
    const result = await getMyOrders(2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-04T00:00:00.000Z", id: "o2" });
  });

  it("returns nextCursor: null when fewer rows than the limit come back (last page)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyOrders(20);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError true, empty orders, on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyOrders(20);
    expect(result).toEqual({ orders: [], hadError: true, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyOrders(20);
    expect(result).toEqual({ orders: [], hadError: true, nextCursor: null });
  });
});
