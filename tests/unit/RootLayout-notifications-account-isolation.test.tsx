import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";
import { useUnreadMessageCount, useUnreadNotificationCount } from "@/components/notifications/NotificationsProvider";

/**
 * Exercises the actual production parent boundary in app/layout.tsx --
 * RootLayout() itself, not a test-only copy of its JSX -- so these tests
 * fail if key={userId ?? "guest"} is ever removed from the real
 * <NotificationsProvider> element there. See
 * components/notifications/NotificationsProvider.tsx's own "Account
 * isolation" comment: this key is the ONLY thing that resets
 * NotificationsProvider's counts AND FloatingMessengerProvider's
 * isOpen/selectedConversationId on a sign-out/sign-in, since
 * FloatingMessengerProvider is mounted as NotificationsProvider's own
 * child in app/layout.tsx.
 */

const { getAuthUserMock, getMyUnreadConversationCountServerMock, getMyGeneralNotificationUnreadCountServerMock, rpcMock, getSessionMock } =
  vi.hoisted(() => ({
    getAuthUserMock: vi.fn(),
    getMyUnreadConversationCountServerMock: vi.fn(),
    getMyGeneralNotificationUnreadCountServerMock: vi.fn(),
    rpcMock: vi.fn(),
    getSessionMock: vi.fn(),
  }));

// Browser Supabase client -- feeds NotificationsProvider's own mount-time
// revalidation and Realtime subscription effects. Never resolves the
// channel to a real "SUBSCRIBED" asynchronously-delayed callback beyond
// what's needed; every test here asserts synchronously immediately after
// a rerender, before any of these promises' .then() callbacks can run, so
// a genuine remount's own synchronous re-seed is never confused with a
// later async revalidation converging on the same value.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: (statusCallback?: (status: string) => void) => {
          statusCallback?.("SUBSCRIBED");
          return channel;
        },
      };
      return channel;
    },
    removeChannel: () => {},
  }),
}));

vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "--font-inter" }) }));
vi.mock("@/lib/auth/session", () => ({ getAuthUser: getAuthUserMock }));
vi.mock("@/lib/favorites/get-my-favorite-ids", () => ({ getMyFavoriteListingIds: vi.fn(async () => []) }));
vi.mock("@/lib/cart/get-my-cart", () => ({ getMyCartQuantities: vi.fn(async () => []) }));
vi.mock("@/lib/messaging/get-my-unread-conversation-count-server", () => ({
  getMyUnreadConversationCountServer: getMyUnreadConversationCountServerMock,
}));
vi.mock("@/lib/notifications/get-my-general-notification-unread-count", () => ({
  getMyGeneralNotificationUnreadCount: getMyGeneralNotificationUnreadCountServerMock,
}));
vi.mock("@/lib/seller/get-my-shop", () => ({ getMyShop: vi.fn(async () => null) }));
vi.mock("@/lib/moderation/get-my-active-restrictions", () => ({ getMyActiveRestrictions: vi.fn(async () => ({ restrictions: [] })) }));
// Not under test here -- ConversationThread/ConversationsListClient pull
// in real messaging data-loading modules that have nothing to do with
// this boundary. FloatingMessengerProvider itself (the thing actually
// under test) is untouched.
vi.mock("@/components/messaging/FloatingChatPanel", () => ({ FloatingChatPanel: () => null }));

import RootLayout from "@/app/layout";

function Probe() {
  const { isOpen, selectedConversationId, openConversation } = useFloatingMessenger();
  const unreadMessages = useUnreadMessageCount();
  const unreadNotifications = useUnreadNotificationCount();
  return (
    <div>
      <div data-testid="messenger-open">{String(isOpen)}</div>
      <div data-testid="selected-conversation">{selectedConversationId ?? "none"}</div>
      <div data-testid="unread-messages">{unreadMessages}</div>
      <div data-testid="unread-notifications">{unreadNotifications}</div>
      <button onClick={() => openConversation("conv-a-1")}>Open conversation</button>
    </div>
  );
}

