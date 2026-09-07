import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { SellerOrderDetail } from "@/lib/seller/get-my-shop-order-detail";

const { refreshMock, acceptOrderItemsMock, markOrderReadyMock, markOrderHandedOverOrShippedMock, cancelAcceptedOrderMock, resolveOrderCancellationMock } =
  vi.hoisted(() => ({
    refreshMock: vi.fn(),
    acceptOrderItemsMock: vi.fn(),
    markOrderReadyMock: vi.fn(),
    markOrderHandedOverOrShippedMock: vi.fn(),
    cancelAcceptedOrderMock: vi.fn(),
    resolveOrderCancellationMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/seller/seller-order-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/seller-order-actions")>("@/lib/seller/seller-order-actions");
  return {
    ...actual,
    acceptOrderItems: acceptOrderItemsMock,
    markOrderReady: markOrderReadyMock,
    markOrderHandedOverOrShipped: markOrderHandedOverOrShippedMock,
    cancelAcceptedOrder: cancelAcceptedOrderMock,
    resolveOrderCancellation: resolveOrderCancellationMock,
  };
});

import { SellerOrderDetailClient } from "@/components/seller/SellerOrderDetailClient";

function sampleOrder(overrides: Partial<SellerOrderDetail> = {}): SellerOrderDetail {
  return {
    orderId: "order-1",
    orderPublicCode: "PSO-ABC12345",
    buyerDisplayName: "Jane D.",
    status: "pending",
    fulfillmentMethod: "meetup",
    buyerNote: null,
    createdAt: "2026-01-05T00:00:00.000Z",
    pendingCancellationRequestId: null,
    pendingCancellationReason: null,
    items: [
      { orderItemId: "item-1", listingId: "listing-1", listingPublicCode: "PLS-A", title: "Item A", imageUrl: undefined, quantity: 1, priceCentsSnapshot: 10000, status: "pending" },
      { orderItemId: "item-2", listingId: "listing-2", listingPublicCode: "PLS-B", title: "Item B", imageUrl: undefined, quantity: 3, priceCentsSnapshot: 20000, status: "pending" },
    ],
    totalCents: 70000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SellerOrderDetailClient -- pending order item acceptance", () => {
  it("renders one checkbox per pending item, checked (accept) by default, and no quantity input anywhere", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    for (const box of checkboxes) expect(box).toBeChecked();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("labels 'Accept order' when every pending item is checked, and calls accept_order_items with all items accepted, none declined", async () => {
    acceptOrderItemsMock.mockResolvedValue({ ok: true, orderStatus: "accepted", wasAlreadyProcessed: false, acceptedItemIds: ["item-1", "item-2"], declinedItemIds: [], stockConflictItemIds: [] });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept order" }));

    await waitFor(() => expect(acceptOrderItemsMock).toHaveBeenCalledWith("order-1", ["item-1", "item-2"], []));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("supports whole-row partial acceptance: unchecking one item declines only that row, never a partial quantity", async () => {
    acceptOrderItemsMock.mockResolvedValue({ ok: true, orderStatus: "changes_pending", wasAlreadyProcessed: false, acceptedItemIds: ["item-1"], declinedItemIds: ["item-2"], stockConflictItemIds: [] });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /accept item b/i }));
    expect(screen.getByRole("button", { name: "Save decisions" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save decisions" }));

    await waitFor(() => expect(acceptOrderItemsMock).toHaveBeenCalledWith("order-1", ["item-1"], ["item-2"]));
  });

  it("requires an explicit confirmation step before declining the whole order", async () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Decline order" }));
    expect(acceptOrderItemsMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    acceptOrderItemsMock.mockResolvedValue({ ok: true, orderStatus: "declined", wasAlreadyProcessed: false, acceptedItemIds: [], declinedItemIds: ["item-1", "item-2"], stockConflictItemIds: [] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline order" }));

    await waitFor(() => expect(acceptOrderItemsMock).toHaveBeenCalledWith("order-1", [], ["item-1", "item-2"]));
  });

  it("only ever sends order-item ids already present on this order's own item list, never an arbitrary id", async () => {
    acceptOrderItemsMock.mockResolvedValue({ ok: true, orderStatus: "accepted", wasAlreadyProcessed: false, acceptedItemIds: ["item-1", "item-2"], declinedItemIds: [], stockConflictItemIds: [] });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept order" }));
    await waitFor(() => expect(acceptOrderItemsMock).toHaveBeenCalled());
    const [, acceptedIds, declinedIds] = acceptOrderItemsMock.mock.calls[0];
    for (const id of [...acceptedIds, ...declinedIds]) {
      expect(["item-1", "item-2"]).toContain(id);
    }
  });

  it("shows a safe error message and does not crash when accept_order_items fails", async () => {
    acceptOrderItemsMock.mockResolvedValue({ ok: false, code: "ITEM_ALREADY_DECIDED" });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept order" }));
    await waitFor(() => expect(screen.getByText(/already been updated/i)).toBeInTheDocument());
  });
});

describe("SellerOrderDetailClient -- accepted/ready lifecycle", () => {
  it("shows Mark ready and Cancel order for an accepted order with no pending cancellation request", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "accepted", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("calls mark_order_ready with only the order id and refreshes on success", async () => {
    markOrderReadyMock.mockResolvedValue({ ok: true, orderStatus: "ready", wasAlreadyReady: false });
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "accepted", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(markOrderReadyMock).toHaveBeenCalledWith("order-1"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows Mark shipped (not Mark handed over) for a ready order with shipping fulfillment", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "ready", fulfillmentMethod: "shipping", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    expect(screen.getByRole("button", { name: "Mark shipped" })).toBeInTheDocument();
  });

  it("requires a reason before allowing seller cancellation to be confirmed", async () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "accepted", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Cancel order" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for cancellation"), { target: { value: "Out of stock" } });
    expect(confirmButton).toBeEnabled();

    cancelAcceptedOrderMock.mockResolvedValue({ ok: true, orderStatus: "cancelled", wasAlreadyCancelled: false });
    fireEvent.click(confirmButton);
    await waitFor(() => expect(cancelAcceptedOrderMock).toHaveBeenCalledWith("order-1", "Out of stock"));
  });

  it("hides mark_ready/mark_handed_over_or_shipped and shows resolve-cancellation actions when a cancellation request is pending", () => {
    render(
      <SellerOrderDetailClient
        initialOrder={sampleOrder({
          status: "accepted",
          items: [{ ...sampleOrder().items[0], status: "accepted" }],
          pendingCancellationRequestId: "req-1",
          pendingCancellationReason: "Changed my mind",
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Mark ready" })).not.toBeInTheDocument();
    expect(screen.getByText(/changed my mind/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve cancellation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject request" })).toBeInTheDocument();
    // cancel_accepted has no such freeze -- it remains available either way.
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
  });

  it("requires a review note before a rejection can be confirmed, and sends only request id + confirm + note", async () => {
    resolveOrderCancellationMock.mockResolvedValue({ ok: true, requestStatus: "rejected", orderStatus: "accepted", wasAlreadyResolved: false });
    render(
      <SellerOrderDetailClient
        initialOrder={sampleOrder({
          status: "accepted",
          items: [{ ...sampleOrder().items[0], status: "accepted" }],
          pendingCancellationRequestId: "req-1",
          pendingCancellationReason: "Changed my mind",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Reject request" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "Already packed for shipping." } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(resolveOrderCancellationMock).toHaveBeenCalledWith("req-1", false, "Already packed for shipping."));
  });

  it("hides every lifecycle action for a status with no seller action (handed_over_or_shipped)", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "handed_over_or_shipped", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
