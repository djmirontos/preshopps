import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NotificationItem } from "@/lib/notifications/get-my-notifications";

const { markNotificationReadMock, markAllNotificationsReadMock, refreshMock } = vi.hoisted(() => ({
  markNotificationReadMock: vi.fn(),
  markAllNotificationsReadMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/notifications/notification-actions", () => ({
  markNotificationRead: markNotificationReadMock,
  markAllNotificationsRead: markAllNotificationsReadMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { NotificationsListClient } from "@/components/notifications/NotificationsListClient";

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
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
    ...overrides,
  };
}

const loadMoreMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  loadMoreMock.mockReset();
});

function renderList(notifications: NotificationItem[]) {
  return render(
    <NotificationsListClient
      initialNotifications={notifications}
      initialHadError={false}
      initialCursor={null}
      loadMore={loadMoreMock}
    />,
  );
}

describe("NotificationsListClient -- linkable rows mark read on click", () => {
  it("marks an unread, linkable notification read when its link is clicked (fire-and-forget, non-blocking)", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: true });
    renderList([makeNotification({ readAt: null })]);

    fireEvent.click(screen.getByRole("link", { name: /order accepted/i }));

    await waitFor(() => expect(markNotificationReadMock).toHaveBeenCalledWith("notif-1"));
  });

  it("never sends an arbitrary user id -- only the notification id", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: true });
    renderList([makeNotification()]);
    fireEvent.click(screen.getByRole("link", { name: /order accepted/i }));
    await waitFor(() => expect(markNotificationReadMock).toHaveBeenCalledWith("notif-1"));
    expect(markNotificationReadMock.mock.calls[0]).toHaveLength(1);
  });

  it("does not re-call mark-read for an already-read linkable notification", () => {
    renderList([makeNotification({ readAt: "2026-02-01T11:00:00.000Z" })]);
    fireEvent.click(screen.getByRole("link", { name: /order accepted/i }));
    expect(markNotificationReadMock).not.toHaveBeenCalled();
  });
});

describe("NotificationsListClient -- non-linkable rows get an explicit Mark read control", () => {
  it("shows a Mark read button for an unread order_completed notification (no safe link exists)", () => {
    renderList([makeNotification({ type: "order_completed", readAt: null })]);
    expect(screen.queryByRole("link", { name: /order completed/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark read" })).toBeInTheDocument();
  });

  it("clicking Mark read calls markNotificationRead and refreshes (stays on this page)", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: true });
    renderList([makeNotification({ type: "order_completed", readAt: null })]);

    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() => expect(markNotificationReadMock).toHaveBeenCalledWith("notif-1"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("hides the Mark read control once already read", () => {
    renderList([makeNotification({ type: "order_completed", readAt: "2026-02-01T11:00:00.000Z" })]);
    expect(screen.queryByRole("button", { name: "Mark read" })).not.toBeInTheDocument();
  });
});

describe("NotificationsListClient -- mark all read", () => {
  it("shows Mark all read only when at least one unread notification exists", () => {
    renderList([makeNotification({ readAt: "2026-02-01T11:00:00.000Z" })]);
    expect(screen.queryByRole("button", { name: /mark all read/i })).not.toBeInTheDocument();
  });

  it("is not visually dominant -- a small text-style control, not a large/primary button", () => {
    renderList([makeNotification({ readAt: null })]);
    const button = screen.getByRole("button", { name: /mark all read/i });
    expect(button.className).toMatch(/text-xs/);
    expect(button.className).not.toMatch(/bg-brand-action/);
  });

  it("calls markAllNotificationsRead with no arguments and refreshes on success", async () => {
    markAllNotificationsReadMock.mockResolvedValue({ ok: true, markedCount: 2 });
    renderList([makeNotification({ readAt: null })]);

    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    await waitFor(() => expect(markAllNotificationsReadMock).toHaveBeenCalledWith());
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("shows a safe error message on failure, without a raw backend error", async () => {
    markAllNotificationsReadMock.mockResolvedValue({ ok: false });
    renderList([makeNotification({ readAt: null })]);

    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    await waitFor(() => expect(screen.getByText(/unable to mark all as read/i)).toBeInTheDocument());
  });
});

describe("NotificationsListClient -- empty and error states", () => {
  it("shows the empty state with supporting copy", () => {
    renderList([]);
    expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
    expect(screen.getByText("Updates about your orders, messages, and marketplace activity will appear here.")).toBeInTheDocument();
  });

  it("shows a safe error state when the initial load failed", () => {
    render(<NotificationsListClient initialNotifications={[]} initialHadError={true} initialCursor={null} loadMore={loadMoreMock} />);
    expect(screen.getByText(/unable to load your notifications right now/i)).toBeInTheDocument();
  });
});

describe("NotificationsListClient -- pagination", () => {
  it("shows Load more when a cursor is present, and appends the fetched page on click", async () => {
    loadMoreMock.mockResolvedValue({
      notifications: [makeNotification({ notificationId: "notif-2", type: "order_ready" })],
      hadError: false,
      nextCursor: null,
    });

    render(
      <NotificationsListClient
        initialNotifications={[makeNotification()]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-01T00:00:00.000Z", id: "notif-1" }}
        loadMore={loadMoreMock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getByText("Order ready")).toBeInTheDocument());
    expect(screen.getByText("Order accepted")).toBeInTheDocument();
  });

  it("shows a safe error message when Load more fails", async () => {
    loadMoreMock.mockResolvedValue({ notifications: [], hadError: true, nextCursor: null });
    render(
      <NotificationsListClient
        initialNotifications={[makeNotification()]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-01T00:00:00.000Z", id: "notif-1" }}
        loadMore={loadMoreMock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getByText(/unable to load more notifications/i)).toBeInTheDocument());
  });
});
