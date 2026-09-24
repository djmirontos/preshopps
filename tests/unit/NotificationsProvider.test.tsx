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

// Captures the most recently registered .subscribe() status callback so a
// test can manually re-invoke it (e.g. CHANNEL_ERROR then SUBSCRIBED
// again) to simulate a genuine Realtime reconnect -- realtime-js reuses
// the same channel/joinPush and re-invokes this same callback on its own
// rejoin, so driving it directly here is a faithful simulation, not a
// synthetic shortcut. Plain module-level `let`, not part of vi.hoisted --
// only read/written after full module init (inside makeFakeChannel, called
// lazily when the component actually subscribes), so no TDZ concern.
let lastSubscribeStatusCallback: ((status: string, err?: { message: string }) => void) | undefined;

function makeFakeChannel() {
  const fakeChannel = {
    on: vi.fn((event: string, config: never, callback: (payload: { new: unknown }) => void) => {
      channelOnCalls.push({ event, config: config as unknown as (typeof channelOnCalls)[number]["config"], callback });
      return fakeChannel;
    }),
    subscribe: vi.fn((statusCallback?: (status: string, err?: { message: string }) => void) => {
      subscribeMock();
      lastSubscribeStatusCallback = statusCallback;
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

/**
 * Both refreshUnreadMessageCount and refreshUnreadNotificationCount now
 * call the exact same mocked `rpc()` method (matching the real
 * implementation), distinguished only by the RPC name passed as the first
 * argument -- so a blanket `rpcMock.mockResolvedValue(...)` from before
 * the Bell also got an authoritative refresh (mount/focus/reconnect) would
 * apply to BOTH counts identically, not just whichever one a given test
 * cares about. This keys the response by name instead, defaulting each to
 * a plain { data: 0, error: null } (matching renderProvider's own default
 * 0 seeds) so a test that only overrides one name never has to think about
 * the other.
 */
function configureRpc(overrides: Partial<Record<string, { data: unknown; error: { message: string } | null }>> = {}) {
  const responses: Record<string, { data: unknown; error: { message: string } | null }> = {
    get_my_unread_conversation_count: { data: 0, error: null },
    get_my_general_notification_unread_count: { data: 0, error: null },
    ...overrides,
  };
  rpcMock.mockImplementation((name: string) => Promise.resolve(responses[name] ?? { data: 0, error: null }));
}

beforeEach(() => {
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  subscribeMock.mockClear();
  removeChannelMock.mockClear();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  rpcMock.mockReset();
  configureRpc();
  lastSubscribeStatusCallback = undefined;
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
    configureRpc({ get_my_unread_conversation_count: { data: 1, error: null } });
    renderProvider();
    // Let this Provider's own mount-time revalidation (P1-2 fix) settle
    // and clear its call history first, so the assertion below is about
    // the notification event specifically, not the unrelated mount call.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-msg", type: "new_message" }));

    // Not incremented synchronously/blindly -- only after the debounced
    // authoritative RPC refresh resolves.
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_unread_conversation_count");

    // Wait for the debounce timer's own RPC call specifically (not just
    // the resulting text, which the mount-time revalidation above already
    // set to this same "1" -- waiting on text alone would pass trivially
    // without the debounce timer having actually fired yet).
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("1");
    // Bell RPC is configured at its own default (0), matching the seed --
    // never touched by a new_message event.
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0");
  });

  it("a non-message notification schedules a debounced authoritative refresh of unreadNotificationCount, never unreadMessageCount, and never a raw increment", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: 1, error: null } });
    renderProvider();
    // Settle and clear the mount-time/first-SUBSCRIBED Bell revalidation
    // calls (the missed-event-recovery fix) first, so the assertion below
    // is about this event's own refresh, not those unrelated ones.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-order", type: "order_accepted" }));

    // Not incremented synchronously/blindly -- only after the debounced
    // authoritative RPC refresh resolves (the double-count fix: see
    // NotificationsProvider's own header comment).
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_general_notification_unread_count");

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("1");
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("0");
  });

  it("mixed events route independently -- each type only ever affects its own counter, via its own separately-debounced refresh", async () => {
    // The RPCs report the authoritative counts (2 unread conversations, 1
    // unread non-message notification) -- not an event tally, and not the
    // number of events received (also 2 new_message events here,
    // coincidentally) -- the badge must reflect server truth.
    configureRpc({
      get_my_unread_conversation_count: { data: 2, error: null },
      get_my_general_notification_unread_count: { data: 1, error: null },
    });
    renderProvider();
    // Settle and clear the mount-time/first-SUBSCRIBED revalidation calls
    // for BOTH badges first, so the counts below are about these events'
    // own refreshes, not those unrelated baseline ones.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-msg-1", type: "new_message" }));
    await fireIncomingNotification(sampleRow({ id: "notif-order-1", type: "order_accepted" }));
    await fireIncomingNotification(sampleRow({ id: "notif-msg-2", type: "new_message" }));

    // Both counters are debounced now -- neither reflects the event
    // immediately, only once each one's own timer fires.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    // Two new_message events coalesce into exactly one authoritative
    // refresh; the one order_accepted event schedules its own, separate
    // one -- three deduped events, two total refresh calls (one per
    // counter), never three.
    expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_unread_conversation_count")).toHaveLength(1);
    expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_general_notification_unread_count")).toHaveLength(1);
    expect(screen.getByTestId("unread-message-count")).toHaveTextContent("2");
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("1");
  });

  it("does not cause count drift on a duplicate/replayed event for the same notification id -- only the first schedules a refresh", async () => {
    configureRpc({ get_my_unread_conversation_count: { data: 1, error: null } });
    renderProvider();
    // Settle both badges' own baseline (mount/first-SUBSCRIBED) calls
    // before clearing, so neither can sneak in after the clear below and
    // pollute the "exactly 1 call" assertion.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    rpcMock.mockClear();

    await fireIncomingNotification(sampleRow({ id: "notif-1", type: "new_message" }));
    await fireIncomingNotification(sampleRow({ id: "notif-1", type: "new_message" }));
    await fireIncomingNotification(sampleRow({ id: "notif-1", type: "new_message" }));

    // Wait for the debounce timer's own call, not just the resulting text
    // (which the mount-time revalidation already set to this same "1").
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    // Duplicates are deduped by id before ever reaching the debounce
    // scheduling code, so only one authoritative refresh is ever fired --
    // and only the message RPC, since these are all new_message events.
    expect(rpcMock).toHaveBeenCalledWith("get_my_unread_conversation_count");
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
    configureRpc({ get_my_unread_conversation_count: { data: 3, error: null } });
    render(
      <StrictMode>
        <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
          <Probe />
        </NotificationsProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3"));
    // Scoped to the message RPC specifically -- the Bell's own mount-time
    // revalidation (a separate, real, intentional call) also fires exactly
    // once and is covered by its own dedicated Strict Mode test below, not
    // this one.
    expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_unread_conversation_count")).toHaveLength(1);
  });

  it("13b. React Strict Mode's dev-only double-invoke does not cause a second Bell mount-time revalidation fetch either", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: 3, error: null } });
    render(
      <StrictMode>
        <NotificationsProvider isAuthenticated={true} userId="me" initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
          <Probe />
        </NotificationsProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("3"));
    // Exactly one mount-time call, plus exactly one first-SUBSCRIBED call
    // (the missed-event-recovery fix) -- Strict Mode's double-invoke of
    // the subscription effect must not turn that into two of either.
    expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_general_notification_unread_count")).toHaveLength(2);
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

  it("17. mount-time revalidation refreshes unreadMessageCount and unreadNotificationCount independently, via their own separate RPCs -- neither ever borrows the other's value", async () => {
    // Deliberately different values for the two RPCs -- if either badge
    // ever ended up reflecting the other's mocked response, this would
    // fail immediately instead of coincidentally passing.
    configureRpc({
      get_my_unread_conversation_count: { data: 3, error: null },
      get_my_general_notification_unread_count: { data: 6, error: null },
    });
    renderProvider({ initialUnreadMessageCount: 0, initialUnreadNotificationCount: 9 });

    await waitFor(() => expect(screen.getByTestId("unread-message-count")).toHaveTextContent("3"));
    await waitFor(() => expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("6"));
  });

  it("18. the Bell (unreadNotificationCount) also gets its own mount-time authoritative revalidation -- SSR seed 9 corrected to a genuine server-confirmed 0", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: 0, error: null } });
    renderProvider({ initialUnreadNotificationCount: 9 });

    await waitFor(() => expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("0"));
  });

  it("19. a failed Bell mount-time revalidation preserves the SSR seed instead of clobbering it with a fabricated 0", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: null, error: { message: "boom" } } });
    renderProvider({ initialUnreadNotificationCount: 4 });

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("4");
  });

  it("20. the Bell is refreshed again when the window regains focus", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: 2, error: null } });
    renderProvider({ initialUnreadNotificationCount: 2 });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    rpcMock.mockClear();

    configureRpc({ get_my_general_notification_unread_count: { data: 5, error: null } });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("5"));
    // The Messages badge keeps its own existing triggers unchanged -- focus
    // is never one of them.
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_unread_conversation_count");
  });

  it("21. a failed focus-triggered Bell refresh preserves the last-known count instead of a fabricated 0", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: 2, error: null } });
    renderProvider({ initialUnreadNotificationCount: 2 });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    rpcMock.mockClear();

    configureRpc({ get_my_general_notification_unread_count: { data: null, error: { message: "boom" } } });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("2");
  });

  it("22. the Bell is refreshed again on a genuine Realtime reconnect (SUBSCRIBED following a CHANNEL_ERROR), never on a plain first SUBSCRIBED without a prior interruption double-firing", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: 1, error: null } });
    renderProvider();
    await waitFor(() => expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_general_notification_unread_count")).toHaveLength(2));
    rpcMock.mockClear();

    configureRpc({ get_my_general_notification_unread_count: { data: 8, error: null } });
    act(() => {
      lastSubscribeStatusCallback?.("CHANNEL_ERROR", new Error("connection dropped"));
    });
    // A disconnect alone never refreshes -- only the SUBSCRIBED that
    // follows it does.
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_general_notification_unread_count");

    act(() => {
      lastSubscribeStatusCallback?.("SUBSCRIBED");
    });

    await waitFor(() => expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("8"));
    expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_general_notification_unread_count")).toHaveLength(1);
  });

  it("23. avoids double-counting when a realtime event's debounced refresh and an overlapping later-issued refresh (e.g. a focus refresh) both resolve -- the later-issued one always wins, never adds on top", async () => {
    let resolveEventRefresh: (value: { data: number; error: null }) => void = () => {};
    configureRpc({ get_my_general_notification_unread_count: { data: 3, error: null } });
    renderProvider({ initialUnreadNotificationCount: 3 });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    rpcMock.mockClear();

    // A Bell-affecting event arrives and schedules its own debounced
    // refresh -- but its RPC call is left pending (simulating a slow round
    // trip), and it will resolve with a STALE count (3, captured before a
    // second, freshly-committed row existed).
    rpcMock.mockImplementation((name: string) =>
      name === "get_my_general_notification_unread_count"
        ? new Promise((resolve) => (resolveEventRefresh = resolve))
        : Promise.resolve({ data: 0, error: null }),
    );
    await fireIncomingNotification(sampleRow({ id: "notif-order-overlap", type: "order_accepted" }));
    // Waits past the real debounce timer -- once the RPC has actually been
    // called (even though its returned promise is still pending), the
    // debounced refresh has genuinely fired.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));

    // While that debounced refresh is still pending, a focus refresh (a
    // later-ISSUED call) resolves FIRST with the true, fresher count (4 --
    // already includes the new row).
    rpcMock.mockImplementation((name: string) =>
      name === "get_my_general_notification_unread_count" ? Promise.resolve({ data: 4, error: null }) : Promise.resolve({ data: 0, error: null }),
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("4"));

    // The stale, earlier-issued event refresh now finally resolves with
    // its outdated snapshot (3) -- it must never overwrite the fresher "4"
    // that already won (would otherwise silently regress the Bell
    // backwards, the mirror image of double-counting).
    resolveEventRefresh({ data: 3, error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("4");
  });

  it("24. review fix: a plain CLOSED->SUBSCRIBED cycle (the actual laptop-sleep/Wi-Fi-handoff shape, not CHANNEL_ERROR/TIMED_OUT) still triggers the missed-event-recovery refresh", async () => {
    configureRpc({ get_my_general_notification_unread_count: { data: 1, error: null } });
    renderProvider();
    await waitFor(() => expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_general_notification_unread_count")).toHaveLength(2));
    rpcMock.mockClear();

    configureRpc({ get_my_general_notification_unread_count: { data: 9, error: null } });
    act(() => {
      lastSubscribeStatusCallback?.("CLOSED");
    });
    // A bare CLOSED alone never refreshes -- only the SUBSCRIBED that
    // follows it does (mirrors the CHANNEL_ERROR case).
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_general_notification_unread_count");

    act(() => {
      lastSubscribeStatusCallback?.("SUBSCRIBED");
    });

    await waitFor(() => expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("9"));
    expect(rpcMock.mock.calls.filter(([name]) => name === "get_my_general_notification_unread_count")).toHaveLength(1);
  });

  it("25. review fix: a fresher optimistic mark-read/dismiss/clear-all mutation can never be clobbered by a slower, already-in-flight authoritative refresh resolving afterward", async () => {
    let resolveFocusRefresh: (value: { data: number; error: null }) => void = () => {};
    configureRpc({ get_my_general_notification_unread_count: { data: 3, error: null } });
    renderProvider({ initialUnreadNotificationCount: 3 });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));
    rpcMock.mockClear();

    // A focus refresh starts (simulating one reading the server's count as
    // 3, before the dismissal below has committed) and is left pending.
    rpcMock.mockImplementation((name: string) =>
      name === "get_my_general_notification_unread_count" ? new Promise((resolve) => (resolveFocusRefresh = resolve)) : Promise.resolve({ data: 0, error: null }),
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_general_notification_unread_count"));

    // While that refresh is still in flight, the person dismisses one item
    // -- a local, already-known-correct decrement to 2, with no RPC round
    // trip of its own to race against the pending refresh.
    fireEvent.click(screen.getByRole("button", { name: "Mark one read" }));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("2");

    // The stale focus refresh now finally resolves with its outdated
    // snapshot (3, read before the dismissal) -- it must never clobber the
    // fresher, locally-known "2" back upward.
    resolveFocusRefresh({ data: 3, error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("unread-notification-count")).toHaveTextContent("2");
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
