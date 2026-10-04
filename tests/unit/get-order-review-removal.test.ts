import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { getOrderReviewRemoval } from "@/lib/reviews/get-order-review-removal";
import { reviewVisibilityFromRemovalResult } from "@/lib/reviews/review-visibility";

const ORDER = "22222222-2222-4222-8222-222222222222";
const OTHER_ORDER = "99999999-9999-4999-8999-999999999999";
const TS = "2026-01-05T00:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return { order_id: ORDER, is_removed: false, removed_at: null, public_message: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  createClientMock.mockResolvedValue({ rpc: rpcMock });
});

describe("getOrderReviewRemoval -- valid, confirmed results (behavioral)", () => {
  it("calls get_order_review_removal with p_order_id", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getOrderReviewRemoval(ORDER);
    expect(rpcMock).toHaveBeenCalledWith("get_order_review_removal", { p_order_id: ORDER });
  });

  it("a visible review is a confirmed 'visible' state, not an unknown one", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toEqual({ status: "found", removal: { isRemoved: false, removedAt: null, publicMessage: null } });
    expect(reviewVisibilityFromRemovalResult(result)).toBe("visible");
  });

  it("a removed review carries the timestamp and, for the buyer, the user-facing message", async () => {
    rpcMock.mockResolvedValue({ data: [row({ is_removed: true, removed_at: TS, public_message: "Scam listing." })], error: null });
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toEqual({ status: "found", removal: { isRemoved: true, removedAt: TS, publicMessage: "Scam listing." } });
    expect(reviewVisibilityFromRemovalResult(result)).toBe("removed");
  });

  it("a seller's removed result has no message (the RPC withholds it from non-buyers)", async () => {
    rpcMock.mockResolvedValue({ data: [row({ is_removed: true, removed_at: TS, public_message: null })], error: null });
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toMatchObject({ status: "found", removal: { isRemoved: true, publicMessage: null } });
  });
});

describe("getOrderReviewRemoval -- authorization and error mapping", () => {
  it("zero rows (unrelated caller, unknown order, or no review) is 'none', which maps to unknown", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toEqual({ status: "none" });
    expect(reviewVisibilityFromRemovalResult(result)).toBe("unknown");
  });

  it("an RPC error (including an authentication failure) is 'error', which maps to unknown", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Authentication required.", details: "NOT_AUTHENTICATED" } });
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toEqual({ status: "error" });
    expect(reviewVisibilityFromRemovalResult(result)).toBe("unknown");
  });

  it("a thrown client error is 'error', never a visible state", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toEqual({ status: "error" });
    expect(reviewVisibilityFromRemovalResult(result)).toBe("unknown");
  });

  it("a failure to create the client is 'error', never a visible state", async () => {
    createClientMock.mockRejectedValue(new Error("Missing required environment variable"));
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toEqual({ status: "error" });
  });
});

describe("getOrderReviewRemoval -- malformed and mismatched success responses are errors", () => {
  it.each([
    ["a non-array payload", { order_id: ORDER, is_removed: false, removed_at: null, public_message: null }],
    ["null data", null],
    ["two rows", [row(), row()]],
    ["a different order_id (identity mismatch)", [row({ order_id: OTHER_ORDER })]],
    ["a non-boolean is_removed", [row({ is_removed: "false" })]],
    ["removed without a timestamp", [row({ is_removed: true, removed_at: null })]],
    ["visible but carrying a timestamp", [row({ is_removed: false, removed_at: TS })]],
    ["an invalid timestamp", [row({ is_removed: true, removed_at: "not a date" })]],
    ["a non-string message", [row({ is_removed: true, removed_at: TS, public_message: 42 })]],
  ])("%s is 'error', which maps to unknown and never to visible", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    const result = await getOrderReviewRemoval(ORDER);
    expect(result).toEqual({ status: "error" });
    expect(reviewVisibilityFromRemovalResult(result)).toBe("unknown");
  });
});
