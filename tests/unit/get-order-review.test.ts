import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getOrderReview } from "@/lib/reviews/get-order-review";

function row(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "order-1",
    viewer_role: "buyer",
    review_id: null,
    rating: null,
    body: null,
    image_paths: [],
    review_created_at: null,
    review_updated_at: null,
    can_create_review: true,
    can_edit_review: false,
    reply_body: null,
    reply_created_at: null,
    reply_updated_at: null,
    can_write_reply: false,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOrderReview", () => {
  it("calls get_order_review with only the order id (no client-supplied buyer/shop/user id)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getOrderReview("order-1");
    expect(rpcMock).toHaveBeenCalledWith("get_order_review", { p_order_id: "order-1" });
  });

  it("returns not_found when the RPC returns zero rows (non-participant or nonexistent order -- indistinguishable)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getOrderReview("order-missing");
    expect(result).toEqual({ status: "not_found" });
  });

  it("maps a no-review-yet buyer row, exposing can_create_review", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getOrderReview("order-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.review.reviewId).toBeNull();
    expect(result.review.canCreateReview).toBe(true);
    expect(result.review.viewerRole).toBe("buyer");
  });

  it("maps an existing review row with images, converting storage paths to public URLs", async () => {
    rpcMock.mockResolvedValue({
      data: [
        row({
          review_id: "review-1",
          rating: 4,
          body: "Great seller",
          image_paths: ["reviews/a.jpg"],
          review_created_at: "2026-01-01T00:00:00.000Z",
          review_updated_at: "2026-01-01T00:00:00.000Z",
          can_create_review: false,
          can_edit_review: true,
        }),
      ],
      error: null,
    });
    const result = await getOrderReview("order-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.review.reviewId).toBe("review-1");
    expect(result.review.rating).toBe(4);
    expect(result.review.canEditReview).toBe(true);
    expect(result.review.imageUrls).toHaveLength(1);
    expect(result.review.imagePaths).toEqual(["reviews/a.jpg"]);
  });

  it("surfaces seller viewer_role and can_write_reply flags", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ viewer_role: "seller", review_id: "review-1", rating: 5, can_create_review: false, can_write_reply: true })],
      error: null,
    });
    const result = await getOrderReview("order-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.review.viewerRole).toBe("seller");
    expect(result.review.canWriteReply).toBe(true);
  });

  it("returns status: error on an RPC error, distinct from not_found", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getOrderReview("order-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns status: error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getOrderReview("order-1");
    expect(result).toEqual({ status: "error" });
  });
});
