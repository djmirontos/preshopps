import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(() => {
    throw new Error("must not access .from() directly -- use the RPC only");
  }),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });

import {
  addDisputeAdminNote,
  updateDisputeStatus,
  adminCancelDisputedOrder,
  adminCompleteDisputedOrder,
} from "@/lib/admin/dispute-admin-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("addDisputeAdminNote", () => {
  it("calls add_dispute_admin_note with the dispute id and note, never touching .from()", async () => {
    rpcMock.mockResolvedValue({ data: [{ note_id: "note-1", created_at: "2026-01-06T00:00:00.000Z" }], error: null });
    await addDisputeAdminNote("dispute-1", "Confirmed with courier");
    expect(rpcMock).toHaveBeenCalledWith("add_dispute_admin_note", { p_dispute_id: "dispute-1", p_note: "Confirmed with courier" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps NOT_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await addDisputeAdminNote("dispute-1", "note");
    expect(result).toEqual({ ok: false, code: "NOT_ADMIN" });
  });
});

describe("updateDisputeStatus", () => {
  it("calls update_dispute_status with the dispute id and target status", async () => {
    rpcMock.mockResolvedValue({ data: [{ status: "under_review", resolved_at: null }], error: null });
    await updateDisputeStatus("dispute-1", "under_review");
    expect(rpcMock).toHaveBeenCalledWith("update_dispute_status", { p_dispute_id: "dispute-1", p_status: "under_review" });
  });

  it("returns ok:true with the new status and resolvedAt", async () => {
    rpcMock.mockResolvedValue({ data: [{ status: "resolved", resolved_at: "2026-01-07T00:00:00.000Z" }], error: null });
    const result = await updateDisputeStatus("dispute-1", "resolved");
    expect(result).toEqual({ ok: true, status: "resolved", resolvedAt: "2026-01-07T00:00:00.000Z" });
  });

  it("maps DISPUTE_STATUS_BACKWARD_NOT_ALLOWED", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "DISPUTE_STATUS_BACKWARD_NOT_ALLOWED" } });
    const result = await updateDisputeStatus("dispute-1", "opened");
    expect(result).toEqual({ ok: false, code: "DISPUTE_STATUS_BACKWARD_NOT_ALLOWED" });
  });
});

describe("adminCancelDisputedOrder", () => {
  it("calls admin_cancel_disputed_order with the dispute id and reason", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_status: "cancelled", cancelled_at: "2026-01-07T00:00:00.000Z" }], error: null });
    await adminCancelDisputedOrder("dispute-1", "Seller confirmed item never shipped");
    expect(rpcMock).toHaveBeenCalledWith("admin_cancel_disputed_order", { p_dispute_id: "dispute-1", p_reason: "Seller confirmed item never shipped" });
  });

  it("maps ORDER_NOT_CANCELLABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "ORDER_NOT_CANCELLABLE" } });
    const result = await adminCancelDisputedOrder("dispute-1", "reason");
    expect(result).toEqual({ ok: false, code: "ORDER_NOT_CANCELLABLE" });
  });
});

describe("adminCompleteDisputedOrder", () => {
  it("calls admin_complete_disputed_order with only the dispute id", async () => {
    rpcMock.mockResolvedValue({ data: [{ order_id: "order-1", order_status: "completed", completed_at: "2026-01-07T00:00:00.000Z" }], error: null });
    await adminCompleteDisputedOrder("dispute-1");
    expect(rpcMock).toHaveBeenCalledWith("admin_complete_disputed_order", { p_dispute_id: "dispute-1" });
  });

  it("maps ORDER_NOT_COMPLETABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "ORDER_NOT_COMPLETABLE" } });
    const result = await adminCompleteDisputedOrder("dispute-1");
    expect(result).toEqual({ ok: false, code: "ORDER_NOT_COMPLETABLE" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await adminCompleteDisputedOrder("dispute-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
