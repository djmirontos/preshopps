import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminDisputeDetail } from "@/lib/admin/get-admin-dispute-detail";

function row(overrides: Record<string, unknown> = {}) {
  return {
    dispute_id: "dispute-1",
    order_id: "order-1",
    order_public_code: "PSO-ABC",
    order_status: "disputed",
    status: "opened",
    reason: "Item never arrived",
    explanation: "Never received it.",
    opened_by: "buyer-1",
    opener_display_name: "Jane D.",
    shop_id: "shop-1",
    shop_name: "Anne's Closet",
    shop_owner_id: "owner-1",
    shop_owner_display_name: "Anne S.",
    buyer_id: "buyer-1",
    buyer_display_name: "Jane D.",
    fulfillment_method: "meetup",
    image_paths: [],
    admin_notes: [],
    resolved_by: null,
    resolved_by_display_name: null,
    resolved_at: null,
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminDisputeDetail", () => {
  it("calls get_admin_dispute_detail with the dispute id", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getAdminDisputeDetail("dispute-1");
    expect(rpcMock).toHaveBeenCalledWith("get_admin_dispute_detail", { p_dispute_id: "dispute-1" });
  });

  it("maps admin notes through unchanged", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ admin_notes: [{ note: "Confirmed with courier", adminDisplayName: "Admin A.", createdAt: "2026-01-06T00:00:00.000Z" }] })],
      error: null,
    });
    const result = await getAdminDisputeDetail("dispute-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.dispute.adminNotes).toEqual([{ note: "Confirmed with courier", adminDisplayName: "Admin A.", createdAt: "2026-01-06T00:00:00.000Z" }]);
  });

  it("returns not_admin for NOT_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await getAdminDisputeDetail("dispute-1");
    expect(result).toEqual({ status: "not_admin" });
  });

  it("returns not_found for DISPUTE_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "DISPUTE_NOT_FOUND" } });
    const result = await getAdminDisputeDetail("dispute-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminDisputeDetail("dispute-1");
    expect(result).toEqual({ status: "error" });
  });
});
