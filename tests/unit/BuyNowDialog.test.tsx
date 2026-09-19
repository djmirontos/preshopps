import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { rpcMock, pushMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CartProvider, useCart } from "@/components/cart/CartProvider";
import { BuyNowDialog } from "@/components/cart/BuyNowDialog";

/** Row shape exactly matching get_listing_detail's RETURNS TABLE
 * (0036_public_marketplace_read_rpcs.sql) -- the only fields BuyNowDialog
 * actually reads. */
function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    listing_id: "listing-1",
    public_code: "PLS-ABC",
    title: "Nike Air Max 270",
    price_cents: 250000,
    status: "available",
    available_quantity: 5,
    is_inquiry_only: false,
    image_paths: [],
    fulfillment_methods: ["meetup", "shipping"],
    shop_id: "shop-1",
    shop_slug: "annes-closet",
    shop_name: "Anne's Closet",
    ...overrides,
  };
}

const SUCCESSFUL_ORDER_ROW = {
  order_id: "order-1",
  shop_id: "shop-1",
  order_public_code: "PSO-1",
  item_count: 1,
  total_cents: 250000,
  status: "pending",
};

function mockOpenThenSuccess() {
  rpcMock.mockImplementation((name: string) => {
    // The listing itself is still "available" after the order is created
    // -- reservation only happens on seller acceptance -- so a post-submit
    // refresh would still return a submittable row if one were ever
    // requested. With the onSuccess navigation path this doesn't matter --
    // no refresh/re-render happens at all once the order is created.
    if (name === "get_listing_detail") return Promise.resolve({ data: [detailRow()], error: null });
    if (name === "submit_buy_now_order") return Promise.resolve({ data: [SUCCESSFUL_ORDER_ROW], error: null });
    return Promise.resolve({ data: [], error: null });
  });
}

/** Reads the shared cart lines/item count so a test can prove Buy Now
 * never mutates CartProvider's own state at any point in its lifecycle. */
function CartStateProbe() {
  const { lines, itemCount } = useCart();
  return (
    <div>
      <p data-testid="cart-lines">{JSON.stringify(lines)}</p>
      <p data-testid="item-count">{itemCount}</p>
    </div>
  );
}

function renderDialog({
  publicCode = "PLS-ABC",
  initialLines = [] as { listingId: string; publicCode: string | null; quantity: number }[],
  onClose = vi.fn(),
}: {
  publicCode?: string;
  initialLines?: { listingId: string; publicCode: string | null; quantity: number }[];
  onClose?: () => void;
} = {}) {
  return {
    onClose,
    ...render(
      <CartProvider initialLines={initialLines} isAuthenticated={true}>
        <CartStateProbe />
        <BuyNowDialog publicCode={publicCode} onClose={onClose} />
      </CartProvider>,
    ),
  };
}

function rpcNamesCalled(): string[] {
  return rpcMock.mock.calls.map((call) => call[0]);
}

async function chooseFulfillmentAndSubmit() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));
}

beforeEach(() => {
  rpcMock.mockReset();
  pushMock.mockReset();
});

describe("BuyNowDialog -- reuses the canonical order-review flow, never a second implementation", () => {
  it("renders the existing OrderReviewSubmit UI (Submit Order / fulfillment picker), not a bespoke Buy Now form", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });

    renderDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());
    expect(screen.getByText("1 item ready to submit")).toBeInTheDocument();
  });

  it("builds its review line from the existing public get_listing_detail RPC, keyed by public_code", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });

    renderDialog({ publicCode: "PLS-ABC" });

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_listing_detail", { p_public_code: "PLS-ABC" }));
  });

  it("submits via the new submit_buy_now_order RPC, never submit_cart_order", async () => {
    mockOpenThenSuccess();
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("submit_buy_now_order", {
        p_listing_id: "listing-1",
        p_quantity: 1,
        p_fulfillment_method: "meetup",
        p_expected_price_cents: 250000,
        p_buyer_note: null,
      }),
    );
    expect(rpcNamesCalled()).not.toContain("submit_cart_order");
  });
});

