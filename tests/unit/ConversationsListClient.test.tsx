import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ConversationSummary } from "@/lib/messaging/get-my-conversations";

const { channelOnCalls, channelNameCalls, removeChannelMock, getSessionMock } = vi.hoisted(() => ({
  channelOnCalls: [] as Array<{ event: string; config: unknown; callback: (payload: { new: unknown }) => void }>,
  channelNameCalls: [] as string[],
  removeChannelMock: vi.fn(),
  getSessionMock: vi.fn(),
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

import { ConversationsListClient } from "@/components/messaging/ConversationsListClient";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { FloatingMessengerProvider, useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

function sampleConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversationId: "conv-1",
    conversationType: "listing_inquiry",
    viewerRole: "initiator",
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    shopLogoUrl: undefined,
    listingId: null,
    listingPublicCode: null,
    listingTitle: null,
    listingImageUrl: undefined,
    otherPartyDisplayName: null,
    otherPartyAvatarUrl: undefined,
    lastMessageAt: "2026-02-01T10:00:00.000Z",
    lastMessagePreview: "Hello",
    lastMessageIsMine: false,
    isUnread: false,
    isArchived: false,
    isMuted: false,
    ...overrides,
  };
}

const loadMoreMock = vi.fn();
const refreshFirstPageMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  loadMoreMock.mockReset();
  refreshFirstPageMock.mockReset();
  channelOnCalls.length = 0;
  channelNameCalls.length = 0;
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
});

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

