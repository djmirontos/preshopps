import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminDisputeMessages } from "@/lib/admin/get-admin-dispute-messages";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminDisputeMessages", () => {
  it("calls get_admin_dispute_messages with the dispute id", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getAdminDisputeMessages("dispute-1");
    expect(rpcMock).toHaveBeenCalledWith("get_admin_dispute_messages", { p_dispute_id: "dispute-1" });
  });

  it("maps rows, preserving isFromBuyer", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          message_id: "msg-1",
          conversation_id: "conv-1",
          sender_id: "buyer-1",
          is_from_buyer: true,
          body: "Where is my order?",
          created_at: "2026-01-04T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const result = await getAdminDisputeMessages("dispute-1");
    expect(result).toEqual({
      status: "found",
      messages: [
        {
          messageId: "msg-1",
          conversationId: "conv-1",
          senderId: "buyer-1",
          isFromBuyer: true,
          body: "Where is my order?",
          createdAt: "2026-01-04T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns not_admin for NOT_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await getAdminDisputeMessages("dispute-1");
    expect(result).toEqual({ status: "not_admin" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminDisputeMessages("dispute-1");
    expect(result).toEqual({ status: "error" });
  });
});
