import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth/use-is-authenticated", async (importOriginal) => importOriginal());

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
    openConversationId: null,
    isMinimized: false,
    openConversation: openConversationMock,
    minimize: vi.fn(),
    restore: vi.fn(),
    close: vi.fn(),
  }),
}));

import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { ListingActions } from "@/components/listing/ListingActions";

const NEXT = "/item/PLS-ABC123";

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
  window.localStorage.clear();
});

function renderActions({
  isAuthenticated,
  status = "available",
  isInquiryOnly = false,
  availableQuantity = 5,
  listingId = "listing-1",
  publicCode = "PLS-ABC123",
  shopId = "shop-1",
  isOwnListing = false,
}: {
  isAuthenticated: boolean;
  status?: "available" | "reserved" | "sold" | "archived";
  isInquiryOnly?: boolean;
  availableQuantity?: number;
  listingId?: string;
  publicCode?: string;
  shopId?: string;
  isOwnListing?: boolean;
}) {
  return render(
    <AuthStatusProvider isAuthenticated={isAuthenticated}>
      <CartProvider initialLines={[]} isAuthenticated={isAuthenticated}>
        <ListingActions
          listingId={listingId}
          publicCode={publicCode}
          shopId={shopId}
          availableQuantity={availableQuantity}
          status={status}
          isInquiryOnly={isInquiryOnly}
          isAuthenticated={isAuthenticated}
          isOwnListing={isOwnListing}
          next={NEXT}
        />
      </CartProvider>
    </AuthStatusProvider>,
  );
}