describe("BuyNowDialog -- successful submission navigates straight to the created order's detail page (no intermediate success card)", () => {
  it("navigates to the canonical buyer order-detail route, /orders/{publicCode}, using the order the RPC actually returned", async () => {
    mockOpenThenSuccess();
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-1"));
  });

  it("never shows the 'Order submitted successfully' intermediate card", async () => {
    mockOpenThenSuccess();
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(screen.queryByText(/Order submitted successfully/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never shows a View orders link", async () => {
    mockOpenThenSuccess();
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "View orders" })).not.toBeInTheDocument();
  });

  it("closes the Buy Now dialog (calls onClose) as part of a successful navigation -- the dialog is not left open", async () => {
    mockOpenThenSuccess();
    const { onClose } = renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith("/orders/PSO-1");
  });

  it("the fulfillment selector and Submit Order never reappear once the order is created", async () => {
    mockOpenThenSuccess();
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Anne's Closet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit Order" })).not.toBeInTheDocument();
  });

  it("a second submission cannot occur -- submit_buy_now_order is called exactly once", async () => {
    mockOpenThenSuccess();
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(rpcMock.mock.calls.filter(([name]) => name === "submit_buy_now_order")).toHaveLength(1);
  });
});

describe("BuyNowDialog -- a failed submission never navigates and stays open with the existing error behavior", () => {
  it("does not call router.push when submission fails", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_listing_detail") return Promise.resolve({ data: [detailRow()], error: null });
      if (name === "submit_buy_now_order")
        return Promise.resolve({ data: null, error: { message: "boom", details: "PRICE_CHANGED" } });
      return Promise.resolve({ data: [], error: null });
    });

    renderDialog();
    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not close the dialog on a failed submission", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_listing_detail") return Promise.resolve({ data: [detailRow()], error: null });
      if (name === "submit_buy_now_order")
        return Promise.resolve({ data: null, error: { message: "boom", details: "QUANTITY_UNAVAILABLE" } });
      return Promise.resolve({ data: [], error: null });
    });

    const { onClose } = renderDialog();
    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the existing generic error message, not a raw backend error", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_listing_detail") return Promise.resolve({ data: [detailRow()], error: null });
      if (name === "submit_buy_now_order")
        return Promise.resolve({ data: null, error: { message: "boom", details: "CANNOT_BUY_OWN_LISTING" } });
      return Promise.resolve({ data: [], error: null });
    });

    renderDialog();
    await chooseFulfillmentAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/review your cart/i);
    expect(alert.textContent).not.toMatch(/CANNOT_BUY_OWN_LISTING/);
  });
});

describe("BuyNowDialog -- never uses the persistent cart as an implementation bridge", () => {
  it("never calls set_cart_item_quantity or remove_cart_item at any point (open, cancel, or submit)", async () => {
    mockOpenThenSuccess();

    const { unmount } = renderDialog();
    await chooseFulfillmentAndSubmit();
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    unmount();

    expect(rpcNamesCalled()).not.toContain("set_cart_item_quantity");
    expect(rpcNamesCalled()).not.toContain("remove_cart_item");
  });

  it("never calls get_my_cart -- it has no persistent cart row to read or reconcile", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });
    renderDialog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());
    expect(rpcNamesCalled()).not.toContain("get_my_cart");
  });

  it("only ever calls get_listing_detail and submit_buy_now_order -- no other RPC name, no reservation call", async () => {
    mockOpenThenSuccess();

    renderDialog();
    await chooseFulfillmentAndSubmit();
    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    for (const name of rpcNamesCalled()) {
      expect(["get_listing_detail", "submit_buy_now_order"]).toContain(name);
    }
  });
});

