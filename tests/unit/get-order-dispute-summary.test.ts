import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getOrderDisputeSummary } from "@/lib/disputes/get-order-dispute-summary";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getOrderDisputeSummary", () => {
  it("calls get_order_dispute_summary with the order id", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getOrderDisputeSummary("order-1");
    expect(rpcMock).toHaveBeenCalledWith("get_order_dispute_summary", { p_order_id: "order-1" });
  });

  it("returns summary: null (not an error) when no dispute exists for this order", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getOrderDisputeSummary("order-1");
    expect(result).toEqual({ status: "found", summary: null });
  });

  it("maps a found row", async () => {
    rpcMock.mockResolvedValue({ data: [{ dispute_id: "dispute-1", status: "under_review" }], error: null });
    const result = await getOrderDisputeSummary("order-1");
    expect(result).toEqual({ status: "found", summary: { disputeId: "dispute-1", status: "under_review" } });
  });

  it("returns error on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getOrderDisputeSummary("order-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getOrderDisputeSummary("order-1");
    expect(result).toEqual({ status: "error" });
  });
});
