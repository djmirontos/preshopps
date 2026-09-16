import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import {
  NotificationsProvider,
  useUnreadMessageCount,
  useUnreadNotificationCount,
  useLatestNotificationEvent,
  useNotificationsMarkRead,
  useRefreshUnreadMessageCount,
} from "@/components/notifications/NotificationsProvider";

const { channelOnCalls, channelNameCalls, subscribeMock, removeChannelMock, getSessionMock, rpcMock } = vi.hoisted(() => ({
  channelOnCalls: [] as Array<{ event: string; config: { event: string; schema: string; table: string; filter: string }; callback: (payload: { new: unknown }) => void }>,
  channelNameCalls: [] as string[],
  subscribeMock: vi.fn(),
  removeChannelMock: vi.fn(),
  getSessionMock: vi.fn(),
  rpcMock: vi.fn(),
}));

function makeFakeChannel() {
  const fakeChannel = {
    on: vi.fn((event: string, config: never, callback: (payload: { new: unknown }) => void) => {
      channelOnCalls.push({ event, config: config as unknown as (typeof channelOnCalls)[number]["config"], callback });
      return fakeChannel;
    }),
    subscribe: vi.fn((statusCallback?: (status: string) => void) => {
      subscribeMock();
      statusCallback?.("SUBSCRIBED");
      return fakeChannel;
    }),
  };
  return fakeChannel;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
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
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: 0, error: null });
});

