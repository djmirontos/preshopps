import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import type { NotificationItem } from "@/lib/notifications/get-my-notifications";

const {
  markNotificationReadMock,
  markAllNotificationsReadMock,
  dismissNotificationMock,
  dismissAllNotificationsMock,
  refreshMock,
  channelOnCalls,
  channelNameCalls,
  removeChannelMock,
  getSessionMock,
} = vi.hoisted(() => ({
  markNotificationReadMock: vi.fn(),
  markAllNotificationsReadMock: vi.fn(),
  dismissNotificationMock: vi.fn(),
  dismissAllNotificationsMock: vi.fn(),
  refreshMock: vi.fn(),
  channelOnCalls: [] as Array<{ event: string; config: unknown; callback: (payload: { new: unknown }) => void }>,
  channelNameCalls: [] as string[],
  removeChannelMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/notifications/notification-actions", () => ({
  markNotificationRead: markNotificationReadMock,
  markAllNotificationsRead: markAllNotificationsReadMock,
  dismissNotification: dismissNotificationMock,
  dismissAllNotifications: dismissAllNotificationsMock,
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
    auth: { getSession: getSessionMock },
    channel: (name: string) => {
      channelNameCalls.push(name);
      return makeFakeChannel();
    },
    removeChannel: removeChannelMock,
  }),
}));

import { NotificationsListClient } from "@/components/notifications/NotificationsListClient";
import { NotificationsProvider, useUnreadNotificationCount, useUnreadMessageCount } from "@/components/notifications/NotificationsProvider";

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