async function renderForUser(userId: string | null, seeds: { messages: number; notifications: number }) {
  getAuthUserMock.mockResolvedValue(userId ? { id: userId, email: `${userId}@example.com` } : null);
  getMyUnreadConversationCountServerMock.mockResolvedValue(seeds.messages);
  getMyGeneralNotificationUnreadCountServerMock.mockResolvedValue(seeds.notifications);
  return render(await RootLayout({ children: <Probe />, params: Promise.resolve({}) }));
}

async function rerenderForUser(
  rerender: ReturnType<typeof render>["rerender"],
  userId: string | null,
  seeds: { messages: number; notifications: number },
) {
  getAuthUserMock.mockResolvedValue(userId ? { id: userId, email: `${userId}@example.com` } : null);
  getMyUnreadConversationCountServerMock.mockResolvedValue(seeds.messages);
  getMyGeneralNotificationUnreadCountServerMock.mockResolvedValue(seeds.notifications);
  const jsx = await RootLayout({ children: <Probe />, params: Promise.resolve({}) });
  rerender(jsx);
}

beforeEach(() => {
  getAuthUserMock.mockReset();
  getMyUnreadConversationCountServerMock.mockReset();
  getMyGeneralNotificationUnreadCountServerMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: 0, error: null });
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
});

