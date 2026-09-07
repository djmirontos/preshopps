import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { CartProvider } from "@/components/cart/CartProvider";
import { GuestCartClient } from "@/components/cart/GuestCartClient";
import { writeGuestCart, readGuestCart } from "@/lib/cart/guest-cart-storage";

const STORAGE_KEY = "preshopps:guest-cart:v1";

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    listing_id: "listing-1",
    title: "Nike Air Max 270",
    price_cents: 250000,
    status: "available",
    available_quantity: 5,
    is_inquiry_only: false,
    image_paths: [],
    shop_id: "shop-1",
    shop_name: "Anne's Closet",
    ...overrides,
  };
}

function renderGuestCart() {
  return render(
    <CartProvider initialLines={[]} isAuthenticated={false}>
      <GuestCartClient />
    </CartProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  window.localStorage.clear();
});

describe("GuestCartClient", () => {
  it("shows the empty state when the guest cart is empty", async () => {
    renderGuestCart();
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
  });

  it("hydrates and renders a guest cart line via get_listing_detail", async () => {
    writeGuestCart([{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 2 }]);
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });

    renderGuestCart();

    await waitFor(() => expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument());
    expect(rpcMock).toHaveBeenCalledWith("get_listing_detail", { p_public_code: "PLS-ABC" });
  });

  it("increments quantity and persists to localStorage", async () => {
    writeGuestCart([{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 1 }]);
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });

    renderGuestCart();
    await waitFor(() => expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(readGuestCart()).toEqual([{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 2 }]);
  });

  it("decrements quantity down to a minimum of 1", async () => {
    writeGuestCart([{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 2 }]);
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });

    renderGuestCart();
    await waitFor(() => expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument());

    const decrement = screen.getByRole("button", { name: /decrease quantity/i });
    fireEvent.click(decrement);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(decrement).toBeDisabled();
  });

  it("removes a line and persists the removal to localStorage", async () => {
    writeGuestCart([{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 1 }]);
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });

    renderGuestCart();
    await waitFor(() => expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
    expect(readGuestCart()).toEqual([]);
  });

  it("shows a generic unavailable row when get_listing_detail returns nothing (removed/paused/deleted)", async () => {
    writeGuestCart([{ listingId: "listing-1", publicCode: "PLS-GONE", quantity: 1 }]);
    rpcMock.mockResolvedValue({ data: [], error: null });

    renderGuestCart();

    await waitFor(() => expect(screen.getByText("Item no longer available")).toBeInTheDocument());
    expect(screen.getByText("No longer available")).toBeInTheDocument();
    // Still removable, never silently dropped.
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("falls back to an empty cart when localStorage is corrupted", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");
    renderGuestCart();
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("shows a primary sign-in action instead of any submit control -- order submission requires an account", async () => {
    writeGuestCart([{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 1 }]);
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });

    renderGuestCart();
    await waitFor(() => expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument());

    const signInLink = screen.getByRole("link", { name: "Sign in to Checkout" });
    expect(signInLink).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent("/cart")}`);
    expect(screen.queryByRole("button", { name: /submit order/i })).not.toBeInTheDocument();
  });
});