async function latestNotificationsCallback() {
  await waitFor(() => expect(channelOnCalls.length).toBeGreaterThan(0));
  const registration = channelOnCalls[channelOnCalls.length - 1];
  return registration.callback;
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

function Probe() {
  const unreadMessageCount = useUnreadMessageCount();
  const unreadNotificationCount = useUnreadNotificationCount();
  const lastEvent = useLatestNotificationEvent();
  const { markOneRead, markAllRead } = useNotificationsMarkRead();
  const refreshUnreadMessageCount = useRefreshUnreadMessageCount();

  return (
    <div>
      <p data-testid="unread-message-count">{unreadMessageCount}</p>
      <p data-testid="unread-notification-count">{unreadNotificationCount}</p>
      <p data-testid="last-event-id">{lastEvent?.notificationId ?? "none"}</p>
      <button type="button" onClick={markOneRead}>
        Mark one read
      </button>
      <button type="button" onClick={markAllRead}>
        Mark all read
      </button>
      <button type="button" onClick={refreshUnreadMessageCount}>
        Refresh message count
      </button>
    </div>
  );
}

function sampleRow(overrides: Partial<Parameters<typeof fireIncomingNotification>[0]> = {}) {
  return {
    id: "notif-1",
    recipient_id: "me",
    type: "order_accepted",
    actor_id: "other-user-1",
    order_id: "order-1",
    conversation_id: null,
    review_id: null,
    created_at: "2026-02-01T12:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

function renderProvider(overrides: Partial<{ isAuthenticated: boolean; userId: string | null; initialUnreadMessageCount: number; initialUnreadNotificationCount: number }> = {}) {
  const props = {
    isAuthenticated: true,
    userId: "me",
    initialUnreadMessageCount: 0,
    initialUnreadNotificationCount: 0,
    ...overrides,
  };
  return render(
    <NotificationsProvider {...props}>
      <Probe />
    </NotificationsProvider>,
  );
}

describe("NotificationsProvider -- subscription lifecycle", () => {
  it("creates no subscription for a guest (isAuthenticated false)", async () => {
    renderProvider({ isAuthenticated: false, userId: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(channelNameCalls).toHaveLength(0);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("creates no subscription when authenticated but userId is somehow null", async () => {
    renderProvider({ isAuthenticated: true, userId: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(channelNameCalls).toHaveLength(0);
  });

  it("waits for the browser client's session to resolve before subscribing -- this is the actual fix for the original bug", async () => {
    let resolveSession: (value: { data: { session: { access_token: string } }; error: null }) => void = () => {};
    getSessionMock.mockReturnValue(new Promise((resolve) => (resolveSession = resolve)));

    renderProvider();
    // Give any (incorrect) synchronous subscribe a chance to happen.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(channelNameCalls).toHaveLength(0);
    expect(getSessionMock).toHaveBeenCalled();

    resolveSession({ data: { session: { access_token: "token" } }, error: null });
    await waitFor(() => expect(channelNameCalls.length).toBeGreaterThan(0));
  });

  it("subscribes to postgres_changes INSERT on notifications, filtered to the caller's own recipient_id, once the session is ready", async () => {
    renderProvider({ userId: "me" });

    await waitFor(() => expect(channelNameCalls).toContain("notifications:me"));
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

  it("removes the channel on unmount", async () => {
    const { unmount } = renderProvider();
    await waitFor(() => expect(channelNameCalls.length).toBeGreaterThan(0));
    unmount();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("removes the channel when the user logs out (isAuthenticated flips false)", async () => {
    const { rerender } = renderProvider();
    await waitFor(() => expect(channelNameCalls).toContain("notifications:me"));

    rerender(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
        <Probe />
      </NotificationsProvider>,
    );
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationsProvider -- split unread counts", () => {
  it("is seeded from initialUnreadMessageCount and initialUnreadNotificationCount independently", () => {
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 3, initialUnreadNotificationCount: 5 });
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3");
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("5");
  });

  it("a new_message notification schedules a debounced authoritative refresh of unreadMessageCount, never unreadNotificationCount", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider();
    // Let this Provider's own mount-time revalidation (P1-2 fix) settle
    // and clear its call history first, so the assertion below is about
    // the notification event specifically, not the unrelated mount call.
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-msg", type: "new_message" }));

    // Not incremented synchronously/blindly -- only after the debounced
    // authoritative RPC refresh resolves.
    expect(rpcMock).not.toHaveBeenCalled();

    // Wait for the debounce timer's own RPC call specifically (not just
    // the resulting text, which the mount-time revalidation above already
    // set to this same "1" -- waiting on text alone would pass trivially
    // without the debounce timer having actually fired yet).
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("1");
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0");
  });

  it("a non-message notification increments unreadNotificationCount only, never unreadMessageCount", async () => {
    renderProvider();
    await fireIncomingNotification(sampleRow({ id: "notif-order", type: "order_accepted" }));

    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("1");
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0");
  });

  it("mixed events route independently -- each type only ever affects its own counter", async () => {
    // The RPC reports the authoritative number of unread CONVERSATIONS
    // (2 here), not the number of new_message events that were received
    // (also 2 in this test, coincidentally) -- the badge must reflect
    // server truth, never an event tally.
    rpcMock.mockResolvedValue({ data: 2, error: null });
    renderProvider();
    // Settle and clear the mount-time revalidation call (P1-2 fix) first
    // so the count below is about THESE events' own refresh, not that
    // unrelated baseline one.
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-msg-1", type: "new_message" }));
    await fireIncomingNotification(sampleRow({ id: "notif-order-1", type: "order_accepted" }));
    await fireIncomingNotification(sampleRow({ id: "notif-msg-2", type: "new_message" }));

    // order_accepted is not debounced -- reflected immediately.
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("1");

    // Wait for the debounce timer's own call, not just the resulting text
    // (which the mount-time revalidation already set to this same "2").
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    // Two new_message events coalesce into exactly one authoritative refresh.
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("2");
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("1");
  });

  it("does not cause count drift on a duplicate/replayed event for the same notification id -- only the first schedules a refresh", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-1", type: "new_message" }));
    await fireIncomingNotification(sampleRow({ id: "notif-1", type: "new_message" }));
    await fireIncomingNotification(sampleRow({ id: "notif-1", type: "new_message" }));

    // Wait for the debounce timer's own call, not just the resulting text
    // (which the mount-time revalidation already set to this same "1").
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    // Duplicates are deduped by id before ever reaching the debounce
    // scheduling code, so only one authoritative refresh is ever fired.
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("1");
  });

  it("markOneRead decrements unreadNotificationCount only, by exactly 1, never below 0", () => {
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 2, initialUnreadNotificationCount: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Mark one read" }));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0");
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Mark one read" }));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0");
  });

  it("markAllRead zeros unreadNotificationCount only, leaving unreadMessageCount untouched", () => {
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 4, initialUnreadNotificationCount: 7 });

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0");
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("4");
  });

  it("refreshUnreadMessageCount recalculates unreadMessageCount from the server, authoritatively", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 99 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3"));
    expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count");
  });

  it("refreshUnreadMessageCount never touches unreadNotificationCount", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadNotificationCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("5");
  });
});

/**
 * P1 fix: refreshUnreadMessageCount must never overwrite the last-known
 * Messages badge with a fabricated 0 when the underlying RPC fails --
 * only a genuine ok=true result (itself possibly count: 0) is ever
 * applied. See getMyUnreadConversationCount.test.ts for the helper-level
 * half of this fix.
 */
describe("NotificationsProvider -- refreshUnreadMessageCount preserves the badge on a failed refresh", () => {
  it("5. existing badge=3 + failed refresh (RPC error) stays 3, not 0", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3");
  });

  it("5b. existing badge=3 + failed refresh (thrown/network error) stays 3, not 0", async () => {
    rpcMock.mockRejectedValue(new Error("network error"));
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3");
  });

  it("6. existing badge=3 + successful refresh reporting a genuine 0 becomes 0", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0"));
  });

  it("7. existing badge=3 + successful refresh reporting 1 becomes 1", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("1"));
  });

  it("8. existing badge=0 + failed refresh remains 0", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0");
  });

  it("9. a failed message-count refresh never touches unreadNotificationCount (Bell stays independent)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 3, initialUnreadNotificationCount: 5 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3");
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("5");
  });

  it("10. the debounced Realtime-triggered refresh (a new_message event) preserves the badge on failure the exact same way as the manual refresh button", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderProvider({ initialUnreadMessageCount: 3 });

    await fireIncomingNotification(sampleRow({ id: "notif-msg-fail", type: "new_message" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3");
  });

  it("11. no raw backend error text ever reaches the rendered badge", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });
    renderProvider({ isAuthenticated: false, userId: null, initialUnreadMessageCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3");
    expect(document.body.textContent).not.toMatch(/raw backend detail/);
  });
});