describe("BuyNowDialog -- cart isolation is now structural (nothing is ever created to clean up)", () => {
  it("the shared cart lines/item count are byte-for-byte unchanged while the dialog is open", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });
    renderDialog({ initialLines: [{ listingId: "listing-2", publicCode: "PLS-XYZ", quantity: 3 }] });

    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");
    expect(screen.getByTestId("cart-lines")).toHaveTextContent("listing-2");
    expect(screen.getByTestId("cart-lines")).not.toHaveTextContent("listing-1");
  });

  it("closing (X button) leaves the cart exactly as it was -- no RPC call at all on close", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });
    const { onClose } = renderDialog({ initialLines: [{ listingId: "listing-2", publicCode: "PLS-XYZ", quantity: 3 }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());

    rpcMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");
  });

  it("Escape leaves the cart exactly as it was -- no RPC call at all", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });
    const { onClose } = renderDialog({ initialLines: [{ listingId: "listing-2", publicCode: "PLS-XYZ", quantity: 3 }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());

    rpcMock.mockClear();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");
  });

  it("backdrop click leaves the cart exactly as it was -- no RPC call at all", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });
    const { onClose, container } = renderDialog({ initialLines: [{ listingId: "listing-2", publicCode: "PLS-XYZ", quantity: 3 }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());

    rpcMock.mockClear();
    fireEvent.click(container.querySelector('[aria-hidden="true"]')!);

    expect(onClose).toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");
  });

  it("unmount (e.g. in-app navigation away) triggers no cleanup RPC -- there is nothing to clean up", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });
    const { unmount } = renderDialog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());

    rpcMock.mockClear();
    unmount();

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a successful Buy Now submission never changes the shared cart item count -- no cart line was ever submitted", async () => {
    mockOpenThenSuccess();

    renderDialog({ initialLines: [{ listingId: "listing-2", publicCode: "PLS-XYZ", quantity: 3 }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");
    expect(screen.getByTestId("cart-lines")).toHaveTextContent("listing-2");
  });

  it("existing cart already containing the SAME listing (different quantity) is completely untouched by Buy Now -- Buy Now still defaults to quantity 1, independent of the cart", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow()], error: null });
    renderDialog({ initialLines: [{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 3 }] });

    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument());
    // The cart's own quantity for this same listing stays exactly 3 --
    // Buy Now's own review line quantity (always 1, asserted via the
    // submit_buy_now_order call in the dedicated quantity test below) is
    // never derived from or written back to it.
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");
  });
});

describe("BuyNowDialog -- quantity is always independent of the persistent cart", () => {
  it("defaults to quantity 1 even when the same listing already sits in the cart at a different quantity", async () => {
    mockOpenThenSuccess();

    renderDialog({ initialLines: [{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 3 }] });
    await chooseFulfillmentAndSubmit();

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "submit_buy_now_order",
        expect.objectContaining({ p_quantity: 1 }),
      ),
    );
  });
});

describe("BuyNowDialog -- error handling", () => {
  it("shows an inline error when the listing can no longer be found", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    renderDialog();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no longer available/i));
    expect(screen.queryByRole("button", { name: "Submit Order" })).not.toBeInTheDocument();
  });

  it("shows an inline error when get_listing_detail fails outright", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    renderDialog();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("an unavailable listing (e.g. sold since page load) still renders the review UI with the item excluded, matching the existing OrderReviewSubmit behavior -- not a dialog-level error", async () => {
    rpcMock.mockResolvedValue({ data: [detailRow({ status: "sold" })], error: null });

    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("No items in your cart can be submitted right now.")).toBeInTheDocument(),
    );
  });
});

describe("BuyNowDialog -- restriction-aware INTERACTION_BLOCKED error (A2.2.2a, reusing OrderReviewSubmit's existing rendering unmodified)", () => {
  function mockBlockedWithRestriction(restrictionType: string) {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_listing_detail") return Promise.resolve({ data: [detailRow()], error: null });
      if (name === "submit_buy_now_order") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (name === "get_my_active_restrictions") {
        return Promise.resolve({
          data: [{ restriction_id: "r1", restriction_type: restrictionType, reason: "x", created_at: "2026-01-01T00:00:00.000Z" }],
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${name}`);
    });
  }

  it("shows the buying-access message and a 'View account status' link for buyer_restricted", async () => {
    mockBlockedWithRestriction("buyer_restricted");
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/buying access is currently restricted/i));
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows the account-suspended message and a 'View account status' link for account_suspended", async () => {
    mockBlockedWithRestriction("account_suspended");
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/account is currently suspended/i));
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("shows only the existing generic error, with no link, when only seller_suspended (unrelated) is active", async () => {
    mockBlockedWithRestriction("seller_suspended");
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("LISTING_NOT_ORDERABLE never triggers the restriction lookup or link", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "get_listing_detail") return Promise.resolve({ data: [detailRow()], error: null });
      if (name === "submit_buy_now_order") {
        return Promise.resolve({ data: null, error: { message: "not orderable", details: "LISTING_NOT_ORDERABLE" } });
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    renderDialog();

    await chooseFulfillmentAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
    expect(rpcNamesCalled()).not.toContain("get_my_active_restrictions");
  });
});
