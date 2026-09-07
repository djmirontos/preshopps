import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { NotificationItem, GetMyNotificationsResult } from "@/lib/notifications/get-my-notifications";

const { getAuthUserMock, getMyNotificationsMock, redirectMock, refreshMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyNotificationsMock: vi.fn<() => Promise<GetMyNotificationsResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/notifications/get-my-notifications", () => ({
  getMyNotifications: getMyNotificationsMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ refresh: refreshMock }),
}));

import NotificationsPage from "@/app/notifications/page";

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    notificationId: "11111111-1111-1111-1111-111111111111",
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
    ...overrides,
  };
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with next=/notifications before fetching any notification data", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(NotificationsPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fnotifications");
    expect(getMyNotificationsMock).not.toHaveBeenCalled();
  });

  it("shows the empty state with supporting copy for an authenticated user with no notifications", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({ notifications: [], hadError: false, nextCursor: null });

    render(await NotificationsPage());

    expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Updates about your orders, messages, and marketplace activity will appear here."),
    ).toBeInTheDocument();
  });

  it("renders one h1 and the populated notification list", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({ notifications: [makeNotification()], hadError: false, nextCursor: null });

    render(await NotificationsPage());

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("Order accepted")).toBeInTheDocument();
  });

  it("renders newest-first (whatever order the RPC returns, never reordered client-side)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({
      notifications: [
        makeNotification({ notificationId: "n1", type: "order_ready", createdAt: "2026-02-02T00:00:00.000Z" }),
        makeNotification({ notificationId: "n2", type: "order_accepted", createdAt: "2026-02-01T00:00:00.000Z" }),
      ],
      hadError: false,
      nextCursor: null,
    });

    render(await NotificationsPage());
    const titles = screen.getAllByText(/^Order (ready|accepted)$/).map((el) => el.textContent);
    expect(titles).toEqual(["Order ready", "Order accepted"]);
  });

  it("visually distinguishes unread from read without relying on color alone", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({
      notifications: [
        makeNotification({ notificationId: "unread-1", readAt: null }),
        makeNotification({ notificationId: "read-1", readAt: "2026-02-01T12:00:00.000Z" }),
      ],
      hadError: false,
      nextCursor: null,
    });

    render(await NotificationsPage());
    // sr-only "(unread)" text makes the state available to assistive tech,
    // not just a color/weight difference.
    expect(screen.getAllByText("(unread)", { selector: ".sr-only" })).toHaveLength(1);
  });

  it("never renders a raw notification/order UUID as visible text", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({
      notifications: [makeNotification({ notificationId: "11111111-1111-1111-1111-111111111111", orderId: "22222222-2222-2222-2222-222222222222" })],
      hadError: false,
      nextCursor: null,
    });

    render(await NotificationsPage());
    expect(screen.queryByText(/11111111-1111-1111-1111-111111111111|22222222-2222-2222-2222-222222222222/)).not.toBeInTheDocument();
  });

  it("shows a safe error state (not a crash) when the RPC fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({ notifications: [], hadError: true, nextCursor: null });

    render(await NotificationsPage());
    expect(screen.getByText(/unable to load your notifications right now/i)).toBeInTheDocument();
  });

  it("links a buyer-role order notification to /orders/{code}", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({
      notifications: [makeNotification({ type: "order_ready", orderPublicCode: "PSO-ABC12345" })],
      hadError: false,
      nextCursor: null,
    });

    render(await NotificationsPage());
    expect(screen.getByRole("link", { name: /order ready/i })).toHaveAttribute("href", "/orders/PSO-ABC12345");
  });

  it("links a seller-role order notification to /seller/orders/{code}", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({
      notifications: [makeNotification({ type: "order_request_received", orderPublicCode: "PSO-ABC12345" })],
      hadError: false,
      nextCursor: null,
    });

    render(await NotificationsPage());
    expect(screen.getByRole("link", { name: /new order request/i })).toHaveAttribute("href", "/seller/orders/PSO-ABC12345");
  });

  it("links a message notification to /messages/{conversationId}", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({
      notifications: [makeNotification({ type: "new_message", orderPublicCode: null, conversationId: "conv-1" })],
      hadError: false,
      nextCursor: null,
    });

    render(await NotificationsPage());
    expect(screen.getByRole("link", { name: /new message/i })).toHaveAttribute("href", "/messages/conv-1");
  });

  it("does not render a link for order_completed -- no safe role-specific destination exists", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyNotificationsMock.mockResolvedValue({
      notifications: [makeNotification({ type: "order_completed", orderPublicCode: "PSO-ABC12345" })],
      hadError: false,
      nextCursor: null,
    });

    render(await NotificationsPage());
    expect(screen.queryByRole("link", { name: /order completed/i })).not.toBeInTheDocument();
    expect(screen.getByText("Order completed")).toBeInTheDocument();
  });
});
