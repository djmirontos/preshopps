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