function UnreadMessageCountProbe() {
  const count = useUnreadMessageCount();
  return <p data-testid="probe-message-count">{count}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadMoreMock.mockReset();
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
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

async function latestNotificationsCallback() {
  await waitFor(() => expect(channelOnCalls.length).toBeGreaterThan(0));
  return channelOnCalls[channelOnCalls.length - 1].callback;
}

async function fireIncomingNotification(row: {
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
  const callback = await latestNotificationsCallback();
  act(() => {
    callback({ new: row });
  });
}

function UnreadCountProbe() {
  const count = useUnreadNotificationCount();
  return <p data-testid="probe-count">{count}</p>;
}

/** Renders the real list alongside a small probe reading the same shared
 * count, both inside one live NotificationsProvider -- proves the list's
 * own mark-read handlers actually flow through to the Provider, not just
 * that the list's local row state changes. Uses unreadNotificationCount
 * specifically (the Bell's own count) -- this list is general
 * notifications, never messages. */
function renderListWithProvider(
  notifications: NotificationItem[],
  initialUnreadNotificationCount = notifications.filter((n) => n.readAt === null).length,
  initialUnreadMessageCount = 0,
) {
  return render(
    <NotificationsProvider isAuthenticated userId="me" initialUnreadMessageCount={initialUnreadMessageCount} initialUnreadNotificationCount={initialUnreadNotificationCount}>
      <UnreadCountProbe />
      <UnreadMessageCountProbe />
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
  it("prepends an incoming notification without a page reload, reusing the Provider's own channel (no second subscription)", async () => {
    renderListWithProvider([makeNotification({ notificationId: "notif-existing", type: "order_ready" })]);
    await waitFor(() => expect(channelNameCalls).toHaveLength(1));

    await fireIncomingNotification({
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

  it("prepends the new item above the existing rows, preserving order", async () => {
    renderListWithProvider([makeNotification({ notificationId: "notif-existing", type: "order_ready" })]);

    await fireIncomingNotification({
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

  it("never renders a duplicate row for the same notification id, even if it somehow arrives twice", async () => {
    renderListWithProvider([makeNotification({ notificationId: "notif-existing", type: "order_ready" })]);

    await fireIncomingNotification({
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
    await fireIncomingNotification({
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

describe("NotificationsListClient -- individual dismiss (no confirmation)", () => {
  it("every row has an accessible Dismiss notification control", () => {
    renderList([makeNotification()]);
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeInTheDocument();
  });

  it("dismissing an unread general notification removes the row immediately and decrements the Bell count exactly once, with no confirmation dialog", async () => {
    dismissNotificationMock.mockResolvedValue({ ok: true });
    renderListWithProvider([makeNotification({ notificationId: "notif-1", type: "order_accepted", readAt: null })], 1);

    expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    // No confirmation dialog appears for a single dismiss.
    expect(screen.queryByText("Clear all notifications?")).not.toBeInTheDocument();
    expect(screen.queryByText("Order accepted")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-count")).toHaveTextContent("0");
    await waitFor(() => expect(dismissNotificationMock).toHaveBeenCalledWith("notif-1"));
  });

  it("dismissing a read general notification removes the row but leaves the Bell count unchanged", async () => {
    dismissNotificationMock.mockResolvedValue({ ok: true });
    renderListWithProvider(
      [makeNotification({ notificationId: "notif-1", type: "order_accepted", readAt: "2026-02-01T11:00:00.000Z" })],
      0,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(screen.queryByText("Order accepted")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-count")).toHaveTextContent("0");
    await waitFor(() => expect(dismissNotificationMock).toHaveBeenCalledWith("notif-1"));
  });

  it("dismissing an unread new_message notification removes the row but never touches the Bell count or the Messages badge", async () => {
    dismissNotificationMock.mockResolvedValue({ ok: true });
    renderListWithProvider(
      [makeNotification({ notificationId: "notif-1", type: "new_message", conversationId: "conv-1", readAt: null })],
      0,
      3,
    );

    expect(screen.getByTestId("probe-message-count")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(screen.queryByText("New message")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-count")).toHaveTextContent("0");
    expect(screen.getByTestId("probe-message-count")).toHaveTextContent("3");
    await waitFor(() => expect(dismissNotificationMock).toHaveBeenCalledWith("notif-1"));
  });

  it("clicking the X does not navigate the linkable row's Link (X is a sibling, not nested inside it)", () => {
    renderList([makeNotification({ notificationId: "notif-1" })]);
    const dismissButton = screen.getByRole("button", { name: "Dismiss notification" });
    const link = screen.getByRole("link", { name: /order accepted/i });
    expect(link).not.toContainElement(dismissButton);
  });

  it("restores the row and the Bell count, and shows a safe error, when the dismiss RPC fails", async () => {
    dismissNotificationMock.mockResolvedValue({ ok: false });
    renderListWithProvider([makeNotification({ notificationId: "notif-1", type: "order_accepted", readAt: null })], 1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    // Optimistic removal happens immediately...
    expect(screen.queryByText("Order accepted")).not.toBeInTheDocument();
    expect(screen.getByTestId("probe-count")).toHaveTextContent("0");

    // ...then rolls back once the RPC reports failure, with no raw backend error shown.
    await waitFor(() => expect(screen.getByText("Order accepted")).toBeInTheDocument());
    expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
    expect(screen.getByText(/unable to dismiss that notification/i)).toBeInTheDocument();
  });

  it("calls dismiss_notification with only the notification id, never a user id", async () => {
    dismissNotificationMock.mockResolvedValue({ ok: true });
    renderList([makeNotification({ notificationId: "notif-1" })]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => expect(dismissNotificationMock).toHaveBeenCalledWith("notif-1"));
    expect(dismissNotificationMock.mock.calls[0]).toHaveLength(1);
  });
});

describe("NotificationsListClient -- Clear All requires confirmation", () => {
  it("clicking Clear all opens a confirmation dialog with the exact locked copy, without dismissing anything yet", () => {
    renderList([makeNotification()]);
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));

    expect(screen.getByText("Clear all notifications?")).toBeInTheDocument();
    expect(
      screen.getByText("This will remove all notifications from your list. This won't affect your orders, messages, or other marketplace activity."),
    ).toBeInTheDocument();
    expect(dismissAllNotificationsMock).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog and changes nothing", () => {
    renderList([makeNotification()]);
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Clear all notifications?")).not.toBeInTheDocument();
    expect(screen.getByText("Order accepted")).toBeInTheDocument();
    expect(dismissAllNotificationsMock).not.toHaveBeenCalled();
  });

  it("confirming Clear All dismisses every visible notification, including new_message rows, and zeros the Bell count", async () => {
    dismissAllNotificationsMock.mockResolvedValue({ ok: true, dismissedCount: 2 });
    renderListWithProvider(
      [
        makeNotification({ notificationId: "notif-1", type: "order_accepted", readAt: null }),
        makeNotification({ notificationId: "notif-2", type: "new_message", conversationId: "conv-1", readAt: null }),
      ],
      1,
      5,
    );

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear all" }));

    await waitFor(() => expect(screen.getByText("No notifications yet.")).toBeInTheDocument());
    expect(screen.getByTestId("probe-count")).toHaveTextContent("0");
    // Messages badge (unread conversations) is untouched by Clear All.
    expect(screen.getByTestId("probe-message-count")).toHaveTextContent("5");
  });

  it("keeps notifications visible and shows an error, without implying success, when Clear All fails", async () => {
    dismissAllNotificationsMock.mockResolvedValue({ ok: false });
    renderListWithProvider([makeNotification({ notificationId: "notif-1", readAt: null })], 1);

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear all" }));

    await waitFor(() => expect(screen.getByText(/unable to clear notifications/i)).toBeInTheDocument());
    expect(screen.getByText("Order accepted")).toBeInTheDocument();
    expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
  });

  it("calls dismiss_all_notifications with no arguments", async () => {
    dismissAllNotificationsMock.mockResolvedValue({ ok: true, dismissedCount: 1 });
    renderList([makeNotification()]);
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(dismissAllNotificationsMock).toHaveBeenCalledWith());
  });
});
