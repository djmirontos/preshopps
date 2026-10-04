import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

import {
  getAdminReviewState,
  removeReview,
  restoreReview,
  REVIEW_MODERATION_TEXT_MAX_LENGTH,
} from "@/lib/admin/review-moderation-actions";

const REVIEW = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const SHOP = "33333333-3333-4333-8333-333333333333";
const AUDIT = "44444444-4444-4444-8444-444444444444";
const TS = "2026-01-05T00:00:00.000Z";

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    review_id: REVIEW,
    order_id: ORDER,
    shop_id: SHOP,
    rating: 4,
    body: "Good.",
    reply_body: null,
    reply_created_at: null,
    reply_updated_at: null,
    review_created_at: TS,
    removed_at: null,
    image_paths: [],
    removal_public_message: null,
    removal_private_note: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  createClientMock.mockReturnValue({ rpc: rpcMock });
});

describe("getAdminReviewState -- contract and validation", () => {
  it("calls get_admin_review_state with p_review_id", async () => {
    rpcMock.mockResolvedValue({ data: [stateRow()], error: null });
    await getAdminReviewState(REVIEW);
    expect(rpcMock).toHaveBeenCalledWith("get_admin_review_state", { p_review_id: REVIEW });
  });

  it("a single matching visible row returns removedAt null", async () => {
    rpcMock.mockResolvedValue({ data: [stateRow()], error: null });
    const result = await getAdminReviewState(REVIEW);
    expect(result).toMatchObject({ ok: true, state: { reviewId: REVIEW, removedAt: null, removalPrivateNote: null } });
  });

  it("a removed row carries the removal timestamp and admin-only fields", async () => {
    rpcMock.mockResolvedValue({
      data: [stateRow({ removed_at: TS, removal_public_message: "Reason.", removal_private_note: "Private." })],
      error: null,
    });
    expect(await getAdminReviewState(REVIEW)).toMatchObject({
      ok: true,
      state: { removedAt: TS, removalPublicMessage: "Reason.", removalPrivateNote: "Private." },
    });
  });

  it.each([
    ["empty array", []],
    ["null data", null],
    ["two rows", [stateRow(), stateRow()]],
    ["mismatched review_id", [stateRow({ review_id: "other" })]],
    ["rating out of range", [stateRow({ rating: 0 })]],
    ["non-integer rating", [stateRow({ rating: 3.5 })]],
    ["invalid removed_at", [stateRow({ removed_at: "not a date" })]],
    ["image_paths not an array", [stateRow({ image_paths: "x" })]],
    ["removal fields present while visible", [stateRow({ removal_public_message: "Stale reason." })]],
  ])("%s is UNKNOWN, never a visible or removed state", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    expect(await getAdminReviewState(REVIEW)).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("maps a known RPC error detail code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x", details: "NOT_ADMIN" } });
    expect(await getAdminReviewState(REVIEW)).toEqual({ ok: false, code: "NOT_ADMIN" });
  });

  it("a thrown RPC call is UNKNOWN", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    expect(await getAdminReviewState(REVIEW)).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("removeReview -- local validation", () => {
  it("a blank or whitespace-only reason is rejected before any RPC call", async () => {
    expect(await removeReview(REVIEW, "   ", null)).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a reason over the limit is rejected before any RPC call", async () => {
    expect(await removeReview(REVIEW, "x".repeat(REVIEW_MODERATION_TEXT_MAX_LENGTH + 1), null)).toEqual({
      ok: false,
      code: "REASON_TOO_LONG",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("the limit counts code points, matching the RPC's char_length (not UTF-16 units)", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: REVIEW, removed_at: TS, was_already_removed: false, audit_id: AUDIT }], error: null });
    // 1000 emoji: 2000 UTF-16 units but exactly 1000 code points -- accepted.
    const atLimit = "\u{1F600}".repeat(REVIEW_MODERATION_TEXT_MAX_LENGTH);
    expect((await removeReview(REVIEW, atLimit, null)).ok).toBe(true);
    // 1001 code points -- rejected.
    expect(await removeReview(REVIEW, "\u{1F600}".repeat(REVIEW_MODERATION_TEXT_MAX_LENGTH + 1), null)).toEqual({
      ok: false,
      code: "REASON_TOO_LONG",
    });
  });

  it("an over-limit private note is rejected before any RPC call", async () => {
    expect(await removeReview(REVIEW, "Scam.", "n".repeat(REVIEW_MODERATION_TEXT_MAX_LENGTH + 1))).toEqual({
      ok: false,
      code: "NOTE_TOO_LONG",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("removeReview -- RPC contract and response validation", () => {
  it("sends trimmed reason and null for a blank note", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: REVIEW, removed_at: TS, was_already_removed: false, audit_id: AUDIT }], error: null });
    await removeReview(REVIEW, "  Scam listing.  ", "   ");
    expect(rpcMock).toHaveBeenCalledWith("remove_review", {
      p_review_id: REVIEW,
      p_public_message: "Scam listing.",
      p_private_note: null,
    });
  });

  it("a genuine removal returns the timestamp and was_already_removed=false", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: REVIEW, removed_at: TS, was_already_removed: false, audit_id: AUDIT }], error: null });
    expect(await removeReview(REVIEW, "Scam.", null)).toEqual({ ok: true, reviewId: REVIEW, removedAt: TS, wasAlreadyRemoved: false });
  });

  it("an idempotent repeat returns wasAlreadyRemoved=true with a null audit id", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: REVIEW, removed_at: TS, was_already_removed: true, audit_id: null }], error: null });
    expect(await removeReview(REVIEW, "Scam.", null)).toMatchObject({ ok: true, wasAlreadyRemoved: true });
  });

  it.each([
    ["empty array", []],
    ["two rows", [{ review_id: REVIEW, removed_at: TS, was_already_removed: false, audit_id: AUDIT }, { review_id: REVIEW, removed_at: TS, was_already_removed: false, audit_id: AUDIT }]],
    ["mismatched review_id", [{ review_id: "other", removed_at: TS, was_already_removed: false, audit_id: AUDIT }]],
    ["null removed_at", [{ review_id: REVIEW, removed_at: null, was_already_removed: false, audit_id: AUDIT }]],
    ["missing was_already_removed", [{ review_id: REVIEW, removed_at: TS, audit_id: AUDIT }]],
    ["fresh removal without an audit id", [{ review_id: REVIEW, removed_at: TS, was_already_removed: false, audit_id: null }]],
    ["idempotent repeat claiming an audit id", [{ review_id: REVIEW, removed_at: TS, was_already_removed: true, audit_id: AUDIT }]],
  ])("%s is UNKNOWN (unconfirmed), never a success", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    expect(await removeReview(REVIEW, "Scam.", null)).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("maps a known RPC error to a definite failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x", details: "REVIEW_NOT_FOUND" } });
    expect(await removeReview(REVIEW, "Scam.", null)).toEqual({ ok: false, code: "REVIEW_NOT_FOUND" });
  });

  it("a thrown RPC call is UNKNOWN (unconfirmed)", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    expect(await removeReview(REVIEW, "Scam.", null)).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("restoreReview -- RPC contract and response validation", () => {
  it("calls restore_review with p_review_id, p_public_message, p_private_note, and nulls for blank fields", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: REVIEW, removed_at: null, was_already_restored: false, audit_id: AUDIT }], error: null });
    await restoreReview(REVIEW, "  ", "");
    expect(rpcMock).toHaveBeenCalledWith("restore_review", { p_review_id: REVIEW, p_public_message: null, p_private_note: null });
  });

  it("a genuine restore returns wasAlreadyRestored=false", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: REVIEW, removed_at: null, was_already_restored: false, audit_id: AUDIT }], error: null });
    expect(await restoreReview(REVIEW, null, null)).toEqual({ ok: true, reviewId: REVIEW, wasAlreadyRestored: false });
  });

  it("an idempotent repeat returns wasAlreadyRestored=true", async () => {
    rpcMock.mockResolvedValue({ data: [{ review_id: REVIEW, removed_at: null, was_already_restored: true, audit_id: null }], error: null });
    expect(await restoreReview(REVIEW, null, null)).toMatchObject({ ok: true, wasAlreadyRestored: true });
  });

  it.each([
    ["a restored review that still reports a removal timestamp", [{ review_id: REVIEW, removed_at: TS, was_already_restored: false, audit_id: AUDIT }]],
    ["a fresh restore without an audit id", [{ review_id: REVIEW, removed_at: null, was_already_restored: false, audit_id: null }]],
    ["missing was_already_restored", [{ review_id: REVIEW, removed_at: null, audit_id: AUDIT }]],
    ["empty array", []],
  ])("%s is UNKNOWN", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    expect(await restoreReview(REVIEW, null, null)).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("an over-limit message is rejected before any RPC call", async () => {
    expect(await restoreReview(REVIEW, "m".repeat(REVIEW_MODERATION_TEXT_MAX_LENGTH + 1), null)).toEqual({
      ok: false,
      code: "MESSAGE_TOO_LONG",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
