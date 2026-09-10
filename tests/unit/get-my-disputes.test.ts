import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyDisputes } from "@/lib/disputes/get-my-disputes";

function row(overrides: Record<string, unknown> = {}) {
  return {
    dispute_id: "dispute-1",
    order_id: "order-1",
    order_public_code: "PSO-ABC",
    status: "opened",
    reason: "Item never arrived",
    opened_by: "buyer-1",
    is_mine_opened: true,
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyDisputes", () => {
  it("calls get_my_disputes with limit and null cursor on the first page", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getMyDisputes(20);
    expect(rpcMock).toHaveBeenCalledWith("get_my_disputes", { p_limit: 20, p_before_created_at: null, p_before_id: null });
  });

  it("maps rows to MyDisputeSummary", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyDisputes(20);
    expect(result.disputes).toEqual([
      {
        disputeId: "dispute-1",
        orderId: "order-1",
        orderPublicCode: "PSO-ABC",
        status: "opened",
        reason: "Item never arrived",
        openedBy: "buyer-1",
        isMineOpened: true,
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ]);
  });

  it("returns hadError true when the RPC fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyDisputes(20);
    expect(result).toEqual({ disputes: [], hadError: true, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyDisputes(20);
    expect(result).toEqual({ disputes: [], hadError: true, nextCursor: null });
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ dispute_id: "d1", created_at: "2026-01-05T00:00:00.000Z" }), row({ dispute_id: "d2", created_at: "2026-01-04T00:00:00.000Z" })],
      error: null,
    });
    const result = await getMyDisputes(2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-04T00:00:00.000Z", id: "d2" });
  });

  it("returns an empty list (not an error) when there are no disputes", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getMyDisputes(20);
    expect(result).toEqual({ disputes: [], hadError: false, nextCursor: null });
  });
});
