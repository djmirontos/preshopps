import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { CartProvider, useCart } from "@/components/cart/CartProvider";
import { AuthenticatedCartClient } from "@/components/cart/AuthenticatedCartClient";
import type { CartLineDisplay } from "@/lib/cart/get-my-cart";

/** Reads the same shared itemCount the header cart badge reads, so a test
 * can prove Remove updates it immediately without inspecting AppHeader
 * itself. */
function ItemCountProbe() {
  const { itemCount } = useCart();
  return <p data-testid="item-count">{itemCount}</p>;
}

function makeLine(overrides: Partial<CartLineDisplay> = {}): CartLineDisplay {
  return {
    cartItemId: "ci-listing-1",
    listingId: "listing-1",
    publicCode: "PLS-ABC",
    title: "Nike Air Max 270",
    imageUrl: undefined,
    priceCents: 250000,
    priceCentsSnapshot: 250000,
    priceChanged: false,
    status: "available",
    isInquiryOnly: false,
    quantity: 2,
    availableQuantity: 5,
    isSubmittable: true,
    unavailableReason: null,
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    fulfillmentMethods: ["meetup", "shipping"],
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderClient(lines: CartLineDisplay[], hadError = false) {
  return render(
    <CartProvider initialLines={lines.map((l) => ({ listingId: l.listingId, publicCode: l.publicCode, quantity: l.quantity }))} isAuthenticated>
      <AuthenticatedCartClient initialLines={lines} hadError={hadError} />
    </CartProvider>,
  );
}

/** Same as renderClient, but with the shared item-count probe mounted
 * alongside -- kept as a separate helper (rather than always-on) so its
 * own rendered number can't collide with an in-row quantity that happens
 * to match, in tests that don't care about the count at all. */
function renderClientWithCountProbe(lines: CartLineDisplay[]) {
  return render(
    <CartProvider initialLines={lines.map((l) => ({ listingId: l.listingId, publicCode: l.publicCode, quantity: l.quantity }))} isAuthenticated>
      <ItemCountProbe />
      <AuthenticatedCartClient initialLines={lines} hadError={false} />
    </CartProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("AuthenticatedCartClient", () => {
  it("shows the empty state when there are no lines", () => {
    renderClient([]);
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse listings" })).toHaveAttribute("href", "/search");
  });

  it("shows an error message when hadError is true", () => {
    renderClient([], true);
    expect(screen.getByText(/unable to load your cart/i)).toBeInTheDocument();
  });

  it("groups rows by shop", () => {
    renderClient([
      makeLine({ listingId: "l1", shopId: "shop-1", shopName: "Anne's Closet" }),
      makeLine({ listingId: "l2", shopId: "shop-2", shopName: "Bob's Store", title: "Vintage Jacket" }),
    ]);
    expect(screen.getByText("Anne's Closet")).toBeInTheDocument();
    expect(screen.getByText("Bob's Store")).toBeInTheDocument();
  });

  it("computes per-shop and overall subtotal math from submittable rows", () => {
    renderClient([
      makeLine({ listingId: "l1", priceCents: 10000, quantity: 2 }), // 20000
      makeLine({ listingId: "l2", priceCents: 5000, quantity: 3 }), // 15000
    ]);
    // Both rows share shop-1 -> group subtotal appears twice (group + overall = same value here).
    const subtotals = screen.getAllByText("₱350");
    expect(subtotals.length).toBeGreaterThan(0);
  });

  it("excludes non-submittable rows from the subtotal", () => {
    renderClient([
      makeLine({ listingId: "l1", priceCents: 10000, quantity: 1, isSubmittable: true }),
      makeLine({ listingId: "l2", priceCents: 99999900, quantity: 1, isSubmittable: false, unavailableReason: "sold" }),
    ]);
    expect(screen.getByText("Sold")).toBeInTheDocument();
    expect(screen.getByText("Item subtotal")).toBeInTheDocument();
    expect(screen.getAllByText("₱100").length).toBeGreaterThan(0);
  });

  it("keeps an unavailable row visible with its reason label", () => {
    renderClient([makeLine({ unavailableReason: "reserved", isSubmittable: false })]);
    expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument();
    expect(screen.getByText("Reserved")).toBeInTheDocument();
  });

  it("increments quantity via set_cart_item_quantity", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_cart_item_quantity", { p_listing_id: "listing-1", p_quantity: 3 }),
    );
  });

  it("rolls back quantity on RPC failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "stock unavailable" } });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't update quantity/i));
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("removes a row via remove_cart_item", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClient([makeLine()]);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("remove_cart_item", { p_listing_id: "listing-1" }));
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
  });

  it("removes a line with quantity greater than 1 entirely -- Remove always deletes the whole line, never just decrements it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClient([makeLine({ quantity: 4 })]);
    expect(screen.getByText("4", { selector: "span[aria-live]" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("remove_cart_item", { p_listing_id: "listing-1" }));
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
    expect(screen.queryByText("4", { selector: "span[aria-live]" })).not.toBeInTheDocument();
  });

  it("removing one of several items removes only that row -- the other stays exactly as it was", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClient([
      makeLine({ listingId: "l1", title: "Nike Air Max 270" }),
      makeLine({ listingId: "l2", title: "Vintage Jacket", quantity: 1 }),
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("remove_cart_item", { p_listing_id: "l1" }));
    expect(screen.queryByText("Nike Air Max 270")).not.toBeInTheDocument();
    expect(screen.getByText("Vintage Jacket")).toBeInTheDocument();
    expect(screen.queryByText("Your cart is empty.")).not.toBeInTheDocument();
  });

  it("removing a row immediately updates the shared cart item count (the same count the header badge reads) -- no page refresh needed", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClientWithCountProbe([makeLine({ listingId: "l1", quantity: 2 }), makeLine({ listingId: "l2", quantity: 1 })]);
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

    await waitFor(() => expect(screen.getByTestId("item-count")).toHaveTextContent("1"));
  });

  it("removing a row immediately recalculates the displayed subtotal", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClient([
      makeLine({ listingId: "l1", priceCents: 10000, quantity: 2 }), // 20000
      makeLine({ listingId: "l2", priceCents: 5000, quantity: 3 }), // 15000
    ]);
    expect(screen.getAllByText("₱350").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[1]);

    await waitFor(() => expect(screen.getAllByText("₱200").length).toBeGreaterThan(0));
    expect(screen.queryByText("₱350")).not.toBeInTheDocument();
  });

  it("a sold/unavailable row can still be removed -- cleanup is never blocked just because the listing can no longer be purchased", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClient([makeLine({ isSubmittable: false, unavailableReason: "sold", availableQuantity: 0 })]);
    expect(screen.getByText("Sold")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("remove_cart_item", { p_listing_id: "listing-1" }));
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
  });

  it("removing calls no RPC besides remove_cart_item -- never touches stock, listing status, or order/reservation state", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClient([makeLine()]);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const calledRpcNames = rpcMock.mock.calls.map((call) => call[0]);
    expect(calledRpcNames).toEqual(["remove_cart_item"]);
  });

  it("never passes a client-supplied user id to the mutation RPCs", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderClient([makeLine({ listingId: "listing-77" })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const [, args] = rpcMock.mock.calls[0];
    expect(Object.keys(args).sort()).toEqual(["p_listing_id", "p_quantity"]);
    expect(args.p_listing_id).toBe("listing-77");
  });

  it("renders the order review/submit area for an eligible cart", () => {
    renderClient([makeLine()]);
    expect(screen.getByText("1 item ready to submit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument();
  });

  it("a successful order submission that empties the cart still shows the success confirmation, not just the empty state", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_cart_order") {
        return Promise.resolve({
          data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-ABC", item_count: 1, total_cents: 500000, status: "pending" }],
          error: null,
        });
      }
      if (fn === "get_my_cart") return Promise.resolve({ data: [], error: null });
      throw new Error(`unexpected rpc ${fn}`);
    });

    renderClient([makeLine()]);
    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/order submitted successfully/i));
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("never calls set_cart_item_quantity during order submission -- cart_item_id comes directly from get_my_cart", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_cart_order") {
        return Promise.resolve({
          data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-ABC", item_count: 1, total_cents: 500000, status: "pending" }],
          error: null,
        });
      }
      if (fn === "get_my_cart") return Promise.resolve({ data: [], error: null });
      throw new Error(`unexpected rpc ${fn}`);
    });

    renderClient([makeLine()]);
    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("submit_cart_order", expect.anything()));
    expect(rpcMock).not.toHaveBeenCalledWith("set_cart_item_quantity", expect.anything());
    expect(rpcMock.mock.calls.find(([fn]) => fn === "submit_cart_order")?.[1].p_cart_item_ids).toEqual(["ci-listing-1"]);
  });
});

