import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminDisputes } from "@/lib/admin/get-admin-disputes";

function row(overrides: Record<string, unknown> = {}) {
  return {
    dispute_id: "dispute-1",
    order_id: "order-1",
    order_public_code: "PSO-ABC",
    order_status: "disputed",
    status: "opened",
    reason: "Item never arrived",
    opener_display_name: "Jane D.",
    shop_name: "Anne's Closet",
    buyer_display_name: "Jane D.",
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminDisputes", () => {
  it("calls get_admin_disputes with limit, null status, and null cursor on the unfiltered first page", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getAdminDisputes(20);
    expect(rpcMock).toHaveBeenCalledWith("get_admin_disputes", { p_status: null, p_limit: 20, p_before_created_at: null, p_before_id: null });
  });

  it("passes the status filter through unchanged", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getAdminDisputes(20, "under_review");
    expect(rpcMock).toHaveBeenCalledWith("get_admin_disputes", { p_status: "under_review", p_limit: 20, p_before_created_at: null, p_before_id: null });
  });

  it("maps rows to AdminDisputeSummary", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getAdminDisputes(20);
    expect(result.disputes[0]).toEqual({
      disputeId: "dispute-1",
      orderId: "order-1",
      orderPublicCode: "PSO-ABC",
      orderStatus: "disputed",
      status: "opened",
      reason: "Item never arrived",
      openerDisplayName: "Jane D.",
      shopName: "Anne's Closet",
      buyerDisplayName: "Jane D.",
      createdAt: "2026-01-05T00:00:00.000Z",
    });
  });

  it("surfaces NOT_ADMIN as notAdmin: true, distinct from a generic error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await getAdminDisputes(20);
    expect(result).toEqual({ disputes: [], hadError: false, notAdmin: true, nextCursor: null });
  });

  it("returns hadError true for any other error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", details: "LIMIT_INVALID" } });
    const result = await getAdminDisputes(20);
    expect(result).toEqual({ disputes: [], hadError: true, notAdmin: false, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminDisputes(20);
    expect(result).toEqual({ disputes: [], hadError: true, notAdmin: false, nextCursor: null });
  });
});
