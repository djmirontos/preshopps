import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyNotifications } from "@/lib/notifications/get-my-notifications";

function row(overrides: Record<string, unknown> = {}) {
  return {
    notification_id: "notif-1",
    type: "order_accepted",
    created_at: "2026-02-01T10:00:00.000Z",
    read_at: null,
    actor_display_name: "Anne's Closet",
    actor_avatar_path: null,
    order_id: "order-1",
    order_public_code: "PSO-ABC12345",
    conversation_id: null,
    conversation_listing_title: null,
    review_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyNotifications", () => {
  it("calls get_my_notifications with the limit and null cursor on first page (no client-supplied user id)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getMyNotifications(20);
    expect(rpcMock).toHaveBeenCalledWith("get_my_notifications", {
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the cursor through on subsequent pages", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyNotifications(20, { createdAt: "2026-01-01T00:00:00.000Z", id: "notif-5" });
    expect(rpcMock).toHaveBeenCalledWith("get_my_notifications", {
      p_limit: 20,
      p_before_created_at: "2026-01-01T00:00:00.000Z",
      p_before_id: "notif-5",
    });
  });

  it("maps rows to NotificationItem", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyNotifications(20);
    expect(result.hadError).toBe(false);
    expect(result.notifications).toEqual([
      {
        notificationId: "notif-1",
        type: "order_accepted",
        createdAt: "2026-02-01T10:00:00.000Z",
        readAt: null,
        actorDisplayName: "Anne's Closet",
        actorAvatarUrl: undefined,
        orderId: "order-1",
        orderPublicCode: "PSO-ABC12345",
        conversationId: null,
        conversationListingTitle: null,
        reviewId: null,
      },
    ]);
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ notification_id: "n1", created_at: "2026-02-01T00:00:00.000Z" }), row({ notification_id: "n2", created_at: "2026-01-30T00:00:00.000Z" })],
      error: null,
    });
    const result = await getMyNotifications(2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-30T00:00:00.000Z", id: "n2" });
  });

  it("returns nextCursor: null when fewer rows than the limit come back (last page)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyNotifications(20);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError true, empty notifications, on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyNotifications(20);
    expect(result).toEqual({ notifications: [], hadError: true, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyNotifications(20);
    expect(result).toEqual({ notifications: [], hadError: true, nextCursor: null });
  });

  it("preserves read_at so read/unread state renders correctly", async () => {
    rpcMock.mockResolvedValue({ data: [row({ read_at: "2026-02-01T11:00:00.000Z" })], error: null });
    const result = await getMyNotifications(20);
    expect(result.notifications[0].readAt).toBe("2026-02-01T11:00:00.000Z");
  });
});
