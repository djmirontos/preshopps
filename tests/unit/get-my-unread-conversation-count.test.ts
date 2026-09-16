import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { getMyUnreadConversationCount } from "@/lib/messaging/get-my-unread-conversation-count";

beforeEach(() => {
  rpcMock.mockReset();
});

/**
 * P1 fix: this helper returns a discriminated result rather than
 * collapsing every failure to a bare 0 -- a fabricated 0 is
 * indistinguishable from a genuine "no unread conversations" count to a
 * caller, which is exactly what let NotificationsProvider's
 * refreshUnreadMessageCount clear a real non-zero Messages badge on a
 * transient RPC/network failure. See NotificationsProvider.test.tsx for
 * the caller-side half of this fix.
 */
describe("getMyUnreadConversationCount", () => {
  it("calls the exact scalar RPC (0088) with no arguments", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    await getMyUnreadConversationCount();

    expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count");
  });

  it("1. returns { ok: true, count: 3 } for a successful RPC reporting 3", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const result = await getMyUnreadConversationCount();
    expect(result).toEqual({ ok: true, count: 3 });
  });

  it("2. returns { ok: true, count: 0 } for a successful RPC reporting a genuine 0 -- not treated as a failure", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const result = await getMyUnreadConversationCount();
    expect(result).toEqual({ ok: true, count: 0 });
  });

  it("3. returns { ok: false } (never a fabricated count) when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyUnreadConversationCount();
    expect(result).toEqual({ ok: false });
  });

  it("4. returns { ok: false } (never a fabricated count) when the RPC call itself throws", async () => {
    rpcMock.mockRejectedValue(new Error("network error"));
    const result = await getMyUnreadConversationCount();
    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: false } for a non-numeric response instead of trusting an unexpected shape", async () => {
    rpcMock.mockResolvedValue({ data: [{ is_unread: true }], error: null });
    const result = await getMyUnreadConversationCount();
    expect(result).toEqual({ ok: false });
  });

  it("never sends a client-supplied user/recipient id -- caller is derived from auth.uid() server-side", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    await getMyUnreadConversationCount();

    const call = rpcMock.mock.calls[0];
    expect(call).toHaveLength(1);
  });

  it("11. never exposes the raw Supabase error message in the returned result -- only { ok: false }", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });
    const result = await getMyUnreadConversationCount();
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toMatch(/raw backend detail/);
  });
});
