import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { upsertReviewReply } from "@/lib/reviews/review-reply-actions";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("upsertReviewReply", () => {
  it("calls upsert_review_reply with only review id and body -- no client-supplied seller/shop id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ review_id: "review-1", reply_created_at: "2026-01-01T00:00:00.000Z", reply_updated_at: null }],
      error: null,
    });
    await upsertReviewReply("review-1", "Thanks for the order!");
    expect(rpcMock).toHaveBeenCalledWith("upsert_review_reply", { p_review_id: "review-1", p_body: "Thanks for the order!" });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_review_id"]);
  });

  it("returns ok:true with reply timestamps on success (first reply)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ review_id: "review-1", reply_created_at: "2026-01-01T00:00:00.000Z", reply_updated_at: null }],
      error: null,
    });
    const result = await upsertReviewReply("review-1", "Thanks!");
    expect(result).toEqual({ ok: true, reviewId: "review-1", replyCreatedAt: "2026-01-01T00:00:00.000Z", replyUpdatedAt: null });
  });

  it("maps REPLY_EDIT_WINDOW_CLOSED to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "REPLY_EDIT_WINDOW_CLOSED" } });
    const result = await upsertReviewReply("review-1", "Edited");
    expect(result).toEqual({ ok: false, code: "REPLY_EDIT_WINDOW_CLOSED" });
  });

  it("maps NOT_REVIEW_SELLER to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_REVIEW_SELLER" } });
    const result = await upsertReviewReply("review-1", "Reply");
    expect(result).toEqual({ ok: false, code: "NOT_REVIEW_SELLER" });
  });

  it("maps an unrecognized error detail to UNKNOWN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await upsertReviewReply("review-1", "Reply");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await upsertReviewReply("review-1", "Reply");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("exports no delete/remove function -- there is no delete path anywhere in the backend", async () => {
    const reviewReplyActions = await import("@/lib/reviews/review-reply-actions");
    const exportNames = Object.keys(reviewReplyActions);
    expect(exportNames.some((name) => /delete|remove/i.test(name))).toBe(false);
  });
});
