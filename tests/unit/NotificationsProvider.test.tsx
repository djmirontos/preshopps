import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  NotificationsProvider,
  useNotificationsUnreadCount,
  useLatestNotificationEvent,
  useNotificationsMarkRead,
} from "@/components/notifications/NotificationsProvider";

const { channelOnCalls, channelNameCalls, subscribeMock, removeChannelMock } = vi.hoisted(() => ({
  channelOnCalls: [] as Array<{ event: string; config: { event: string; schema: string; table: string; filter: string }; callback: (payload: { new: unknown }) => void }>,
  channelNameCalls: [] as string[],
  subscribeMock: vi.fn(),
  removeChannelMock: vi.fn(),
}));

function makeFakeChannel() {
  const fakeChannel = {
    on: vi.fn((event: string, config: never, callback: (payload: { new: unknown }) => void) => {
      channelOnCalls.push({ event, config: config as unknown as (typeof channelOnCalls)[number]["config"], callback });
      return fakeChannel;
    }),
    subscribe: vi.fn(() => {
      subscribeMock();
      return fakeChannel;
    }),
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

beforeEach(() => {
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  subscribeMock.mockClear();
  removeChannelMock.mockClear();
});

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

function Probe() {
  const unreadCount = useNotificationsUnreadCount();
  const lastEvent = useLatestNotificationEvent();
  const { markOneRead, markAllRead } = useNotificationsMarkRead();

  return (
    <div>
      <p data-testid="unread-count">{unreadCount}</p>
      <p data-testid="last-event-id">{lastEvent?.notificationId ?? "none"}</p>
      <button type="button" onClick={markOneRead}>
        Mark one read
      </button>
      <button type="button" onClick={markAllRead}>
        Mark all read
      </button>
    </div>
  );
}

function sampleRow(overrides: Partial<Parameters<typeof fireIncomingNotification>[0]> = {}) {
  return {
    id: "notif-1",
    recipient_id: "me",
    type: "new_message",
    actor_id: "other-user-1",
    order_id: null,
    conversation_id: "conv-1",
    review_id: null,
    created_at: "2026-02-01T12:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

describe("NotificationsProvider -- subscription lifecycle", () => {
  it("creates no subscription for a guest (isAuthenticated false)", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    expect(channelNameCalls).toHaveLength(0);
  });

  it("creates no subscription when authenticated but userId is somehow null", () => {
    render(
      <NotificationsProvider isAuthenticated={true} userId={null} initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    expect(channelNameCalls).toHaveLength(0);
  });

  it("subscribes to postgres_changes INSERT on notifications, filtered to the caller's own recipient_id, when authenticated", () => {
    render(
      <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );

    expect(channelNameCalls).toContain("notifications:me");
    const registration = channelOnCalls[channelOnCalls.length - 1];
    expect(registration.event).toBe("postgres_changes");
    expect(registration.config).toMatchObject({
      event: "INSERT",
      schema: "public",
      table: "notifications",
      filter: "recipient_id=eq.me",
    });
    expect(subscribeMock).toHaveBeenCalled();
  });

  it("removes the channel on unmount", () => {
    const { unmount } = render(
      <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    unmount();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("removes the old channel and resubscribes when the user logs out (isAuthenticated flips false)", () => {
    const { rerender } = render(
      <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    expect(channelNameCalls).toContain("notifications:me");

    rerender(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationsProvider -- unread count", () => {
  it("is seeded from initialUnreadCount", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadCount={5}>
        <Probe />
      </NotificationsProvider>,
    );
    expect(screen.getByTestId("unread-count")).toHaveTextContent("5");
  });

  it("increments exactly once per new incoming notification", () => {
    render(
      <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );

    fireIncomingNotification(sampleRow({ id: "notif-1" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");

    fireIncomingNotification(sampleRow({ id: "notif-2" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("2");
  });

  it("does not double-increment on a duplicate/replayed event for the same notification id", () => {
    render(
      <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );

    fireIncomingNotification(sampleRow({ id: "notif-1" }));
    fireIncomingNotification(sampleRow({ id: "notif-1" }));
    fireIncomingNotification(sampleRow({ id: "notif-1" }));

    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");
  });

  it("markOneRead decrements by exactly 1, never below 0", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadCount={1}>
        <Probe />
      </NotificationsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark one read" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");

    fireEvent.click(screen.getByRole("button", { name: "Mark one read" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });

  it("markAllRead zeros the count regardless of its current value", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadCount={7}>
        <Probe />
      </NotificationsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });
});

describe("NotificationsProvider -- lastEvent signal", () => {
  it("exposes the incoming notification's id/type/conversationId to consumers", () => {
    render(
      <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadCount={0}>
        <Probe />
      </NotificationsProvider>,
    );

    fireIncomingNotification(sampleRow({ id: "notif-msg", type: "new_message", conversation_id: "conv-42" }));
    expect(screen.getByTestId("last-event-id")).toHaveTextContent("notif-msg");
  });
});

describe("NotificationsProvider -- default context (no Provider ancestor)", () => {
  it("useNotificationsUnreadCount returns 0 and markOneRead/markAllRead are safe no-ops", () => {
    render(<Probe />);
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
    expect(screen.getByTestId("last-event-id")).toHaveTextContent("none");

    fireEvent.click(screen.getByRole("button", { name: "Mark one read" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByTestId("unread-count")).toHaveTextContent("0");
  });
});
