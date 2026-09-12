import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/session";

const { rpcMock, createClientMock, getAuthUserMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyGeneralNotificationUnreadCount } from "@/lib/notifications/get-my-general-notification-unread-count";

beforeEach(() => {
  rpcMock.mockReset();
  getAuthUserMock.mockReset();
});

describe("getMyGeneralNotificationUnreadCount", () => {
  it("returns 0 for a guest without ever calling the RPC (no round trip)", async () => {
    getAuthUserMock.mockResolvedValue(null);
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls get_my_general_notification_unread_count with no arguments for an authenticated user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({ data: 4, error: null });
    await getMyGeneralNotificationUnreadCount();
    expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count");
  });

  it("returns the exact integer the RPC reports -- excludes new_message by construction server-side", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({ data: 7, error: null });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toBe(7);
  });

  it("returns 0 on an RPC error rather than throwing", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toBe(0);
  });

  it("returns 0 when the RPC throws (network failure)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toBe(0);
  });

  it("returns 0 for a non-numeric response instead of trusting an unexpected shape", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({ data: [{ read_at: null }], error: null });
    const result = await getMyGeneralNotificationUnreadCount();
    expect(result).toBe(0);
  });
});
