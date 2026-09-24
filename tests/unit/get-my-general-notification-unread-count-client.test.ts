import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { getMyGeneralNotificationUnreadCount } from "@/lib/notifications/get-my-general-notification-unread-count-client";

beforeEach(() => {
  rpcMock.mockReset();
});

/**
 * Browser-client counterpart to get-my-general-notification-unread-
 * count.ts (server-only, SSR seed). Mirrors getMyUnreadConversationCount's
 * own discriminated-result contract exactly: a failure never collapses to
 * a fabricated 0, since that would be indistinguishable from a genuine
 * "no unread notifications" count to NotificationsProvider's
 * refreshUnreadNotificationCount, which must never clear a real non-zero
 * Bell badge on a transient RPC/network failure.
 */
describe("getMyGeneralNotificationUnreadCount", () => {
  it("calls the exact scalar RPC (0088) with no arguments", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    await getMyGeneralNotificationUnreadCount();

    expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count");
  });

  it("returns { ok: true, count: 3 } for a successful RPC reporting 3", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toEqual({ ok: true, count: 3 });
  });

  it("returns { ok: true, count: 0 } for a successful RPC reporting a genuine 0 -- not treated as a failure", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toEqual({ ok: true, count: 0 });
  });

  it("returns { ok: false } (never a fabricated count) when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: false } (never a fabricated count) when the RPC call itself throws", async () => {
    rpcMock.mockRejectedValue(new Error("network error"));
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: false } for a non-numeric response instead of trusting an unexpected shape", async () => {
    rpcMock.mockResolvedValue({ data: [{ type: "order_accepted" }], error: null });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toEqual({ ok: false });
  });

  it("never sends a client-supplied user/recipient id -- caller is derived from auth.uid() server-side", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    await getMyGeneralNotificationUnreadCount();

    const call = rpcMock.mock.calls[0];
    expect(call).toHaveLength(1);
  });

  it("never exposes the raw Supabase error message in the returned result -- only { ok: false }", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toMatch(/raw backend detail/);
  });
});
