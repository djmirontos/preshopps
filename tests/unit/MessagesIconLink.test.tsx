import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { openMessengerMock, getSessionMock } = vi.hoisted(() => ({
  openMessengerMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/components/messaging/FloatingMessengerProvider", () => ({
  useFloatingMessenger: () => ({
    isOpen: false,
    selectedConversationId: null,
    openMessenger: openMessengerMock,
    openConversation: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
  }),
}));

// NotificationsProvider (the real one, wrapping the link below to
// exercise useUnreadMessageCount) opens its own Realtime channel on
// mount, which needs the browser Supabase client -- same mock shape used
// throughout the messaging test suite.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    channel: () => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
    removeChannel: vi.fn(),
  }),
}));

import { MessagesIconLink } from "@/components/messaging/MessagesIconLink";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

function renderLink(initialUnreadMessageCount = 0) {
  return render(
    <NotificationsProvider isAuthenticated userId="me" initialUnreadMessageCount={initialUnreadMessageCount} initialUnreadNotificationCount={0}>
      <MessagesIconLink />
    </NotificationsProvider>,
  );
}

beforeEach(() => {
  openMessengerMock.mockReset();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  setViewportWidth(DESKTOP_WIDTH);
});

describe("MessagesIconLink -- desktop opens the persistent messaging center", () => {
  it("desktop (>= lg): clicking opens the messaging center instead of navigating", () => {
    renderLink();
    fireEvent.click(screen.getByRole("link", { name: "Messages" }), { button: 0 });
    expect(openMessengerMock).toHaveBeenCalledTimes(1);
  });

  it("mobile (< lg): clicking does not open the messaging center -- normal <Link> navigation proceeds", () => {
    setViewportWidth(MOBILE_WIDTH);
    renderLink();
    fireEvent.click(screen.getByRole("link", { name: "Messages" }), { button: 0 });
    expect(openMessengerMock).not.toHaveBeenCalled();
  });

  it("a modified click (e.g. ctrl/cmd-click for a new tab) is never intercepted, even on desktop", () => {
    renderLink();
    fireEvent.click(screen.getByRole("link", { name: "Messages" }), { button: 0, ctrlKey: true });
    expect(openMessengerMock).not.toHaveBeenCalled();
  });

  it("still renders a real href to the full-page /messages route regardless of viewport -- interception is click-time only", () => {
    renderLink();
    expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("href", "/messages");
  });

  it("still shows the unread-conversation-count badge, unaffected by the click interception", () => {
    renderLink(4);
    expect(screen.getByRole("link", { name: "Messages, 4 unread" })).toBeInTheDocument();
  });
});