/**
 * P1-2 fix: the initial unreadMessageCount is only ever an SSR-rendered
 * seed (get-my-unread-conversation-count-server.ts, which can fall back
 * to a bare 0 on its own transient RPC/network failure -- an acceptable
 * SSR render value, since a server render cannot preserve any previous
 * browser value). Without an authoritative client-side revalidation, a
 * user who really has unread conversations could start (and stay) wrong
 * at badge 0 for their entire session. This Provider now performs one
 * authoritative refreshUnreadMessageCount() call right after mount,
 * reusing the exact same already-fixed helper (preserves the seed on
 * failure; a genuine server-confirmed 0 still clears it).
 */
describe("NotificationsProvider -- mount-time authoritative revalidation (P1-2 fix)", () => {
  it("1/2/3. SSR seed 0 + successful mount revalidation reporting 3 -> badge becomes 3", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    renderProvider({ initialUnreadMessageCount: 0 });

    expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count");
    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3"));
  });

  it("4/5/6. SSR seed 4 + successful mount revalidation reporting a genuine 0 -> badge becomes 0", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    renderProvider({ initialUnreadMessageCount: 4 });

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0"));
  });

  it("7/8/9. SSR seed 4 + failed mount revalidation -> badge remains 4, no raw backend error reaches the UI", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });
    renderProvider({ initialUnreadMessageCount: 4 });

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("4");
    expect(document.body.textContent).not.toMatch(/raw backend detail/);
  });

  it("10/11/12. SSR seed 0 + failed mount revalidation -> badge remains 0", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderProvider({ initialUnreadMessageCount: 0 });

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0");
  });

  it("13. React Strict Mode's dev-only double-invoke does not cause a second mount-time revalidation fetch", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    render(
      <StrictMode>
        <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
          <Probe />
        </NotificationsProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3"));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("14. a new_message Realtime-triggered refresh still fires correctly after the mount-time revalidation has already settled", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider({ initialUnreadMessageCount: 0 });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    rpcMock.mockClear();

    rpcMock.mockResolvedValue({ data: 2, error: null });
    await fireIncomingNotification(sampleRow({ id: "notif-after-mount", type: "new_message" }));

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("2"));
  });

  it("15. an external mark-read-triggered refreshUnreadMessageCount() call still works correctly after the mount-time revalidation has already settled", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider({ initialUnreadMessageCount: 0 });
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    rpcMock.mockClear();

    rpcMock.mockResolvedValue({ data: 5, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("5"));
  });

  it("16. an earlier-started but later-resolving refresh cannot overwrite a more recent authoritative result (latest-wins guard)", async () => {
    let resolveMountRequest: (value: { data: number; error: null }) => void = () => {};
    rpcMock.mockImplementation(() => new Promise((resolve) => (resolveMountRequest = resolve)));
    renderProvider({ initialUnreadMessageCount: 0 });
    // The mount-time revalidation (request #1) is now pending, unresolved.

    // A second, later-issued refresh (e.g. a manual button click standing
    // in for any other refreshUnreadMessageCount() caller) resolves
    // FIRST, with the fresher/authoritative value.
    rpcMock.mockResolvedValueOnce({ data: 7, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));
    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("7"));

    // The stale mount-time request (#1) now finally resolves, with an
    // OLDER value -- it must not clobber the fresher "7" that already won.
    resolveMountRequest({ data: 1, error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("7");
  });

  it("17. mount-time revalidation never touches unreadNotificationCount -- the Bell stays fully independent", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    renderProvider({ initialUnreadMessageCount: 0, initialUnreadNotificationCount: 9 });

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3"));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("9");
  });
});

