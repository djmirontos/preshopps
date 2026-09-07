import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { markNotificationRead, markAllNotificationsRead } from "@/lib/notifications/notification-actions";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("markNotificationRead", () => {
  it("calls mark_notification_read with only the notification id (no client-supplied user id)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await markNotificationRead("notif-1");
    expect(rpcMock).toHaveBeenCalledWith("mark_notification_read", { p_notification_id: "notif-1" });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args)).toEqual(["p_notification_id"]);
  });

  it("returns ok: true on success", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await markNotificationRead("notif-1");
    expect(result).toEqual({ ok: true });
  });

  it("returns ok: false on an RPC error rather than throwing or leaking raw details", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation notifications does not exist" } });
    const result = await markNotificationRead("notif-1");
    expect(result).toEqual({ ok: false });
  });

  it("returns ok: false when the RPC throws (network failure)", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await markNotificationRead("notif-1");
    expect(result).toEqual({ ok: false });
  });
});

describe("markAllNotificationsRead", () => {
  it("calls mark_all_notifications_read with no arguments", async () => {
    rpcMock.mockResolvedValue({ data: 4, error: null });
    await markAllNotificationsRead();
    expect(rpcMock).toHaveBeenCalledWith("mark_all_notifications_read");
  });

  it("returns ok: true with the marked count on success", async () => {
    rpcMock.mockResolvedValue({ data: 4, error: null });
    const result = await markAllNotificationsRead();
    expect(result).toEqual({ ok: true, markedCount: 4 });
  });

  it("returns ok: false on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await markAllNotificationsRead();
    expect(result).toEqual({ ok: false });
  });

  it("returns ok: false when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await markAllNotificationsRead();
    expect(result).toEqual({ ok: false });
  });
});
