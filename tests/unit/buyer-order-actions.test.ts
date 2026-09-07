import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { cancelPendingOrder, cancelOrderChanges, confirmOrderChanges, requestOrderCancellation, confirmOrderReceived } from "@/lib/orders/buyer-order-actions";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("cancelPendingOrder", () => {
  it("calls cancel_pending_order with only the order id", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_status: "cancelled", was_already_cancelled: false }], error: null });
    await cancelPendingOrder("order-1");
    expect(rpcMock).toHaveBeenCalledWith("cancel_pending_order", { p_order_id: "order-1" });
  });

  it("maps a known error detail to a typed error code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "ORDER_NOT_CANCELLABLE" } });
    const result = await cancelPendingOrder("order-1");
    expect(result).toEqual({ ok: false, code: "ORDER_NOT_CANCELLABLE" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await cancelPendingOrder("order-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await cancelPendingOrder("order-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("never sends any argument besides the order id", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_status: "cancelled", was_already_cancelled: false }], error: null });
    await cancelPendingOrder("order-1");
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args)).toEqual(["p_order_id"]);
  });
});

describe("cancelOrderChanges", () => {
  it("calls cancel_order_changes with only the order id", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_status: "cancelled", was_already_cancelled: false }], error: null });
    await cancelOrderChanges("order-1");
    expect(rpcMock).toHaveBeenCalledWith("cancel_order_changes", { p_order_id: "order-1" });
  });

  it("maps RESERVATION_ALREADY_EXISTS", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "conflict", details: "RESERVATION_ALREADY_EXISTS" } });
    const result = await cancelOrderChanges("order-1");
    expect(result).toEqual({ ok: false, code: "RESERVATION_ALREADY_EXISTS" });
  });
});

describe("confirmOrderChanges", () => {
  it("calls confirm_order_changes with only the order id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "accepted", was_already_confirmed: false, accepted_item_ids: ["item-1"], declined_item_ids: ["item-2"] }],
      error: null,
    });
    await confirmOrderChanges("order-1");
    expect(rpcMock).toHaveBeenCalledWith("confirm_order_changes", { p_order_id: "order-1" });
  });

  it("returns the accepted/declined item ids from the RPC result", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "accepted", was_already_confirmed: false, accepted_item_ids: ["item-1"], declined_item_ids: ["item-2"] }],
      error: null,
    });
    const result = await confirmOrderChanges("order-1");
    expect(result).toEqual({ ok: true, orderStatus: "accepted", wasAlreadyConfirmed: false, acceptedItemIds: ["item-1"], declinedItemIds: ["item-2"] });
  });

  it("maps ORDER_NO_LONGER_FULFILLABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "conflict", details: "ORDER_NO_LONGER_FULFILLABLE" } });
    const result = await confirmOrderChanges("order-1");
    expect(result).toEqual({ ok: false, code: "ORDER_NO_LONGER_FULFILLABLE" });
  });

  it("never sends any argument besides the order id -- the buyer cannot pick which items to accept", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "accepted", was_already_confirmed: false, accepted_item_ids: [], declined_item_ids: [] }],
      error: null,
    });
    await confirmOrderChanges("order-1");
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args)).toEqual(["p_order_id"]);
  });
});

describe("requestOrderCancellation", () => {
  it("calls request_order_cancellation with the order id and reason", async () => {
    rpcMock.mockResolvedValue({
      data: [{ request_id: "req-1", order_id: "order-1", request_status: "pending", was_already_pending: false, requested_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await requestOrderCancellation("order-1", "Changed my mind");
    expect(rpcMock).toHaveBeenCalledWith("request_order_cancellation", { p_order_id: "order-1", p_reason: "Changed my mind" });
  });

  it("surfaces was_already_pending so the UI can treat a duplicate call as safe, not an error", async () => {
    rpcMock.mockResolvedValue({
      data: [{ request_id: "req-1", order_id: "order-1", request_status: "pending", was_already_pending: true, requested_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    const result = await requestOrderCancellation("order-1", "Changed my mind");
    expect(result).toEqual({ ok: true, requestId: "req-1", wasAlreadyPending: true });
  });

  it("maps INVALID_CANCELLATION_REASON", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "INVALID_CANCELLATION_REASON" } });
    const result = await requestOrderCancellation("order-1", "");
    expect(result).toEqual({ ok: false, code: "INVALID_CANCELLATION_REASON" });
  });

  it("never sends a shop/seller/user id -- only order id and reason", async () => {
    rpcMock.mockResolvedValue({
      data: [{ request_id: "req-1", order_id: "order-1", request_status: "pending", was_already_pending: false, requested_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await requestOrderCancellation("order-1", "Changed my mind");
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_order_id", "p_reason"]);
  });
});

describe("confirmOrderReceived", () => {
  it("calls confirm_order_received with only the order id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "completed", was_already_received_confirmed: false, received_confirmed_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await confirmOrderReceived("order-1");
    expect(rpcMock).toHaveBeenCalledWith("confirm_order_received", { p_order_id: "order-1" });
  });

  it("returns 'completed' as order_status when the backend auto-completes synchronously (0044)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "completed", was_already_received_confirmed: false, received_confirmed_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    const result = await confirmOrderReceived("order-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orderStatus).toBe("completed");
  });

  it("maps ORDER_NOT_RECEIVABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "ORDER_NOT_RECEIVABLE" } });
    const result = await confirmOrderReceived("order-1");
    expect(result).toEqual({ ok: false, code: "ORDER_NOT_RECEIVABLE" });
  });

  it("never sends any argument besides the order id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ order_id: "order-1", order_status: "received_confirmed", was_already_received_confirmed: false, received_confirmed_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });
    await confirmOrderReceived("order-1");
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args)).toEqual(["p_order_id"]);
  });
});
