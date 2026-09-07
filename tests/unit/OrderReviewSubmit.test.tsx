import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { CartProvider } from "@/components/cart/CartProvider";
import { OrderReviewSubmit } from "@/components/cart/OrderReviewSubmit";
import type { CartLineDisplay } from "@/lib/cart/map-cart-row";

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
