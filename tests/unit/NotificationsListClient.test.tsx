import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { NotificationItem } from "@/lib/notifications/get-my-notifications";

const { markNotificationReadMock, markAllNotificationsReadMock, refreshMock, channelOnCalls, channelNameCalls, removeChannelMock } = vi.hoisted(() => ({
  markNotificationReadMock: vi.fn(),
  markAllNotificationsReadMock: vi.fn(),
  refreshMock: vi.fn(),
  channelOnCalls: [] as Array<{ event: string; config: unknown; callback: (payload: { new: unknown }) => void }>,
  channelNameCalls: [] as string[],
  removeChannelMock: vi.fn(),
}));

vi.mock("@/lib/notifications/notification-actions", () => ({
  markNotificationRead: markNotificationReadMock,
  markAllNotificationsRead: markAllNotificationsReadMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makeFakeChannel() {
  const fakeChannel = {
    on: vi.fn((event: string, config: never, callback: (payload: { new: unknown }) => void) => {
      channelOnCalls.push({ event, config, callback });
      return fakeChannel;
    }),
    subscribe: vi.fn(() => fakeChannel),
  };
  return fakeChannel;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      channelNameCalls.push(name);
      return makeFakeChannel();
    },
    removeChannel: removeChannelMock,
  }),
}));

import { NotificationsListClient } from "@/components/notifications/NotificationsListClient";
import { NotificationsProvider, useNotificationsUnreadCount } from "@/components/notifications/NotificationsProvider";

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
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
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

function latestNotificationsCallback() {
  const registration = channelOnCalls[channelOnCalls.length - 1];
  if (!registration) throw new Error("No postgres_changes subscription was registered");
  return registration.callback;
}

function fireIncomingNotification(row: {
  id: string;
  recipient_id: string;
  type: string;
  actor_id: string | null;
  order_id: string | null;
  conversation_id: string | null;
  review_id: string | null;
  created_at: string;
  read_at: string | null;
}) {
  act(() => {
    latestNotificationsCallback()({ new: row });
  });
}

function UnreadCountProbe() {
  const count = useNotificationsUnreadCount();
  return <p data-testid="probe-count">{count}</p>;
}

/** Renders the real list alongside a small probe reading the same shared
 * count, both inside one live NotificationsProvider -- proves the list's
 * own mark-read handlers actually flow through to the Provider, not just
 * that the list's local row state changes. */
function renderListWithProvider(notifications: NotificationItem[], initialUnreadCount = notifications.filter((n) => n.readAt === null).length) {
  return render(
    <NotificationsProvider isAuthenticated userId="me" initialUnreadCount={initialUnreadCount}>
      <UnreadCountProbe />
      <NotificationsListClient initialNotifications={notifications} initialHadError={false} initialCursor={null} loadMore={loadMoreMock} />
    </NotificationsProvider>,
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

describe("NotificationsListClient -- live updates via the shared Provider", () => {
  it("prepends an incoming notification without a page reload, reusing the Provider's own channel (no second subscription)", () => {
    renderListWithProvider([makeNotification({ notificationId: "notif-existing", type: "order_ready" })]);
    expect(channelNameCalls).toHaveLength(1);

    fireIncomingNotification({
      id: "notif-new",
      recipient_id: "me",
      type: "new_message",
      actor_id: "other-user-1",
      order_id: null,
      conversation_id: "conv-1",
      review_id: null,
      created_at: "2026-02-02T09:00:00.000Z",
      read_at: null,
    });

    expect(screen.getByText("New message")).toBeInTheDocument();
    expect(screen.getByText("Order ready")).toBeInTheDocument();
    // Still only one subscription was ever opened.
    expect(channelNameCalls).toHaveLength(1);
  });

  it("prepends the new item above the existing rows, preserving order", () => {
    renderListWithProvider([makeNotification({ notificationId: "notif-existing", type: "order_ready" })]);

    fireIncomingNotification({
      id: "notif-new",
      recipient_id: "me",
      type: "new_message",
      actor_id: "other-user-1",
      order_id: null,
      conversation_id: "conv-1",
      review_id: null,
      created_at: "2026-02-02T09:00:00.000Z",
      read_at: null,
    });

    const titles = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const newIndex = titles.findIndex((text) => text.includes("New message"));
    const existingIndex = titles.findIndex((text) => text.includes("Order ready"));
    expect(newIndex).toBeLessThan(existingIndex);
  });

  it("never renders a duplicate row for the same notification id, even if it somehow arrives twice", () => {
    renderListWithProvider([makeNotification({ notificationId: "notif-existing", type: "order_ready" })]);

    fireIncomingNotification({
      id: "notif-new",
      recipient_id: "me",
      type: "new_message",
      actor_id: "other-user-1",
      order_id: null,
      conversation_id: "conv-1",
      review_id: null,
      created_at: "2026-02-02T09:00:00.000Z",
      read_at: null,
    });
    // A second, distinct-looking event carrying the exact same id (the
    // Provider itself already dedupes this in real usage; this list-level
    // check is a defensive second layer).
    fireIncomingNotification({
      id: "notif-new",
      recipient_id: "me",
      type: "new_message",
      actor_id: "other-user-1",
      order_id: null,
      conversation_id: "conv-1",
      review_id: null,
      created_at: "2026-02-02T09:00:00.000Z",
      read_at: null,
    });

    expect(screen.getAllByText("New message")).toHaveLength(1);
  });

  it("clicking an unread linkable row decrements the shared unread count exactly once", async () => {
    renderListWithProvider([makeNotification({ notificationId: "notif-1", readAt: null })], 1);
    markNotificationReadMock.mockResolvedValue({ ok: true });

    expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("link", { name: /order accepted/i }));

    await waitFor(() => expect(screen.getByTestId("probe-count")).toHaveTextContent("0"));
  });

  it("Mark all read zeros the shared unread count", async () => {
    markAllNotificationsReadMock.mockResolvedValue({ ok: true, markedCount: 1 });
    renderListWithProvider([makeNotification({ notificationId: "notif-1", readAt: null })], 1);

    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    await waitFor(() => expect(screen.getByTestId("probe-count")).toHaveTextContent("0"));
  });
});
