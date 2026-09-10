import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getDisputeDetail } from "@/lib/disputes/get-dispute-detail";

function row(overrides: Record<string, unknown> = {}) {
  return {
    dispute_id: "dispute-1",
    order_id: "order-1",
    order_public_code: "PSO-ABC",
    order_status: "disputed",
    status: "opened",
    reason: "Item never arrived",
    explanation: "I never received the package after two weeks.",
    opened_by: "buyer-1",
    is_mine_opened: true,
    shop_name: "Anne's Closet",
    buyer_display_name: "Jane D.",
    fulfillment_method: "meetup",
    image_paths: [],
    created_at: "2026-01-05T00:00:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getDisputeDetail", () => {
  it("calls get_dispute_detail with the dispute id", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getDisputeDetail("dispute-1");
    expect(rpcMock).toHaveBeenCalledWith("get_dispute_detail", { p_dispute_id: "dispute-1" });
  });

  it("maps a found row", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getDisputeDetail("dispute-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.dispute.reason).toBe("Item never arrived");
    expect(result.dispute.isMineOpened).toBe(true);
  });

  it("returns not_found for DISPUTE_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "DISPUTE_NOT_FOUND" } });
    const result = await getDisputeDetail("dispute-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found for NOT_DISPUTE_PARTICIPANT -- indistinguishable from nonexistent", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_DISPUTE_PARTICIPANT" } });
    const result = await getDisputeDetail("dispute-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns error for any other failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getDisputeDetail("dispute-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getDisputeDetail("dispute-1");
    expect(result).toEqual({ status: "error" });
  });
});
