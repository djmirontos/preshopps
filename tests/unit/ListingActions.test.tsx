import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth/use-is-authenticated", async (importOriginal) => importOriginal());

const { rpcMock, pushMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { ListingActions } from "@/components/listing/ListingActions";

const NEXT = "/item/PLS-ABC123";

beforeEach(() => {
  rpcMock.mockReset();
  pushMock.mockReset();
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

  it("calls start_conversation with the shop id, listing id, and typed body, then navigates to the resulting conversation", async () => {
    rpcMock.mockResolvedValue({
      data: [{ conversation_id: "conv-1", message_id: "msg-1", message_created_at: "2026-01-05T00:00:00.000Z", conversation_created: true }],
      error: null,
    });
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
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/messages/conv-1"));
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
});
