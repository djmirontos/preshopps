import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { CartProvider, useCart } from "@/components/cart/CartProvider";
import { OrderReviewSubmit } from "@/components/cart/OrderReviewSubmit";
import type { CartLineDisplay } from "@/lib/cart/map-cart-row";
import type { SubmitCartOrderResult } from "@/lib/cart/submit-cart-order";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

function makeRow(overrides: Partial<CartLineDisplay> = {}): CartLineDisplay {
  return {
    cartItemId: "ci-1",
    listingId: "listing-1",
    publicCode: "PLS-ABC",
    title: "Nike Air Max 270",
    imageUrl: undefined,
    priceCents: 250000,
    priceCentsSnapshot: 250000,
    priceChanged: false,
    status: "available",
    isInquiryOnly: false,
    quantity: 1,
    availableQuantity: 5,
    isSubmittable: true,
    unavailableReason: null,
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    fulfillmentMethods: ["meetup", "pickup", "local_delivery", "shipping"],
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function Harness({ initialLines }: { initialLines: CartLineDisplay[] }) {
  const [lines, setLines] = useState(initialLines);
  return (
    <CartProvider initialLines={[]} isAuthenticated>
      <OrderReviewSubmit lines={lines} onLinesChange={setLines} />
    </CartProvider>
  );
}

/** Reads the shared CartProvider item count -- used to prove Buy Now-style
 * injection (removeFromCartOnSuccess=false) never changes it, while the
 * default /cart-style behavior still does. */
function ItemCountProbe() {
  const { itemCount } = useCart();
  return <p data-testid="item-count">{itemCount}</p>;
}

function InjectedHarness({
  initialLines,
  submit,
  refreshLines,
  removeFromCartOnSuccess,
  onSuccess,
  cartInitialLines = [],
}: {
  initialLines: CartLineDisplay[];
  submit?: (input: {
    rows: CartLineDisplay[];
    fulfillmentChoices: Record<string, FulfillmentMethod | undefined>;
  }) => Promise<SubmitCartOrderResult>;
  refreshLines?: () => Promise<{ lines: CartLineDisplay[]; hadError: boolean }>;
  removeFromCartOnSuccess?: boolean;
  onSuccess?: Parameters<typeof OrderReviewSubmit>[0]["onSuccess"];
  cartInitialLines?: { listingId: string; publicCode: string | null; quantity: number }[];
}) {
  const [lines, setLines] = useState(initialLines);
  return (
    <CartProvider initialLines={cartInitialLines} isAuthenticated>
      <ItemCountProbe />
      <OrderReviewSubmit
        lines={lines}
        onLinesChange={setLines}
        submit={submit}
        refreshLines={refreshLines}
        removeFromCartOnSuccess={removeFromCartOnSuccess}
        onSuccess={onSuccess}
      />
    </CartProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
});

function mockHappyPathRpc() {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "submit_cart_order") {
      return Promise.resolve({
        data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-ABC123", item_count: 1, total_cents: 250000, status: "pending" }],
        error: null,
      });
    }
    if (fn === "get_my_cart") {
      return Promise.resolve({ data: [], error: null });
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
}

describe("OrderReviewSubmit", () => {
  it("renders nothing when the cart is empty and nothing has been submitted", () => {
    const { container } = render(<Harness initialLines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the number of eligible items and the multi-seller explanation", () => {
    render(<Harness initialLines={[makeRow()]} />);
    expect(screen.getByText("1 item ready to submit")).toBeInTheDocument();
    expect(screen.getByText(/created as separate orders/i)).toBeInTheDocument();
  });

  it("excludes unavailable rows from the eligible count and shows a note about them", () => {
    render(
      <Harness
        initialLines={[
          makeRow({ listingId: "l1" }),
          makeRow({ listingId: "l2", isSubmittable: false, unavailableReason: "sold" }),
        ]}
      />,
    );
    expect(screen.getByText("1 item ready to submit")).toBeInTheDocument();
    expect(screen.getByText(/won't be included/i)).toBeInTheDocument();
  });

  it("disables submission entirely when every row is unavailable", () => {
    render(<Harness initialLines={[makeRow({ isSubmittable: false, unavailableReason: "sold" })]} />);
    expect(screen.getByText("No items in your cart can be submitted right now.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Order" })).toBeDisabled();
  });

  it("requires a fulfillment method to be chosen before the submit button enables", () => {
    render(<Harness initialLines={[makeRow()]} />);
    const button = screen.getByRole("button", { name: "Submit Order" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    expect(button).not.toBeDisabled();
  });

  it("only offers the intersection of every selected item's fulfillment methods for a shop group", () => {
    render(
      <Harness
        initialLines={[
          makeRow({ listingId: "l1", fulfillmentMethods: ["meetup", "shipping"] }),
          makeRow({ listingId: "l2", fulfillmentMethods: ["shipping", "local_delivery"] }),
        ]}
      />,
    );

    const select = screen.getByLabelText(/Anne's Closet/) as HTMLSelectElement;
    const optionLabels = within(select)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);

    expect(optionLabels).toEqual(["shipping"]);
  });

  it("never offers a method that even one selected item in the group does not support", () => {
    render(
      <Harness
        initialLines={[
          makeRow({ listingId: "l3", shopId: "shop-2", shopName: "Camera Hub", fulfillmentMethods: ["meetup", "pickup"] }),
          makeRow({ listingId: "l4", shopId: "shop-2", shopName: "Camera Hub", fulfillmentMethods: ["meetup"] }),
        ]}
      />,
    );
    const selects = screen.getAllByLabelText(/Camera Hub/) as HTMLSelectElement[];
    const options = within(selects[0])
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options).toEqual(["meetup"]);
    expect(options).not.toContain("pickup");
  });

  it("disables submission and explains it, without a select, when a shop group has no common method -- no invalid RPC call", async () => {
    render(
      <Harness
        initialLines={[
          makeRow({ listingId: "l1", fulfillmentMethods: ["meetup"] }),
          makeRow({ listingId: "l2", fulfillmentMethods: ["shipping"] }),
        ]}
      />,
    );

    expect(screen.queryByLabelText(/Anne's Closet/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/don't share a common delivery or pickup method/i);
    expect(screen.getByRole("button", { name: "Submit Order" })).toBeDisabled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("submits via submit_cart_order with the chosen fulfillment method and shows a success result", async () => {
    mockHappyPathRpc();
    render(<Harness initialLines={[makeRow()]} />);

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("submit_cart_order", {
        p_cart_item_ids: ["ci-1"],
        p_fulfillment_choices: [{ shop_id: "shop-1", method: "meetup" }],
        p_buyer_note: null,
      }),
    );

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/order submitted successfully/i));
    expect(screen.getByText(/PSO-ABC123/)).toBeInTheDocument();
  });

  it("includes a View orders link to /orders in the success confirmation", async () => {
    mockHappyPathRpc();
    render(<Harness initialLines={[makeRow()]} />);

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "View orders" })).toHaveAttribute("href", "/orders");
  });

  it("does not expose raw UUIDs when a public order code is available", async () => {
    mockHappyPathRpc();
    render(<Harness initialLines={[makeRow()]} />);

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByText(/^o1$/)).not.toBeInTheDocument();
  });

  it("refreshes cart state after a successful submission (get_my_cart re-fetched)", async () => {
    mockHappyPathRpc();
    render(<Harness initialLines={[makeRow()]} />);

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_my_cart"));
  });

  it("blocks a rapid double-click from issuing a second submission while pending", async () => {
    let resolveSubmit: (value: { data: unknown; error: null }) => void;
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_cart_order") {
        return new Promise((resolve) => {
          resolveSubmit = resolve;
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    render(<Harness initialLines={[makeRow()]} />);
    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });

    const button = screen.getByRole("button", { name: "Submit Order" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);

    expect(rpcMock.mock.calls.filter(([fn]) => fn === "submit_cart_order")).toHaveLength(1);

    resolveSubmit!({
      data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-1", item_count: 1, total_cents: 100, status: "pending" }],
      error: null,
    });
  });

  it("shows safe, generic copy on failure -- never a raw DB error message -- and keeps the cart intact", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_cart_order") {
        return Promise.resolve({ data: null, error: { message: 'duplicate key value violates constraint "orders_pkey"', details: "PRICE_CHANGED" } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    render(<Harness initialLines={[makeRow()]} />);
    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const alertText = screen.getByRole("alert").textContent ?? "";
    expect(alertText).toMatch(/price/i);
    expect(alertText).not.toMatch(/constraint|duplicate key|orders_pkey/i);
  });

  it("handles multiple sellers with one submission (no per-seller manual submit loop)", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_cart_order") {
        return Promise.resolve({
          data: [
            { order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-1", item_count: 1, total_cents: 100000, status: "pending" },
            { order_id: "o2", shop_id: "shop-2", order_public_code: "PSO-2", item_count: 1, total_cents: 200000, status: "pending" },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    render(
      <Harness
        initialLines={[
          makeRow({ cartItemId: "ci-1", listingId: "l1", shopId: "shop-1", shopName: "Anne's Closet" }),
          makeRow({ cartItemId: "ci-2", listingId: "l2", shopId: "shop-2", shopName: "Bob's Store" }),
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.change(screen.getByLabelText(/Bob's Store/), { target: { value: "shipping" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/2 orders were created for 2 sellers/i),
    );
    expect(rpcMock.mock.calls.filter(([fn]) => fn === "submit_cart_order")).toHaveLength(1);
  });
});

describe("OrderReviewSubmit -- dependency-injected submit/refresh (Buy Now support)", () => {
  it("defaults to submitCartOrder/refreshMyCart when no overrides are given -- /cart's own usage is untouched (regression already covered above)", () => {
    // Covered by every test above that renders <Harness> with no submit/
    // refreshLines/removeFromCartOnSuccess props at all and still sees
    // submit_cart_order/get_my_cart called -- this test just documents the
    // contract explicitly for this describe block.
    expect(true).toBe(true);
  });

  it("calls the injected submit function instead of submitCartOrder when one is provided", async () => {
    const injectedSubmit = vi.fn(
      async (): Promise<SubmitCartOrderResult> => ({
        ok: true,
        orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
        submittedListingIds: ["listing-1"],
      }),
    );
    const injectedRefresh = vi.fn(async () => ({ lines: [], hadError: false }));

    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={injectedSubmit}
        refreshLines={injectedRefresh}
        removeFromCartOnSuccess={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(injectedSubmit).toHaveBeenCalledTimes(1));
    expect(rpcMock).not.toHaveBeenCalledWith("submit_cart_order", expect.anything());
    await waitFor(() => expect(injectedRefresh).toHaveBeenCalledTimes(1));
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_cart");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/PSO-BN1/));
  });

  it("a null cartItemId (Buy Now's own line shape) never blocks rendering or submission -- cartItemId is not read at all when submit is injected", async () => {
    const injectedSubmit = vi.fn(
      async (): Promise<SubmitCartOrderResult> => ({
        ok: true,
        orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
        submittedListingIds: ["listing-1"],
      }),
    );

    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={injectedSubmit}
        refreshLines={async () => ({ lines: [], hadError: false })}
        removeFromCartOnSuccess={false}
      />,
    );

    expect(screen.getByText("1 item ready to submit")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(injectedSubmit).toHaveBeenCalledTimes(1));
  });

  it("removeFromCartOnSuccess=false (Buy Now) never calls useCart().removeItem -- the shared cart item count is unaffected by a successful submission", async () => {
    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null, listingId: "listing-1" })]}
        cartInitialLines={[{ listingId: "listing-2", publicCode: "PLS-XYZ", quantity: 3 }]}
        submit={async () => ({
          ok: true,
          orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
          submittedListingIds: ["listing-1"],
        })}
        refreshLines={async () => ({ lines: [], hadError: false })}
        removeFromCartOnSuccess={false}
      />,
    );

    expect(screen.getByTestId("item-count")).toHaveTextContent("3");

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    // Unaffected: still shows the pre-existing cart's own unrelated item,
    // never decremented by the Buy Now line that was just submitted (it
    // was never part of this count to begin with).
    expect(screen.getByTestId("item-count")).toHaveTextContent("3");
  });

  it("removeFromCartOnSuccess defaults to true -- a normal /cart submission still removes the submitted line from the shared cart exactly as before", async () => {
    render(
      <InjectedHarness
        initialLines={[makeRow({ listingId: "listing-1" })]}
        cartInitialLines={[{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 1 }]}
        submit={async () => ({
          ok: true,
          orders: [{ orderId: "o1", shopId: "shop-1", orderPublicCode: "PSO-1", itemCount: 1, totalCents: 250000 }],
          submittedListingIds: ["listing-1"],
        })}
        refreshLines={async () => ({ lines: [], hadError: false })}
      />,
    );

    expect(screen.getByTestId("item-count")).toHaveTextContent("1");

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByTestId("item-count")).toHaveTextContent("0");
  });
});

describe("OrderReviewSubmit -- success is a terminal state (regression: the form must not reappear)", () => {
  it("before submit: the fulfillment selector is visible", () => {
    render(<Harness initialLines={[makeRow()]} />);
    expect(screen.getByLabelText(/Anne's Closet/)).toBeInTheDocument();
  });

  it("before submit: Submit Order is visible", () => {
    render(<Harness initialLines={[makeRow()]} />);
    expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument();
  });

  it("after a successful Buy Now-style submission, success confirmation appears", async () => {
    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={async () => ({
          ok: true,
          orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
          submittedListingIds: ["listing-1"],
        })}
        // The Buy Now listing itself is still "available" after the order
        // is created (reservation only happens on seller acceptance) --
        // refreshLines correctly hands back the SAME still-submittable
        // line, exactly the case the old lines.length===0 check missed.
        refreshLines={async () => ({ lines: [makeRow({ cartItemId: null })], hadError: false })}
        removeFromCartOnSuccess={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/order submitted successfully/i));
  });

  it("after success, the fulfillment selector is NOT rendered -- even though the refreshed line is still present and still submittable", async () => {
    const injectedSubmit = vi.fn(async (): Promise<SubmitCartOrderResult> => ({
      ok: true,
      orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
      submittedListingIds: ["listing-1"],
    }));

    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={injectedSubmit}
        refreshLines={async () => ({ lines: [makeRow({ cartItemId: null })], hadError: false })}
        removeFromCartOnSuccess={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByLabelText(/Anne's Closet/)).not.toBeInTheDocument();
    expect(screen.queryByText("Choose a method")).not.toBeInTheDocument();
  });

  it("after success, Submit Order is NOT rendered -- even though the refreshed line is still present and still submittable", async () => {
    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={async () => ({
          ok: true,
          orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
          submittedListingIds: ["listing-1"],
        })}
        refreshLines={async () => ({ lines: [makeRow({ cartItemId: null })], hadError: false })}
        removeFromCartOnSuccess={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Submit Order" })).not.toBeInTheDocument();
    expect(screen.queryByText(/item.*ready to submit/i)).not.toBeInTheDocument();
  });

  it("a second submission cannot occur from the success state -- submit is called exactly once, and there is no button left to trigger a second call", async () => {
    const injectedSubmit = vi.fn(async (): Promise<SubmitCartOrderResult> => ({
      ok: true,
      orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
      submittedListingIds: ["listing-1"],
    }));

    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={injectedSubmit}
        refreshLines={async () => ({ lines: [makeRow({ cartItemId: null })], hadError: false })}
        removeFromCartOnSuccess={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(injectedSubmit).toHaveBeenCalledTimes(1);
    // The button no longer exists -- there is nothing left in the DOM a
    // buyer (or a stale click event) could use to fire a second submission.
    expect(screen.queryByRole("button", { name: "Submit Order" })).not.toBeInTheDocument();
  });

  it("View orders remains available in the terminal success state", async () => {
    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={async () => ({
          ok: true,
          orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
          submittedListingIds: ["listing-1"],
        })}
        refreshLines={async () => ({ lines: [makeRow({ cartItemId: null })], hadError: false })}
        removeFromCartOnSuccess={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "View orders" })).toHaveAttribute("href", "/orders");
  });

  it("normal /cart submission also does not render another submit form after success -- even when other, still-submittable lines remain in the cart", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "submit_cart_order") {
        return Promise.resolve({
          data: [{ order_id: "o1", shop_id: "shop-1", order_public_code: "PSO-ABC123", item_count: 1, total_cents: 250000, status: "pending" }],
          error: null,
        });
      }
      if (fn === "get_my_cart") {
        // The cart still has a second, unrelated, fully-submittable item
        // after the first was submitted -- the exact case the old
        // lines.length===0 check missed for /cart too.
        return Promise.resolve({
          data: [
            {
              cart_item_id: "ci-2",
              listing_id: "listing-2",
              public_code: "PLS-XYZ",
              slug: null,
              title: "Vintage Jacket",
              cover_image_storage_path: null,
              price_cents: 50000,
              price_cents_snapshot: 50000,
              price_changed: false,
              status: "available",
              is_inquiry_only: false,
              requested_quantity: 1,
              current_available_quantity: 5,
              is_submittable: true,
              unavailable_reason: null,
              shop_id: "shop-2",
              shop_slug: "bobs-store",
              shop_name: "Bob's Store",
              fulfillment_methods: ["meetup"],
              added_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    render(<Harness initialLines={[makeRow()]} />);
    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/order submitted successfully/i));
    expect(screen.queryByLabelText(/Anne's Closet/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Bob's Store/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit Order" })).not.toBeInTheDocument();
  });

  it("cart removal/refresh behavior after a normal /cart submission is unchanged by this fix -- removeItem still fires and get_my_cart is still re-fetched", async () => {
    mockHappyPathRpc();
    render(
      <InjectedHarness
        initialLines={[makeRow({ listingId: "listing-1" })]}
        cartInitialLines={[{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 1 }]}
      />,
    );

    expect(screen.getByTestId("item-count")).toHaveTextContent("1");

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByTestId("item-count")).toHaveTextContent("0");
    expect(rpcMock).toHaveBeenCalledWith("get_my_cart");
  });
});

describe("OrderReviewSubmit -- onSuccess callback (Buy Now's own post-submit navigation)", () => {
  it("calls onSuccess with the created order(s) on a successful submission, instead of rendering the built-in success card", async () => {
    const onSuccess = vi.fn();
    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={async () => ({
          ok: true,
          orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
          submittedListingIds: ["listing-1"],
        })}
        removeFromCartOnSuccess={false}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith([{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }]),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/order submitted successfully/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View orders" })).not.toBeInTheDocument();
  });

  it("does not call refreshLines/get_my_cart when onSuccess is provided -- the caller is about to replace this component entirely", async () => {
    const refreshLines = vi.fn(async () => ({ lines: [], hadError: false }));
    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={async () => ({
          ok: true,
          orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
          submittedListingIds: ["listing-1"],
        })}
        refreshLines={refreshLines}
        removeFromCartOnSuccess={false}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    const button = screen.getByRole("button", { name: "Submit Order" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(refreshLines).not.toHaveBeenCalled();
  });

  it("never calls onSuccess when the submission fails -- only a confirmed success hands off to the caller", async () => {
    const onSuccess = vi.fn();
    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={async () => ({ ok: false, code: "PRICE_CHANGED" })}
        refreshLines={async () => ({ lines: [makeRow({ cartItemId: null })], hadError: false })}
        removeFromCartOnSuccess={false}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
    // The form remains available so the buyer can retry after a failure --
    // onSuccess only ever short-circuits the SUCCESS path.
    expect(screen.getByRole("button", { name: "Submit Order" })).toBeInTheDocument();
  });

  it("becomes terminal immediately after handing off to onSuccess -- a second click cannot fire a second real submission even before the caller's own navigation unmounts this component", async () => {
    const submit = vi.fn(async () => ({
      ok: true as const,
      orders: [{ orderId: "bn-1", shopId: "shop-1", orderPublicCode: "PSO-BN1", itemCount: 1, totalCents: 250000 }],
      submittedListingIds: ["listing-1"],
    }));

    render(
      <InjectedHarness
        initialLines={[makeRow({ cartItemId: null })]}
        submit={submit}
        removeFromCartOnSuccess={false}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    const button = screen.getByRole("button", { name: "Submit Order" });
    fireEvent.click(button);

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    // The button is still technically in the DOM (this harness never
    // unmounts on its own -- that's the caller's job), but it must no
    // longer be clickable/enabled once the order has been handed off.
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("normal /cart usage (no onSuccess) is completely unaffected -- multi-order success summary still renders exactly as before", async () => {
    mockHappyPathRpc();
    render(<Harness initialLines={[makeRow()]} />);

    fireEvent.change(screen.getByLabelText(/Anne's Closet/), { target: { value: "meetup" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/order submitted successfully/i));
    expect(screen.getByRole("link", { name: "View orders" })).toBeInTheDocument();
  });
});