describe("ListingActions (authenticated)", () => {
  it("shows a real, enabled Add to Cart for an available, ordinary listing", () => {
    renderActions({ isAuthenticated: true });
    expect(screen.getByRole("button", { name: "Add to Cart" })).not.toBeDisabled();
  });

  it("adds to the DB cart via set_cart_item_quantity when clicked", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1", listing_id: "listing-1", quantity: 1 }], error: null });
    renderActions({ isAuthenticated: true, listingId: "listing-1" });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_cart_item_quantity", { p_listing_id: "listing-1", p_quantity: 1 }),
    );
  });

  it("shows an enabled Message Seller alongside Add to Cart", () => {
    renderActions({ isAuthenticated: true });
    expect(screen.getByRole("button", { name: "Message Seller" })).not.toBeDisabled();
  });

  it("opens a compose dialog (not the auth gate) for an authenticated user", () => {
    renderActions({ isAuthenticated: true });
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Sign in to message this seller")).not.toBeInTheDocument();
  });

  it("calls start_conversation with the shop id, listing id, and typed body, then opens the floating chat panel on desktop (no navigation away from the listing)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    setViewportWidth(DESKTOP_WIDTH);
    renderActions({ isAuthenticated: true, shopId: "shop-1", listingId: "listing-1" });

    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Is this still available?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("start_conversation", {
        p_shop_id: "shop-1",
        p_body: "Is this still available?",
        p_listing_id: "listing-1",
      }),
    );
    await waitFor(() => expect(openConversationMock).toHaveBeenCalledWith("conv-1"));
    expect(pushMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("navigates to the full-page conversation route on mobile instead of opening the (desktop-only) floating panel", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    setViewportWidth(MOBILE_WIDTH);
    renderActions({ isAuthenticated: true, shopId: "shop-1", listingId: "listing-1" });

    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Is this still available?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/messages/conv-1"));
    expect(openConversationMock).not.toHaveBeenCalled();
  });

  it("hides Message Seller entirely for the listing's own owner", () => {
    renderActions({ isAuthenticated: true, isOwnListing: true });
    expect(screen.queryByRole("button", { name: "Message Seller" })).not.toBeInTheDocument();
  });

  it("hides Add to Cart when reserved", () => {
    renderActions({ isAuthenticated: true, status: "reserved" });
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/currently reserved/i)).toBeInTheDocument();
  });

  it("hides Add to Cart when sold", () => {
    renderActions({ isAuthenticated: true, status: "sold" });
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/already been sold/i)).toBeInTheDocument();
  });

  it("hides Add to Cart when archived", () => {
    renderActions({ isAuthenticated: true, status: "archived" });
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it("never shows Add to Cart for an inquiry-only listing, regardless of status", () => {
    for (const status of ["available", "reserved", "sold", "archived"] as const) {
      const { unmount } = renderActions({ isAuthenticated: true, isInquiryOnly: true, status });
      expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows Out of Stock, disabled, when available stock is zero", () => {
    renderActions({ isAuthenticated: true, availableQuantity: 0 });
    expect(screen.getByRole("button", { name: "Out of Stock" })).toBeDisabled();
  });
});

describe("ListingActions -- self-purchase guard (own listing)", () => {
  it("shows a disabled 'Your listing' button instead of an active Add to Cart for the listing's own owner", () => {
    renderActions({ isAuthenticated: true, isOwnListing: true });
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your listing" })).toBeDisabled();
  });

  it("never calls set_cart_item_quantity for the listing's own owner, even on click", () => {
    renderActions({ isAuthenticated: true, isOwnListing: true, listingId: "listing-1" });
    fireEvent.click(screen.getByRole("button", { name: "Your listing" }));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("shows no generic cart error just from viewing (rendering) their own listing", () => {
    renderActions({ isAuthenticated: true, isOwnListing: true });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't add/i)).not.toBeInTheDocument();
  });

  it("still shows a real, enabled Add to Cart for a listing owned by someone else", () => {
    renderActions({ isAuthenticated: true, isOwnListing: false });
    expect(screen.queryByRole("button", { name: "Your listing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Cart" })).not.toBeDisabled();
  });

  it("never shows 'Your listing' when the listing is unavailable (reserved/sold/archived) -- same gate as Add to Cart itself", () => {
    for (const status of ["reserved", "sold", "archived"] as const) {
      const { unmount } = renderActions({ isAuthenticated: true, isOwnListing: true, status });
      expect(screen.queryByRole("button", { name: "Your listing" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("never shows 'Your listing' for an inquiry-only listing -- Add to Cart was never offered there either", () => {
    renderActions({ isAuthenticated: true, isOwnListing: true, isInquiryOnly: true });
    expect(screen.queryByRole("button", { name: "Your listing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
  });
});

describe("ListingActions -- mobile secondary-CTA sizing fix (Message Seller was rendering too thin)", () => {
  it("Message Seller is full width on mobile (w-full), not fighting a column-direction flex-1 for its height", () => {
    setViewportWidth(MOBILE_WIDTH);
    renderActions({ isAuthenticated: true });
    const messageButton = screen.getByRole("button", { name: "Message Seller" });
    expect(messageButton.className).toMatch(/\bw-full\b/);
  });

  it("Message Seller has at least a 48px (h-12) minimum touch height -- comfortably above the 44px minimum", () => {
    renderActions({ isAuthenticated: true });
    const messageButton = screen.getByRole("button", { name: "Message Seller" });
    expect(messageButton.className).toMatch(/\bh-12\b/);
  });

  it("Message Seller remains visually secondary -- white/light background with a clear border, never the orange primary treatment", () => {
    renderActions({ isAuthenticated: true });
    const messageButton = screen.getByRole("button", { name: "Message Seller" });
    expect(messageButton.className).toMatch(/bg-surface/);
    expect(messageButton.className).toMatch(/\bborder\b/);
    expect(messageButton.className).not.toMatch(/bg-brand-action/);
  });

  it("Add to Cart remains the full-width, orange primary CTA, unchanged by this fix", () => {
    renderActions({ isAuthenticated: true });
    const addToCartButton = screen.getByRole("button", { name: "Add to Cart" });
    expect(addToCartButton.className).toMatch(/bg-brand-action/);
    expect(addToCartButton.className).toMatch(/\bh-12\b/);
    expect(addToCartButton.className).toMatch(/\bw-full\b/);
  });

  it("preserves the existing comfortable gap between the stacked mobile actions", () => {
    renderActions({ isAuthenticated: true });
    const row = screen.getByRole("button", { name: "Add to Cart" }).closest("div.flex");
    expect(row?.className).toMatch(/gap-2\.5/);
  });

  it("the disabled 'Your listing' owner button gets the exact same height fix (it shares the same base class as Message Seller) -- still disabled, still the same text, only its height bug is fixed", () => {
    renderActions({ isAuthenticated: true, isOwnListing: true });
    const ownListingButton = screen.getByRole("button", { name: "Your listing" });
    expect(ownListingButton.className).toMatch(/\bh-12\b/);
    expect(ownListingButton.className).toMatch(/\bw-full\b/);
    expect(ownListingButton).toBeDisabled();
  });

  it("desktop (>= sm, where this component's own row layout already switches) keeps the exact previous side-by-side sizing -- sm:flex-1 restores equal-width buttons in a row, unaffected by the mobile-only fix", () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderActions({ isAuthenticated: true });
    const messageButton = screen.getByRole("button", { name: "Message Seller" });
    expect(messageButton.className).toMatch(/sm:w-auto/);
    expect(messageButton.className).toMatch(/sm:flex-1/);
  });
});

describe("ListingActions (guest)", () => {
  it("adds to the local guest cart with no auth gate", () => {
    renderActions({ isAuthenticated: false, listingId: "listing-1", publicCode: "PLS-ABC123" });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByText("1 in cart")).toBeInTheDocument();
  });

  it("still opens the auth gate when a guest clicks Message Seller", () => {
    renderActions({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByText("Sign in to message this seller")).toBeInTheDocument();
  });

  it("opens the Message Seller gate for an inquiry-only listing (its only action)", () => {
    renderActions({ isAuthenticated: false, isInquiryOnly: true });
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByText("Sign in to message this seller")).toBeInTheDocument();
  });

  it("carries the given safe next path into the Message Seller gate links", () => {
    renderActions({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent(NEXT)}`,
    );
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      `/sign-up?next=${encodeURIComponent(NEXT)}`,
    );
  });

  it("closes the message gate on Escape", () => {
    renderActions({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides Message Seller entirely for the listing's own owner (never reachable as a guest, but the isOwnListing prop is still honored)", () => {
    renderActions({ isAuthenticated: false, isOwnListing: true });
    expect(screen.queryByRole("button", { name: "Message Seller" })).not.toBeInTheDocument();
  });

  it("adds to the local guest cart exactly as before when isOwnListing is false (unaffected by the self-purchase guard)", () => {
    renderActions({ isAuthenticated: false, isOwnListing: false, listingId: "listing-1", publicCode: "PLS-ABC123" });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.getByText("1 in cart")).toBeInTheDocument();
  });
});

describe("ListingActions -- mobile CTA fix touched styling only, never messaging/cart logic", () => {
  it("Message Seller still calls start_conversation with the exact same arguments as before this styling fix", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
    renderActions({ isAuthenticated: true, shopId: "shop-1", listingId: "listing-1" });

    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Still available?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("start_conversation", {
        p_shop_id: "shop-1",
        p_body: "Still available?",
        p_listing_id: "listing-1",
      }),
    );
  });

  it("Add to Cart still calls set_cart_item_quantity with the exact same arguments as before this styling fix", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1", listing_id: "listing-1", quantity: 1 }], error: null });
    renderActions({ isAuthenticated: true, listingId: "listing-1" });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_cart_item_quantity", { p_listing_id: "listing-1", p_quantity: 1 }),
    );
  });

  it("no new RPC name was introduced by this fix -- only these two, pre-existing calls are ever made", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1", listing_id: "listing-1", quantity: 1 }], error: null });
    renderActions({ isAuthenticated: true, listingId: "listing-1" });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());

    const calledRpcNames = rpcMock.mock.calls.map((call) => call[0]);
    for (const name of calledRpcNames) {
      expect(["set_cart_item_quantity"]).toContain(name);
    }
  });
});
