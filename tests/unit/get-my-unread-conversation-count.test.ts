import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { getMyUnreadConversationCount } from "@/lib/messaging/get-my-unread-conversation-count";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyUnreadConversationCount", () => {
  it("calls the exact scalar RPC (0088) with no arguments", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    await getMyUnreadConversationCount();

    expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count");
  });

  it("returns the exact integer the RPC reports", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const count = await getMyUnreadConversationCount();
    expect(count).toBe(3);
  });

  it("returns 0 when the RPC reports 0", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const count = await getMyUnreadConversationCount();
    expect(count).toBe(0);
  });

  it("returns 0 (never throws) when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const count = await getMyUnreadConversationCount();
    expect(count).toBe(0);
  });

  it("returns 0 (never throws) when the RPC call itself throws", async () => {
    rpcMock.mockRejectedValue(new Error("network error"));
    const count = await getMyUnreadConversationCount();
    expect(count).toBe(0);
  });

  it("returns 0 for a non-numeric response instead of trusting an unexpected shape", async () => {
    rpcMock.mockResolvedValue({ data: [{ is_unread: true }], error: null });
    const count = await getMyUnreadConversationCount();
    expect(count).toBe(0);
  });

  it("never sends a client-supplied user/recipient id -- caller is derived from auth.uid() server-side", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    await getMyUnreadConversationCount();

    const call = rpcMock.mock.calls[0];
    expect(call).toHaveLength(1);
  });
});