/** Dispatches by RPC name, throwing on any unrecognized name so a stray/
 * unexpected RPC call fails the test loudly rather than silently. */
function mockBlocked(restrictions: { restriction_type: string }[]) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "set_cart_item_quantity") {
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

describe("AuthenticatedCartClient -- restriction-aware INTERACTION_BLOCKED presentation (A2.2.2h)", () => {
  it("attaches the buying-access detail and 'View account status' link when buyer_restricted is confirmed on increment", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(screen.getByText("Your buying access is currently restricted.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("attaches the account-suspended detail and link on decrement", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /decrease quantity/i }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("account_suspended wins precedence when both account_suspended and buyer_restricted are active", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }, { restriction_type: "account_suspended" }]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
  });

  it("ignores a caller's own seller_suspended restriction -- returned by the lookup but excluded by selection since it is not in this action's relevant array", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the generic message when the restriction lookup returns empty (e.g. a deleted-account or mutual-block collision)", async () => {
    mockBlocked([]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the generic message, without throwing, when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "set_cart_item_quantity") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the generic message, without throwing, when the restriction lookup rejects", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "set_cart_item_quantity") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.reject(new Error("network down"));
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("never calls get_my_active_restrictions for LISTING_NOT_CARTABLE -- a listing/seller-side code, never the caller's own restriction", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not cartable", details: "LISTING_NOT_CARTABLE" } });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("never calls get_my_active_restrictions for CANNOT_BUY_OWN_LISTING", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "own listing", details: "CANNOT_BUY_OWN_LISTING" } });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions for QUANTITY_UNAVAILABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "stock", details: "QUANTITY_UNAVAILABLE" } });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions for QUANTITY_INVALID", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "QUANTITY_INVALID" } });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update quantity/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful quantity change", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("set_cart_item_quantity", expect.anything()));
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("rolls back the row quantity even when the failure carries a confirmed restriction presentation", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    await screen.findByText("Your buying access is currently restricted.");
    expect(screen.getByText("2", { selector: "span[aria-live]" })).toBeInTheDocument();
  });

  it("retrying after a restriction failure replaces the stale presentation with the new attempt's result", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
    await screen.findByText("Your buying access is currently restricted.");

    rpcMock.mockResolvedValue({ data: null, error: { message: "not cartable", details: "LISTING_NOT_CARTABLE" } });
    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't update quantity/i));
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a successful retry after a restriction failure clears the detail/link", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
    await screen.findByText("Your buying access is currently restricted.");

    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
  });

  it("restriction guidance stays scoped to the row that actually failed -- the other row shows nothing", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderClient([
      makeLine({ listingId: "l1", title: "Nike Air Max 270", quantity: 2 }),
      makeLine({ listingId: "l2", title: "Vintage Jacket", quantity: 1 }),
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: /increase quantity/i })[0]);

    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();
    // Only one alert/detail/link exists in the whole document -- scoped to
    // the row whose increment actually failed.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "View account status" })).toHaveLength(1);
  });

  it("remove_cart_item never calls get_my_active_restrictions and keeps its existing generic-only error copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't remove this item/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("removal remains unaffected even when the caller happens to have an active buyer_restricted restriction -- removal is restriction-blind by RPC design", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderClient([makeLine({ quantity: 2 })]);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("remove_cart_item", { p_listing_id: "listing-1" }));
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument());
  });
});
