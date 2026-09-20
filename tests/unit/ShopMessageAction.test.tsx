import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { rpcMock, pushMock, openConversationMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  pushMock: vi.fn(),
  openConversationMock: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("@/components/messaging/FloatingMessengerProvider", () => ({
  useFloatingMessenger: () => ({
    isOpen: false,
    selectedConversationId: null,
    openMessenger: vi.fn(),
    openConversation: openConversationMock,
    minimize: vi.fn(),
    close: vi.fn(),
  }),
}));

import { ShopMessageAction } from "@/components/shop/ShopMessageAction";

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

beforeEach(() => {
  rpcMock.mockReset();
  pushMock.mockReset();
  openConversationMock.mockReset();
  setViewportWidth(DESKTOP_WIDTH);
});

function renderAction(overrides: Partial<React.ComponentProps<typeof ShopMessageAction>> = {}) {
  return render(
    <ShopMessageAction shopId="shop-1" shopSlug="annes-closet" isAuthenticated={true} isOwnShop={false} {...overrides} />,
  );
}

async function openComposeAndSend(body = "hi") {
  fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: body } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("ShopMessageAction -- baseline", () => {
  it("hides the action entirely for the shop's own owner", () => {
    renderAction({ isOwnShop: true });
    expect(screen.queryByRole("button", { name: "Message Seller" })).not.toBeInTheDocument();
  });

  it("opens the auth gate, not the compose dialog, for a guest", () => {
    renderAction({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByText("Sign in to message this seller")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Message Seller" })).not.toBeInTheDocument();
  });

  it("opens the compose dialog for an authenticated non-owner", () => {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("calls start_conversation with the shop id and typed body, with no listing id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    renderAction({ shopId: "shop-1" });

    await openComposeAndSend("Do you ship internationally?");

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("start_conversation", {
        p_shop_id: "shop-1",
        p_body: "Do you ship internationally?",
        p_listing_id: null,
      }),
    );
  });

  it("opens the floating chat panel on desktop, with no navigation away from the shop page", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    setViewportWidth(DESKTOP_WIDTH);
    renderAction();

    await openComposeAndSend();

    await waitFor(() => expect(openConversationMock).toHaveBeenCalledWith("conv-1"));
    expect(pushMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("navigates to the full-page conversation route on mobile instead", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    setViewportWidth(MOBILE_WIDTH);
    renderAction();

    await openComposeAndSend();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/messages/conv-1"));
    expect(openConversationMock).not.toHaveBeenCalled();
  });
});

describe("ShopMessageAction -- restriction-aware INTERACTION_BLOCKED error (A2.2.2f.1)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "start_conversation") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({
          data: restrictions.map((r, i) => ({ restriction_id: `r${i}`, restriction_type: r.restriction_type, reason: "x", created_at: "2026-01-01T00:00:00.000Z" })),
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
  }

  it("a buyer_restricted failure shows the generic message, the specific buying-access message, and a 'View account status' link", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderAction();

    await openComposeAndSend();

    expect(await screen.findByText("You can't message this seller right now.")).toBeInTheDocument();
    expect(screen.getByText("Your buying access is currently restricted.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("an account_suspended failure shows the specific account-suspended message and link", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);
    renderAction();

    await openComposeAndSend();

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("a generic blocked result (no confirmed restriction) shows only the existing generic message, with no detail and no link", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
    renderAction();

    await openComposeAndSend();

    expect(await screen.findByText("You can't message this seller right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a caller with only an unrelated seller_suspended restriction gets the generic message, never a link", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);
    renderAction();

    await openComposeAndSend();

    expect(await screen.findByText("You can't message this seller right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("retrying after a restriction failure replaces the stale presentation with the new attempt's result", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderAction();

    await openComposeAndSend();
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    rpcMock.mockResolvedValue({ data: null, error: { message: "empty", details: "MESSAGE_TOO_LONG" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Messages can be up to 4000 characters.")).toBeInTheDocument();
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a successful retry after a restriction failure clears the error and link entirely", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderAction();

    await openComposeAndSend();
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("closing the dialog after a restriction failure and reopening it never shows the stale message, detail, or link", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderAction();

    await openComposeAndSend();
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.queryByText("You can't message this seller right now.")).not.toBeInTheDocument();
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("desktop/mobile post-success navigation is unaffected by the new restriction-aware wiring", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    setViewportWidth(MOBILE_WIDTH);
    renderAction();

    await openComposeAndSend();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/messages/conv-1"));
    expect(openConversationMock).not.toHaveBeenCalled();
  });
});