describe("NotificationsProvider -- Messages badge semantics (unread CONVERSATIONS, not messages)", () => {
  it("3 new messages in the same still-unread conversation => badge remains 1 after the authoritative refresh, never 3", async () => {
    // Regardless of how many new_message rows arrive, the RPC reports the
    // number of unread CONVERSATIONS -- one conversation receiving 3
    // messages is still exactly 1 unread conversation.
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider();
    // Settle and clear the mount-time revalidation call (P1-2 fix) first.
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-a", type: "new_message", conversation_id: "conv-1" }));
    await fireIncomingNotification(sampleRow({ id: "notif-b", type: "new_message", conversation_id: "conv-1" }));
    await fireIncomingNotification(sampleRow({ id: "notif-c", type: "new_message", conversation_id: "conv-1" }));

    // Wait for the debounce timer's own call, not just the resulting text
    // (which the mount-time revalidation already set to this same "1").
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("1");
  });

  it("messages arriving across 2 unread conversations => badge 2", async () => {
    rpcMock.mockResolvedValue({ data: 2, error: null });
    renderProvider();

    await fireIncomingNotification(sampleRow({ id: "notif-a", type: "new_message", conversation_id: "conv-1" }));
    await fireIncomingNotification(sampleRow({ id: "notif-b", type: "new_message", conversation_id: "conv-2" }));

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("2"));
  });

  it("a refresh that reconfirms the same count does not change the badge's meaning -- still a conversation count, not a message count", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    renderProvider({ initialUnreadMessageCount: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("1");
  });
});

describe("NotificationsProvider -- lastEvent signal", () => {
  it("exposes the incoming notification's id/type/conversationId to consumers, for every type", async () => {
    renderProvider();
    await fireIncomingNotification(sampleRow({ id: "notif-msg", type: "new_message", conversation_id: "conv-42" }));
    expect(screen.getByTestId("last-event-id")).toHaveTextContent("notif-msg");
  });
});

describe("NotificationsProvider -- default context (no Provider ancestor)", () => {
  it("both counts default to 0 and every action is a safe no-op", () => {
    render(<Probe />);
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0");
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0");
    expect(screen.getByTestId("last-event-id")).toHaveTextContent("none");

    fireEvent.click(screen.getByRole("button", { name: "Mark one read" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh message count" }));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0");
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0");
  });
});