describe("RootLayout -- NotificationsProvider's production key={userId ?? \"guest\"} (app/layout.tsx)", () => {
  it("account A -> guest -> account B: each transition resets both counts and FloatingMessengerProvider's open/selected-conversation state to that identity's own values", async () => {
    const { rerender } = await renderForUser("account-a", { messages: 2, notifications: 5 });
    expect(screen.getByTestId("unread-messages")).toHaveTextContent("2");
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("5");

    // A opens the messenger on a specific conversation -- this must never
    // reach a different identity.
    fireEvent.click(screen.getByText("Open conversation"));
    expect(screen.getByTestId("messenger-open")).toHaveTextContent("true");
    expect(screen.getByTestId("selected-conversation")).toHaveTextContent("conv-a-1");

    // A signs out. Asserted synchronously, immediately -- if the
    // production key were ever removed, no remount occurs (React reuses
    // the same NotificationsProvider/FloatingMessengerProvider instances
    // across this prop change), so this would still read A's counts and
    // A's open conversation.
    await rerenderForUser(rerender, null, { messages: 0, notifications: 0 });
    expect(screen.getByTestId("unread-messages")).toHaveTextContent("0");
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("0");
    expect(screen.getByTestId("messenger-open")).toHaveTextContent("false");
    expect(screen.getByTestId("selected-conversation")).toHaveTextContent("none");

    // Account B signs in with its own distinct seed -- again asserted
    // synchronously, immediately.
    await rerenderForUser(rerender, "account-b", { messages: 9, notifications: 20 });
    expect(screen.getByTestId("unread-messages")).toHaveTextContent("9");
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("20");
    expect(screen.getByTestId("messenger-open")).toHaveTextContent("false");
    expect(screen.getByTestId("selected-conversation")).toHaveTextContent("none");
  });

  it("A -> B directly (no interim guest state) resets both counts and FloatingMessengerProvider state to B's own values, never carrying over A's", async () => {
    const { rerender } = await renderForUser("account-a", { messages: 2, notifications: 5 });
    fireEvent.click(screen.getByText("Open conversation"));
    expect(screen.getByTestId("selected-conversation")).toHaveTextContent("conv-a-1");

    await rerenderForUser(rerender, "account-b", { messages: 1, notifications: 99 });
    // If the production key were ever removed, React would reuse the same
    // instances across this prop change: the counts would still read "2"
    // / "5" (A's seed, already committed) rather than B's "1" / "99", and
    // the messenger would still show A's selected conversation.
    expect(screen.getByTestId("unread-messages")).toHaveTextContent("1");
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("99");
    expect(screen.getByTestId("messenger-open")).toHaveTextContent("false");
    expect(screen.getByTestId("selected-conversation")).toHaveTextContent("none");
  });

  it("a late-resolving refresh from the previous account can never overwrite a guest's rendered state after sign-out", async () => {
    // Deliberately A -> guest, not A -> B: switching to a DIFFERENT
    // authenticated account also triggers its own fresh subscribe/refresh
    // (NotificationsProvider's own userId-dependent effect), which would
    // self-correct the Bell/Messages counts given enough time regardless
    // of whether the key did anything. Signing out to a guest triggers no
    // such refresh at all (NotificationsProvider's own subscription
    // effect early-returns for `!isAuthenticated`), so only a genuine
    // remount -- discarding the old instance's state and in-flight
    // requests entirely -- can prevent A's stale response from ever
    // reaching the guest's exposed counts.
    let resolveAccountARequest: ((value: { data: unknown; error: null }) => void) | undefined;
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAccountARequest = resolve;
        }),
    );

    const { rerender } = await renderForUser("account-a", { messages: 0, notifications: 5 });
    // Wait for A's own mount-time revalidation to have actually issued its
    // request (captured resolveAccountARequest) before signing out.
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveAccountARequest).toBeDefined();

    // Sign out before A's own request ever resolves.
    await rerenderForUser(rerender, null, { messages: 0, notifications: 0 });
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("0");

    // NOW let account A's stale, long-pending request finally resolve.
    await act(async () => {
      resolveAccountARequest?.({ data: 999, error: null });
      await Promise.resolve();
    });
    // The guest's badge must remain 0 -- completely unaffected by A's
    // late response, which a removed key would let land here unguarded
    // (the dead instance's own setState would simply be dropped by React
    // instead, since it's no longer mounted).
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("0");
  });

  // Note: unlike the three tests above, this one passes whether or not
  // the production key exists at all, since userId never changes here --
  // React never considers remounting regardless. Kept as complementary
  // required coverage (no over-remount on ordinary same-account
  // navigation), not as a key-removal detector.
  it("re-rendering with the same userId (ordinary navigation while signed in) never remounts -- notification counts and FloatingMessengerProvider's open/selected-conversation state both survive", async () => {
    // Echoes the seed exactly, so NotificationsProvider's own mount-time
    // revalidation (a pre-existing, deliberately-unrelated fix: it
    // refetches shortly after mount to close the "stale SSR seed" gap)
    // reconfirms rather than overwrites these values -- this test is
    // about the key/remount boundary, not that unrelated behavior.
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_my_unread_conversation_count") return Promise.resolve({ data: 2, error: null });
      if (name === "get_my_general_notification_unread_count") return Promise.resolve({ data: 5, error: null });
      return Promise.resolve({ data: 0, error: null });
    });

    const { rerender } = await renderForUser("account-a", { messages: 2, notifications: 5 });
    fireEvent.click(screen.getByText("Open conversation"));
    expect(screen.getByTestId("messenger-open")).toHaveTextContent("true");
    expect(screen.getByTestId("selected-conversation")).toHaveTextContent("conv-a-1");
    // Let the mount-time revalidation settle to the same values before
    // mutating, so the later assertion is unambiguous.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("unread-messages")).toHaveTextContent("2");
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("5");

    // Same userId -- as would happen on an ordinary client-side navigation
    // to a different page while still signed in as the same account, even
    // if the server re-passes a (now-irrelevant) fresh initial* seed.
    await rerenderForUser(rerender, "account-a", { messages: 0, notifications: 0 });

    // Still A's original values -- NOT reset to the new initial* seeds,
    // and the messenger's open conversation survives -- proving no
    // remount happened for a same-account transition.
    expect(screen.getByTestId("unread-messages")).toHaveTextContent("2");
    expect(screen.getByTestId("unread-notifications")).toHaveTextContent("5");
    expect(screen.getByTestId("messenger-open")).toHaveTextContent("true");
    expect(screen.getByTestId("selected-conversation")).toHaveTextContent("conv-a-1");
  });
});