function newMessageNotification(overrides: Partial<Parameters<typeof fireIncomingNotification>[0]> = {}) {
  return {
    id: "notif-1",
    recipient_id: "me",
    type: "new_message",
    actor_id: "other-user-1",
    order_id: null,
    conversation_id: "conv-1",
    review_id: null,
    created_at: "2026-02-02T09:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

function renderList(conversations: ConversationSummary[]) {
  return render(
    <NotificationsProvider isAuthenticated userId="me" initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
      <ConversationsListClient
        initialConversations={conversations}
        initialHadError={false}
        initialCursor={null}
        loadMore={loadMoreMock}
        refreshFirstPage={refreshFirstPageMock}
        showingArchived={false}
      />
    </NotificationsProvider>,
  );
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

function OpenIdProbe() {
  const { selectedConversationId } = useFloatingMessenger();
  return <p data-testid="floating-open-id">{selectedConversationId ?? "none"}</p>;
}

function renderListWithFloatingMessenger(conversations: ConversationSummary[]) {
  return render(
    <NotificationsProvider isAuthenticated userId="me" initialUnreadMessageCount={0} initialUnreadNotificationCount={0}>
      <FloatingMessengerProvider>
        <OpenIdProbe />
        <ConversationsListClient
          initialConversations={conversations}
          initialHadError={false}
          initialCursor={null}
          loadMore={loadMoreMock}
          refreshFirstPage={refreshFirstPageMock}
          showingArchived={false}
        />
      </FloatingMessengerProvider>
    </NotificationsProvider>,
  );
}

describe("ConversationsListClient -- baseline rendering (unaffected by the new refresh signal)", () => {
  it("renders each conversation's shop name and last-message preview", () => {
    renderList([sampleConversation({ shopName: "Anne's Closet", lastMessagePreview: "Is this still available?" })]);
    expect(screen.getByText("Anne's Closet")).toBeInTheDocument();
    expect(screen.getByText("Is this still available?")).toBeInTheDocument();
  });

  it("shows the empty state when there are no conversations", () => {
    renderList([]);
    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
  });
});

describe("ConversationsListClient -- live refresh on new_message notifications", () => {
  it("a new_message notification triggers a targeted refetch of the first page, replacing the list with authoritative server data", async () => {
    refreshFirstPageMock.mockResolvedValue({
      conversations: [sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet", lastMessagePreview: "New reply just in", isUnread: true })],
      hadError: false,
      nextCursor: null,
    });
    renderList([sampleConversation({ conversationId: "conv-1", shopName: "Anne's Closet", lastMessagePreview: "Old preview" })]);

    await fireIncomingNotification(newMessageNotification());
    expect(refreshFirstPageMock).not.toHaveBeenCalled();

    await waitFor(() => expect(refreshFirstPageMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("New reply just in")).toBeInTheDocument();
  });

  it("coalesces a rapid burst of new_message events into exactly one refetch", async () => {
    refreshFirstPageMock.mockResolvedValue({ conversations: [sampleConversation()], hadError: false, nextCursor: null });
    renderList([sampleConversation()]);

    // All three arrive well within the debounce window -- only the last
    // one's timer should ever actually fire.
    await fireIncomingNotification(newMessageNotification({ id: "notif-1" }));
    await fireIncomingNotification(newMessageNotification({ id: "notif-2" }));
    await fireIncomingNotification(newMessageNotification({ id: "notif-3" }));

    await waitFor(() => expect(refreshFirstPageMock).toHaveBeenCalled());
    // Give any (incorrect) second debounced call a chance to also fire
    // before asserting the final count.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(refreshFirstPageMock).toHaveBeenCalledTimes(1);
  });

  it("an unrelated notification type does not trigger a conversation-list refetch", async () => {
    renderList([sampleConversation()]);

    await fireIncomingNotification(newMessageNotification({ id: "notif-order", type: "order_accepted" }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(refreshFirstPageMock).not.toHaveBeenCalled();
  });

  it("never issues a full-page reload -- the refresh happens via a targeted refetch, not a navigation", async () => {
    refreshFirstPageMock.mockResolvedValue({ conversations: [sampleConversation()], hadError: false, nextCursor: null });
    renderList([sampleConversation()]);

    await fireIncomingNotification(newMessageNotification());

    await waitFor(() => expect(refreshFirstPageMock).toHaveBeenCalled());
    // Still the same jsdom document -- a real navigation would have torn
    // this down and thrown "Not implemented: navigation" from jsdom.
    expect(screen.queryByText("No messages yet.")).not.toBeInTheDocument();
  });

  it("does not clear the existing list when the targeted refetch itself fails", async () => {
    refreshFirstPageMock.mockResolvedValue({ conversations: [], hadError: true, nextCursor: null });
    renderList([sampleConversation({ shopName: "Anne's Closet" })]);

    await fireIncomingNotification(newMessageNotification());

    await waitFor(() => expect(refreshFirstPageMock).toHaveBeenCalled());
    expect(screen.getByText("Anne's Closet")).toBeInTheDocument();
  });
});

describe("ConversationsListClient -- no direct Realtime subscription of its own", () => {
  it("never opens a Realtime channel itself -- it only reacts to the shared NotificationsProvider signal", async () => {
    renderList([sampleConversation()]);
    await waitFor(() => expect(channelNameCalls.length).toBeGreaterThan(0));
    expect(channelNameCalls).toHaveLength(1); // exactly the Provider's own notifications channel
    expect(channelNameCalls[0]).toBe("notifications:me");
  });

  it("source never subscribes to public.conversations", () => {
    const source = readFile("components/messaging/ConversationsListClient.tsx");
    expect(source).not.toMatch(/\.channel\(/);
    expect(source).not.toMatch(/table:\s*["']conversations["']/);
  });
});

describe("ConversationsListClient -- desktop floating panel vs mobile full-page navigation", () => {
  const DESKTOP_WIDTH = 1280;
  const MOBILE_WIDTH = 375;

  it("desktop (>= lg): clicking a conversation opens the floating panel instead of navigating", () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderListWithFloatingMessenger([sampleConversation({ conversationId: "conv-42" })]);

    const link = screen.getByRole("link", { name: /Anne's Closet/ });
    fireEvent.click(link, { button: 0 });

    expect(screen.getByTestId("floating-open-id")).toHaveTextContent("conv-42");
  });

  it("mobile (< lg): clicking a conversation does not open the floating panel -- normal <Link> navigation proceeds", () => {
    setViewportWidth(MOBILE_WIDTH);
    renderListWithFloatingMessenger([sampleConversation({ conversationId: "conv-42" })]);

    const link = screen.getByRole("link", { name: /Anne's Closet/ });
    fireEvent.click(link, { button: 0 });

    expect(screen.getByTestId("floating-open-id")).toHaveTextContent("none");
  });

  it("a modified click (e.g. ctrl/cmd-click for a new tab) is never intercepted, even on desktop", () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderListWithFloatingMessenger([sampleConversation({ conversationId: "conv-42" })]);

    const link = screen.getByRole("link", { name: /Anne's Closet/ });
    fireEvent.click(link, { button: 0, ctrlKey: true });

    expect(screen.getByTestId("floating-open-id")).toHaveTextContent("none");
  });

  it("still renders a real href to the full-page route regardless of viewport -- interception is click-time only, never removes the link's own destination", () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderListWithFloatingMessenger([sampleConversation({ conversationId: "conv-42" })]);
    const link = screen.getByRole("link", { name: /Anne's Closet/ });
    expect(link).toHaveAttribute("href", "/messages/conv-42");
  });
});
