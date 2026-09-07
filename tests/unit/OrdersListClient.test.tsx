import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrdersListClient } from "@/components/orders/OrdersListClient";
import type { OrderSummary } from "@/lib/orders/get-my-orders";

function makeOrder(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    orderId: "order-1",
    orderPublicCode: "PSO-ABC12345",
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    status: "pending",
    fulfillmentMethod: "meetup",
    createdAt: "2026-01-05T00:00:00.000Z",
    itemCount: 2,
    totalCents: 90000,
    ...overrides,
  };
}

describe("OrdersListClient pagination", () => {
  it("shows a Load more button only when a cursor exists", () => {
    render(
      <OrdersListClient
        initialOrders={[makeOrder()]}
        initialHadError={false}
        initialCursor={null}
        loadMore={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("appends the next page and advances the cursor on Load more, never using OFFSET-style params", async () => {
    const loadMore = vi.fn().mockResolvedValue({
      orders: [makeOrder({ orderId: "order-2", orderPublicCode: "PSO-SECOND" })],
      hadError: false,
      nextCursor: null,
    });

    render(
      <OrdersListClient
        initialOrders={[makeOrder({ orderId: "order-1", orderPublicCode: "PSO-FIRST" })]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-05T00:00:00.000Z", id: "order-1" }}
        loadMore={loadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getByText("PSO-SECOND")).toBeInTheDocument());
    expect(loadMore).toHaveBeenCalledWith({ createdAt: "2026-01-05T00:00:00.000Z", id: "order-1" });
    // Cursor exhausted -- Load more disappears rather than looping.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows a safe error message when loading more fails, keeping already-loaded orders", async () => {
    const loadMore = vi.fn().mockResolvedValue({ orders: [], hadError: true, nextCursor: null });

    render(
      <OrdersListClient
        initialOrders={[makeOrder({ orderPublicCode: "PSO-FIRST" })]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-05T00:00:00.000Z", id: "order-1" }}
        loadMore={loadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getByText(/unable to load more orders/i)).toBeInTheDocument());
    expect(screen.getByText("PSO-FIRST")).toBeInTheDocument();
  });
});
