import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import {
  acceptOrderItems,
  markOrderReady,
  markOrderHandedOverOrShipped,
  cancelAcceptedOrder,
  resolveOrderCancellation,
} from "@/lib/seller/seller-order-actions";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("acceptOrderItems", () => {
  it("calls accept_order_items with exactly order id + accepted/declined item ids (no shop/seller id)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "accepted", was_already_processed: false, accepted_item_ids: ["item-1"], declined_item_ids: [], stock_conflict_item_ids: [] }],
      error: null,
    });
    await acceptOrderItems("order-1", ["item-1"], []);
    expect(rpcMock).toHaveBeenCalledWith("accept_order_items", {
      p_order_id: "order-1",
      p_accepted_item_ids: ["item-1"],
      p_declined_item_ids: [],
    });
  });

  it("supports a full decline: empty accepted array, every pending item in declined array", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "declined", was_already_processed: false, accepted_item_ids: [], declined_item_ids: ["item-1", "item-2"], stock_conflict_item_ids: [] }],
      error: null,
    });
    const result = await acceptOrderItems("order-1", [], ["item-1", "item-2"]);
    expect(result).toEqual({ ok: true, orderStatus: "declined", wasAlreadyProcessed: false, acceptedItemIds: [], declinedItemIds: ["item-1", "item-2"], stockConflictItemIds: [] });
  });

  it("returns a whole-row partial-acceptance outcome (changes_pending) when some but not all items are accepted", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "changes_pending", was_already_processed: false, accepted_item_ids: ["item-1"], declined_item_ids: ["item-2"], stock_conflict_item_ids: [] }],
      error: null,
    });
    const result = await acceptOrderItems("order-1", ["item-1"], ["item-2"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orderStatus).toBe("changes_pending");
  });

  it("maps a known RPC error detail to a typed error code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ORDER_SELLER" } });
    const result = await acceptOrderItems("order-1", ["item-1"], []);
    expect(result).toEqual({ ok: false, code: "NOT_ORDER_SELLER" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "some raw postgres error", details: "23505" } });
    const result = await acceptOrderItems("order-1", ["item-1"], []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await acceptOrderItems("order-1", ["item-1"], []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("markOrderReady", () => {
  it("calls mark_order_ready with only the order id", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_status: "ready", was_already_ready: false, ready_at: "2026-01-05T00:00:00.000Z" }], error: null });
    await markOrderReady("order-1");
    expect(rpcMock).toHaveBeenCalledWith("mark_order_ready", { p_order_id: "order-1" });
  });

  it("maps CANCELLATION_REQUEST_PENDING", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "CANCELLATION_REQUEST_PENDING" } });
    const result = await markOrderReady("order-1");
    expect(result).toEqual({ ok: false, code: "CANCELLATION_REQUEST_PENDING" });
  });
});

describe("markOrderHandedOverOrShipped", () => {
  it("calls mark_order_handed_over_or_shipped with only the order id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "handed_over_or_shipped", was_already_handed_over_or_shipped: false, handed_over_or_shipped_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await markOrderHandedOverOrShipped("order-1");
    expect(rpcMock).toHaveBeenCalledWith("mark_order_handed_over_or_shipped", { p_order_id: "order-1" });
  });

  it("maps ORDER_NOT_HANDOVERABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "ORDER_NOT_HANDOVERABLE" } });
    const result = await markOrderHandedOverOrShipped("order-1");
    expect(result).toEqual({ ok: false, code: "ORDER_NOT_HANDOVERABLE" });
  });
});

describe("cancelAcceptedOrder", () => {
  it("calls cancel_accepted_order with the order id and a required reason", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_status: "cancelled", was_already_cancelled: false, cancelled_at: "2026-01-05T00:00:00.000Z" }], error: null });
    await cancelAcceptedOrder("order-1", "Out of stock");
    expect(rpcMock).toHaveBeenCalledWith("cancel_accepted_order", { p_order_id: "order-1", p_reason: "Out of stock" });
  });

  it("maps INVALID_CANCELLATION_REASON", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "INVALID_CANCELLATION_REASON" } });
    const result = await cancelAcceptedOrder("order-1", "");
    expect(result).toEqual({ ok: false, code: "INVALID_CANCELLATION_REASON" });
  });
});

describe("resolveOrderCancellation", () => {
  it("approves with p_confirm true and a null review note", async () => {
    rpcMock.mockResolvedValue({
      data: [{ request_id: "req-1", order_id: "order-1", request_status: "confirmed", order_status: "cancelled", was_already_resolved: false, reviewed_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await resolveOrderCancellation("req-1", true, null);
    expect(rpcMock).toHaveBeenCalledWith("resolve_order_cancellation", { p_request_id: "req-1", p_confirm: true, p_review_note: null });
  });

  it("rejects with p_confirm false and a required review note", async () => {
    rpcMock.mockResolvedValue({
      data: [{ request_id: "req-1", order_id: "order-1", request_status: "rejected", order_status: "accepted", was_already_resolved: false, reviewed_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await resolveOrderCancellation("req-1", false, "Already prepared for shipping");
    expect(rpcMock).toHaveBeenCalledWith("resolve_order_cancellation", { p_request_id: "req-1", p_confirm: false, p_review_note: "Already prepared for shipping" });
  });

  it("maps INVALID_REVIEW_NOTE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "INVALID_REVIEW_NOTE" } });
    const result = await resolveOrderCancellation("req-1", false, "");
    expect(result).toEqual({ ok: false, code: "INVALID_REVIEW_NOTE" });
  });

  it("never sends a shop/seller/user id -- only request id, confirm flag, and note", async () => {
    rpcMock.mockResolvedValue({
      data: [{ request_id: "req-1", order_id: "order-1", request_status: "confirmed", order_status: "cancelled", was_already_resolved: false, reviewed_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await resolveOrderCancellation("req-1", true, null);
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_confirm", "p_request_id", "p_review_note"]);
  });
});
