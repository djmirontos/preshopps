import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getShopReviews } from "@/lib/reviews/get-shop-reviews";

function row(overrides: Record<string, unknown> = {}) {
  return {
    review_id: "review-1",
    rating: 5,
    body: "Great seller!",
    created_at: "2026-01-03T00:00:00.000Z",
    updated_at: "2026-01-03T00:00:00.000Z",
    buyer_display_name: "Jane D.",
    buyer_avatar_storage_path: null,
    reply_body: null,
    reply_created_at: null,
    reply_updated_at: null,
    image_paths: [],
    purchased_item_titles: ["Uniqlo Shirt"],
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getShopReviews", () => {
  it("calls get_shop_reviews with the shop id, limit, and cursor -- no auth required (guest-safe)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getShopReviews("shop-1", 10);
    expect(rpcMock).toHaveBeenCalledWith("get_shop_reviews", {
      p_shop_id: "shop-1",
      p_limit: 10,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the cursor through on a subsequent page", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getShopReviews("shop-1", 10, { createdAt: "2026-01-01T00:00:00.000Z", id: "review-9" });
    expect(rpcMock).toHaveBeenCalledWith("get_shop_reviews", {
      p_shop_id: "shop-1",
      p_limit: 10,
      p_before_created_at: "2026-01-01T00:00:00.000Z",
      p_before_id: "review-9",
    });
  });

  it("never returns order_id or buyer_id -- maps only the public-safe fields", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getShopReviews("shop-1", 10);
    expect(result.reviews[0]).not.toHaveProperty("orderId");
    expect(result.reviews[0]).not.toHaveProperty("buyerId");
    expect(result.reviews[0].purchasedItemTitles).toEqual(["Uniqlo Shirt"]);
  });

  it("computes nextCursor only when a full page is returned", async () => {
    rpcMock.mockResolvedValue({ data: [row(), row({ review_id: "review-2" })], error: null });
    const result = await getShopReviews("shop-1", 2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-03T00:00:00.000Z", id: "review-2" });
  });

  it("returns nextCursor: null when fewer rows than the limit are returned", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getShopReviews("shop-1", 10);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError:true on RPC failure or throw, without crashing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getShopReviews("shop-1", 10);
    expect(result).toEqual({ reviews: [], hadError: true, nextCursor: null });

    rpcMock.mockRejectedValue(new Error("network down"));
    const thrown = await getShopReviews("shop-1", 10);
    expect(thrown).toEqual({ reviews: [], hadError: true, nextCursor: null });
  });
});
