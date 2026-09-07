import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/session";

const { getAuthUserMock, rpcMock, createClientMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

function row(overrides: Record<string, unknown> = {}) {
  return {
    cart_item_id: "ci-1",
    listing_id: "listing-1",
    public_code: "PLS-ABC",
    slug: "nike-air-max",
    title: "Nike Air Max 270",
    cover_image_storage_path: null,
    price_cents: 250000,
    price_cents_snapshot: 240000,
    price_changed: true,
    status: "available",
    is_inquiry_only: false,
    requested_quantity: 2,
    current_available_quantity: 5,
    is_submittable: true,
    unavailable_reason: null,
    shop_id: "shop-1",
    shop_slug: "annes-closet",
    shop_name: "Anne's Closet",
    fulfillment_methods: ["meetup", "shipping"],
    added_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  getAuthUserMock.mockReset();
  rpcMock.mockReset();
});

describe("get-my-cart", () => {
  it("getMyCartQuantities returns [] for a guest without calling the RPC", async () => {
    getAuthUserMock.mockResolvedValue(null);
    const { getMyCartQuantities } = await import("@/lib/cart/get-my-cart");
    expect(await getMyCartQuantities()).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("getMyCartQuantities maps rows to lightweight {listingId, publicCode, quantity}", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const { getMyCartQuantities } = await import("@/lib/cart/get-my-cart");

    expect(await getMyCartQuantities()).toEqual([{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 2 }]);
  });

  it("getMyCart maps rows to the full display projection", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const { getMyCart } = await import("@/lib/cart/get-my-cart");

    const result = await getMyCart();
    expect(result.hadError).toBe(false);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      listingId: "listing-1",
      title: "Nike Air Max 270",
      priceCents: 250000,
      quantity: 2,
      isSubmittable: true,
      shopName: "Anne's Closet",
    });
  });

  it("maps cart_item_id (added by 0041_get_my_cart_projection_fix.sql)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    rpcMock.mockResolvedValue({ data: [row({ cart_item_id: "ci-xyz" })], error: null });
    const { getMyCart } = await import("@/lib/cart/get-my-cart");

    const result = await getMyCart();
    expect(result.lines[0].cartItemId).toBe("ci-xyz");
  });

  it("maps fulfillment_methods (added by 0041_get_my_cart_projection_fix.sql)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    rpcMock.mockResolvedValue({ data: [row({ fulfillment_methods: ["pickup", "local_delivery"] })], error: null });
    const { getMyCart } = await import("@/lib/cart/get-my-cart");

    const result = await getMyCart();
    expect(result.lines[0].fulfillmentMethods).toEqual(["pickup", "local_delivery"]);
  });

  it("maps a null fulfillment_methods (hidden/unavailable row) to an empty array, never a guessed value", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    rpcMock.mockResolvedValue({ data: [row({ fulfillment_methods: null })], error: null });
    const { getMyCart } = await import("@/lib/cart/get-my-cart");

    const result = await getMyCart();
    expect(result.lines[0].fulfillmentMethods).toEqual([]);
  });

  it("returns hadError true when the RPC fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { getMyCart } = await import("@/lib/cart/get-my-cart");

    const result = await getMyCart();
    expect(result.hadError).toBe(true);
    expect(result.lines).toEqual([]);
  });

  it("calls get_my_cart with no arguments (never a client-supplied user id)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { getMyCart } = await import("@/lib/cart/get-my-cart");

    await getMyCart();
    expect(rpcMock).toHaveBeenCalledWith("get_my_cart");
  });
});
