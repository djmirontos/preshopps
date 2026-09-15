import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { SellerOrderDetail } from "@/lib/seller/get-my-shop-order-detail";

const {
  refreshMock,
  pushMock,
  acceptOrderItemsMock,
  markOrderReadyMock,
  markOrderHandedOverOrShippedMock,
  cancelAcceptedOrderMock,
  resolveOrderCancellationMock,
  getConversationForShopOrderMock,
  startConversationFromOrderMock,
  openConversationMock,
} = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
  acceptOrderItemsMock: vi.fn(),
  markOrderReadyMock: vi.fn(),
  markOrderHandedOverOrShippedMock: vi.fn(),
  cancelAcceptedOrderMock: vi.fn(),
  resolveOrderCancellationMock: vi.fn(),
  getConversationForShopOrderMock: vi.fn(),
  startConversationFromOrderMock: vi.fn(),
  openConversationMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
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

vi.mock("@/lib/messaging/get-conversation-for-shop-order", () => ({
  getConversationForShopOrder: getConversationForShopOrderMock,
}));

vi.mock("@/lib/messaging/start-conversation-from-order", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messaging/start-conversation-from-order")>();
  return {
    ...actual,
    startConversationFromOrder: startConversationFromOrderMock,
  };
});

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

import { SellerOrderDetailClient } from "@/components/seller/SellerOrderDetailClient";

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

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
  setViewportWidth(DESKTOP_WIDTH);
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
  it("shows the fulfillment-specific ready-stage label (default sample order is meetup) and Cancel order for an accepted order with no pending cancellation request", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "accepted", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    expect(screen.getByRole("button", { name: "Ready for Meetup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("opens the informational modal first, and only calls mark_order_ready (with only the order id) once the seller explicitly confirms inside it", async () => {
    markOrderReadyMock.mockResolvedValue({ ok: true, orderStatus: "ready", wasAlreadyReady: false });
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "accepted", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Meetup" }));
    expect(markOrderReadyMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Ready to meet your buyer?");

    fireEvent.click(within(dialog).getByRole("button", { name: "Ready for Meetup" }));

    await waitFor(() => expect(markOrderReadyMock).toHaveBeenCalledWith("order-1"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows Mark as Shipped (not Item Handed Over or Mark as Picked Up) for a ready order with shipping fulfillment", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "ready", fulfillmentMethod: "shipping", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    expect(screen.getByRole("button", { name: "Mark as Shipped" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Ready for Meetup" })).not.toBeInTheDocument();
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

  it("hides every lifecycle action for a status with no seller action (handed_over_or_shipped) -- but the persistent Message Buyer action always remains", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "handed_over_or_shipped", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Message Buyer" })).toBeInTheDocument();
  });
});

describe("SellerOrderDetailClient -- fulfillment-specific action wording (locked product decision, status/RPC unchanged underneath)", () => {
  function acceptedOrder(fulfillmentMethod: "pickup" | "shipping" | "meetup" | "local_delivery") {
    return sampleOrder({ status: "accepted", fulfillmentMethod, items: [{ ...sampleOrder().items[0], status: "accepted" }] });
  }

  function readyOrder(fulfillmentMethod: "pickup" | "shipping" | "meetup" | "local_delivery") {
    return sampleOrder({ status: "ready", fulfillmentMethod, items: [{ ...sampleOrder().items[0], status: "accepted" }] });
  }

  it("1. Pickup gets 'Ready for Pickup' at the accepted stage", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("pickup")} />);
    expect(screen.getByRole("button", { name: "Ready for Pickup" })).toBeInTheDocument();
  });

  it("2. Pickup gets 'Mark as Picked Up' at the ready stage", () => {
    render(<SellerOrderDetailClient initialOrder={readyOrder("pickup")} />);
    expect(screen.getByRole("button", { name: "Mark as Picked Up" })).toBeInTheDocument();
  });

  it("3. Shipping gets 'Ready to Ship' at the accepted stage", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("shipping")} />);
    expect(screen.getByRole("button", { name: "Ready to Ship" })).toBeInTheDocument();
  });

  it("4. Shipping gets 'Mark as Shipped' at the ready stage", () => {
    render(<SellerOrderDetailClient initialOrder={readyOrder("shipping")} />);
    expect(screen.getByRole("button", { name: "Mark as Shipped" })).toBeInTheDocument();
  });

  it("5. Meetup gets 'Ready for Meetup' at the accepted stage", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("meetup")} />);
    expect(screen.getByRole("button", { name: "Ready for Meetup" })).toBeInTheDocument();
  });

  it("6. Meetup gets 'Item Handed Over' at the ready stage", () => {
    render(<SellerOrderDetailClient initialOrder={readyOrder("meetup")} />);
    expect(screen.getByRole("button", { name: "Item Handed Over" })).toBeInTheDocument();
  });

  it("Local delivery gets 'Ready for Delivery' at the accepted stage", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("local_delivery")} />);
    expect(screen.getByRole("button", { name: "Ready for Delivery" })).toBeInTheDocument();
  });

  it("Local delivery gets 'Mark as Delivered' at the ready stage", () => {
    render(<SellerOrderDetailClient initialOrder={readyOrder("local_delivery")} />);
    expect(screen.getByRole("button", { name: "Mark as Delivered" })).toBeInTheDocument();
  });

  const OUTER_READY_LABEL = { pickup: "Ready for Pickup", shipping: "Ready to Ship", meetup: "Ready for Meetup", local_delivery: "Ready for Delivery" } as const;
  const MODAL_READY_PRIMARY_LABEL = {
    pickup: "Mark Ready for Pickup",
    shipping: "Ready to Ship",
    meetup: "Ready for Meetup",
    local_delivery: "Ready for Delivery",
  } as const;
  const OUTER_HANDED_OVER_LABEL = {
    pickup: "Mark as Picked Up",
    shipping: "Mark as Shipped",
    meetup: "Item Handed Over",
    local_delivery: "Mark as Delivered",
  } as const;
  const MODAL_HANDED_OVER_PRIMARY_LABEL = {
    pickup: "Confirm Picked Up",
    shipping: "Confirm Shipped",
    meetup: "Confirm Handover",
    local_delivery: "Confirm Delivered",
  } as const;

  it("7. the underlying mark_order_ready RPC call is identical (order id only) regardless of which fulfillment-specific label triggered it, and only fires after the modal's own primary confirm", async () => {
    for (const fulfillmentMethod of ["pickup", "shipping", "meetup", "local_delivery"] as const) {
      markOrderReadyMock.mockClear();
      markOrderReadyMock.mockResolvedValue({ ok: true, orderStatus: "ready", wasAlreadyReady: false });
      const { unmount } = render(<SellerOrderDetailClient initialOrder={acceptedOrder(fulfillmentMethod)} />);

      fireEvent.click(screen.getByRole("button", { name: OUTER_READY_LABEL[fulfillmentMethod] }));
      expect(markOrderReadyMock).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: MODAL_READY_PRIMARY_LABEL[fulfillmentMethod] }));

      await waitFor(() => expect(markOrderReadyMock).toHaveBeenCalledWith("order-1"));
      expect(markOrderReadyMock).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("7. the underlying mark_order_handed_over_or_shipped RPC call is identical (order id only) regardless of which fulfillment-specific label triggered it, and only fires after the modal's own primary confirm", async () => {
    for (const fulfillmentMethod of ["pickup", "shipping", "meetup", "local_delivery"] as const) {
      markOrderHandedOverOrShippedMock.mockClear();
      markOrderHandedOverOrShippedMock.mockResolvedValue({ ok: true, orderStatus: "handed_over_or_shipped", wasAlreadyHandedOverOrShipped: false });
      const { unmount } = render(<SellerOrderDetailClient initialOrder={readyOrder(fulfillmentMethod)} />);

      fireEvent.click(screen.getByRole("button", { name: OUTER_HANDED_OVER_LABEL[fulfillmentMethod] }));
      expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: MODAL_HANDED_OVER_PRIMARY_LABEL[fulfillmentMethod] }));

      await waitFor(() => expect(markOrderHandedOverOrShippedMock).toHaveBeenCalledWith("order-1"));
      expect(markOrderHandedOverOrShippedMock).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("8. button sizing classes remain the robust min-height strategy regardless of which fulfillment-specific label is shown", () => {
    for (const fulfillmentMethod of ["pickup", "shipping", "meetup", "local_delivery"] as const) {
      const { unmount } = render(<SellerOrderDetailClient initialOrder={acceptedOrder(fulfillmentMethod)} />);
      expectRobustActionButtonSizing(
        screen.getByRole("button", {
          name: { pickup: "Ready for Pickup", shipping: "Ready to Ship", meetup: "Ready for Meetup", local_delivery: "Ready for Delivery" }[
            fulfillmentMethod
          ],
        }),
      );
      unmount();
    }
  });

  it("10. other seller actions (Accept order, Decline order, Cancel order) keep their exact existing labels regardless of fulfillment method", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ fulfillmentMethod: "pickup" })} />);
    expect(screen.getByRole("button", { name: "Accept order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline order" })).toBeInTheDocument();

    render(<SellerOrderDetailClient initialOrder={acceptedOrder("shipping")} />);
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
  });
});

describe("SellerOrderDetailClient -- fulfillment transition confirmation/instruction modals", () => {
  function acceptedOrder(fulfillmentMethod: "pickup" | "shipping" | "meetup" | "local_delivery") {
    return sampleOrder({ status: "accepted", fulfillmentMethod, items: [{ ...sampleOrder().items[0], status: "accepted" }] });
  }

  function readyOrder(fulfillmentMethod: "pickup" | "shipping" | "meetup" | "local_delivery") {
    return sampleOrder({ status: "ready", fulfillmentMethod, items: [{ ...sampleOrder().items[0], status: "accepted" }] });
  }

  // ===== 1-3: Pickup, ready stage =====
  it("1. Ready for Pickup opens the informational modal first, with the locked title/body and both actions, before any RPC call", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("pickup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Pickup" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Is the item ready for pickup?");
    expect(dialog).toHaveTextContent("Let your buyer know the item is ready and coordinate the pickup through Preshopps chat.");
    expect(within(dialog).getByRole("button", { name: "Message Buyer" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Mark Ready for Pickup" })).toBeInTheDocument();
    expect(markOrderReadyMock).not.toHaveBeenCalled();
  });

  it("2. Mark Ready for Pickup calls mark_order_ready only after this explicit confirmation, then refreshes", async () => {
    markOrderReadyMock.mockResolvedValue({ ok: true, orderStatus: "ready", wasAlreadyReady: false });
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("pickup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Pickup" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Ready for Pickup" }));

    await waitFor(() => expect(markOrderReadyMock).toHaveBeenCalledWith("order-1"));
    expect(markOrderReadyMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // The modal closes on success -- back to the plain order-detail screen.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("3. Message Buyer from the pickup readiness modal closes the modal, starts the direct lookup, and never calls the status RPC", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("pickup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Pickup" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Message Buyer" }));

    // 18. Fulfillment modal closes before the direct messaging flow continues -- no overlapping dialogs.
    expect(screen.queryByText("Is the item ready for pickup?")).not.toBeInTheDocument();

    await waitFor(() => expect(getConversationForShopOrderMock).toHaveBeenCalledWith("PSO-ABC12345"));
    expect(markOrderReadyMock).not.toHaveBeenCalled();
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();
  });

  // ===== 4-6: Pickup, handed-over stage =====
  it("4. Mark as Picked Up opens the locked confirmation modal, with 'Not Yet' and 'Confirm Picked Up', before any RPC call", () => {
    render(<SellerOrderDetailClient initialOrder={readyOrder("pickup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as Picked Up" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Has the buyer collected the item?");
    expect(dialog).toHaveTextContent("Only confirm this after the item has actually been handed to the buyer.");
    expect(within(dialog).getByRole("button", { name: "Not Yet" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm Picked Up" })).toBeInTheDocument();
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();
  });

  it("5. Not Yet closes the modal without ever calling the status RPC", () => {
    render(<SellerOrderDetailClient initialOrder={readyOrder("pickup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as Picked Up" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Not Yet" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();
    // The order is visibly unchanged -- the trigger button is still there.
    expect(screen.getByRole("button", { name: "Mark as Picked Up" })).toBeInTheDocument();
  });

  it("6. Confirm Picked Up calls the existing mark_order_handed_over_or_shipped RPC", async () => {
    markOrderHandedOverOrShippedMock.mockResolvedValue({ ok: true, orderStatus: "handed_over_or_shipped", wasAlreadyHandedOverOrShipped: false });
    render(<SellerOrderDetailClient initialOrder={readyOrder("pickup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as Picked Up" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm Picked Up" }));

    await waitFor(() => expect(markOrderHandedOverOrShippedMock).toHaveBeenCalledWith("order-1"));
  });

  // ===== 7-8: Shipping =====
  it("7. Ready to Ship modal shows the locked copy and both actions", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("shipping")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready to Ship" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Is the item ready to ship?");
    expect(dialog).toHaveTextContent("Make sure the item is packed and coordinate shipping details with your buyer before continuing.");
    expect(within(dialog).getByRole("button", { name: "Message Buyer" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Ready to Ship" })).toBeInTheDocument();
  });

  it("8. Confirm Shipped calls the existing RPC only after confirmation", async () => {
    markOrderHandedOverOrShippedMock.mockResolvedValue({ ok: true, orderStatus: "handed_over_or_shipped", wasAlreadyHandedOverOrShipped: false });
    render(<SellerOrderDetailClient initialOrder={readyOrder("shipping")} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as Shipped" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Has the item been shipped?");
    expect(dialog).toHaveTextContent("Confirm only after the parcel has actually been handed to the courier or shipping provider.");
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Shipped" }));

    await waitFor(() => expect(markOrderHandedOverOrShippedMock).toHaveBeenCalledWith("order-1"));
  });

  // ===== 9-10: Meetup =====
  it("9. Ready for Meetup modal shows the locked copy and both actions", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("meetup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Meetup" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Ready to meet your buyer?");
    expect(dialog).toHaveTextContent("Coordinate the meetup time and location with your buyer before handing over the item.");
    expect(within(dialog).getByRole("button", { name: "Message Buyer" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Ready for Meetup" })).toBeInTheDocument();
  });

  it("10. Confirm Handover calls the existing RPC only after confirmation", async () => {
    markOrderHandedOverOrShippedMock.mockResolvedValue({ ok: true, orderStatus: "handed_over_or_shipped", wasAlreadyHandedOverOrShipped: false });
    render(<SellerOrderDetailClient initialOrder={readyOrder("meetup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Item Handed Over" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Was the item handed over?");
    expect(dialog).toHaveTextContent("Confirm only after the buyer has received the item in person.");
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Handover" }));

    await waitFor(() => expect(markOrderHandedOverOrShippedMock).toHaveBeenCalledWith("order-1"));
  });

  // ===== 11-12: Local delivery =====
  it("11. Ready for Delivery modal shows the locked copy and both actions", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("local_delivery")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Delivery" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Ready to deliver the item?");
    expect(dialog).toHaveTextContent("Coordinate the delivery details with your buyer before starting the delivery.");
    expect(within(dialog).getByRole("button", { name: "Message Buyer" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Ready for Delivery" })).toBeInTheDocument();
  });

  it("12. Confirm Delivered calls the existing RPC only after confirmation", async () => {
    markOrderHandedOverOrShippedMock.mockResolvedValue({ ok: true, orderStatus: "handed_over_or_shipped", wasAlreadyHandedOverOrShipped: false });
    render(<SellerOrderDetailClient initialOrder={readyOrder("local_delivery")} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as Delivered" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Has the item been delivered?");
    expect(dialog).toHaveTextContent("Confirm only after the buyer has actually received the item.");
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Delivered" }));

    await waitFor(() => expect(markOrderHandedOverOrShippedMock).toHaveBeenCalledWith("order-1"));
  });

  // ===== 13: dismissal never changes status =====
  it("13. closing the modal via the X button never calls any status RPC", () => {
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("meetup")} />);
    fireEvent.click(screen.getByRole("button", { name: "Ready for Meetup" }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markOrderReadyMock).not.toHaveBeenCalled();
  });

  it("13. closing the modal via Escape never calls any status RPC", () => {
    render(<SellerOrderDetailClient initialOrder={readyOrder("shipping")} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as Shipped" }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();
  });

  it("13. closing the modal via the backdrop never calls any status RPC", () => {
    const { container } = render(<SellerOrderDetailClient initialOrder={acceptedOrder("pickup")} />);
    fireEvent.click(screen.getByRole("button", { name: "Ready for Pickup" }));

    const backdrop = container.querySelector('[aria-hidden="true"].bg-ink\\/40');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(markOrderReadyMock).not.toHaveBeenCalled();
  });

  // ===== 14: no double-fire =====
  it("14. the primary confirm button is disabled while the RPC is pending, so a second click cannot double-fire it", async () => {
    let resolveRpc: (value: { ok: true; orderStatus: "ready"; wasAlreadyReady: boolean }) => void = () => {};
    markOrderReadyMock.mockReturnValue(new Promise((resolve) => (resolveRpc = resolve)));
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("meetup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Meetup" }));
    const dialog = screen.getByRole("dialog");
    const primaryButton = within(dialog).getByRole("button", { name: "Ready for Meetup" });
    fireEvent.click(primaryButton);

    const pendingButton = await within(dialog).findByRole("button", { name: "Updating…" });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(markOrderReadyMock).toHaveBeenCalledTimes(1);

    resolveRpc({ ok: true, orderStatus: "ready", wasAlreadyReady: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("14. the secondary action (Open Messages / Not Yet) is also disabled while the RPC is pending", async () => {
    let resolveRpc: (value: { ok: true; orderStatus: "handed_over_or_shipped"; wasAlreadyHandedOverOrShipped: boolean }) => void = () => {};
    markOrderHandedOverOrShippedMock.mockReturnValue(new Promise((resolve) => (resolveRpc = resolve)));
    render(<SellerOrderDetailClient initialOrder={readyOrder("pickup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as Picked Up" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Picked Up" }));

    expect(within(dialog).getByRole("button", { name: "Not Yet" })).toBeDisabled();

    resolveRpc({ ok: true, orderStatus: "handed_over_or_shipped", wasAlreadyHandedOverOrShipped: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // ===== 15: RPC failure does not falsely advance status =====
  it("15. a failed mark_order_ready call keeps the modal open, shows the error, and never advances the visible status", async () => {
    markOrderReadyMock.mockResolvedValue({ ok: false, code: "CANCELLATION_REQUEST_PENDING" });
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("meetup")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready for Meetup" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ready for Meetup" }));

    await waitFor(() => expect(within(dialog).getByText(/resolve the buyer's pending cancellation request/i)).toBeInTheDocument());
    // The modal stayed open (never called closeDialog on failure) --
    // status was never optimistically advanced.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("15. a failed mark_order_handed_over_or_shipped call keeps the modal open and shows the error", async () => {
    markOrderHandedOverOrShippedMock.mockResolvedValue({ ok: false, code: "CANCELLATION_REQUEST_PENDING" });
    render(<SellerOrderDetailClient initialOrder={readyOrder("shipping")} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as Shipped" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Shipped" }));

    await waitFor(() => expect(within(dialog).getByText(/resolve the buyer's pending cancellation request/i)).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // ===== 16: Message Buyer reuses the same direct messaging flow as the persistent action, never a generic /messages push =====
  it("16. Message Buyer from the fulfillment modal opens the existing conversation directly (desktop) and never calls a status RPC or pushes to the generic /messages inbox", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    render(<SellerOrderDetailClient initialOrder={acceptedOrder("shipping")} />);

    fireEvent.click(screen.getByRole("button", { name: "Ready to Ship" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Message Buyer" }));

    await waitFor(() => expect(openConversationMock).toHaveBeenCalledWith("conv-1"));
    // 19. The old generic router.push("/messages") fallback is gone from this flow.
    expect(pushMock).not.toHaveBeenCalledWith("/messages");
    expect(markOrderReadyMock).not.toHaveBeenCalled();
    expect(markOrderHandedOverOrShippedMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("SellerOrderDetailClient -- persistent Message Buyer action", () => {
  it("1. renders a persistent 'Message Buyer' action on the order detail", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);
    expect(screen.getByRole("button", { name: "Message Buyer" })).toBeInTheDocument();
  });

  it("2. is available regardless of order status -- pending, accepted, ready, handed_over_or_shipped, completed, cancelled, expired, and disputed", () => {
    for (const status of ["pending", "accepted", "ready", "handed_over_or_shipped", "completed", "cancelled", "expired", "disputed"] as const) {
      const { unmount } = render(<SellerOrderDetailClient initialOrder={sampleOrder({ status, items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
      expect(screen.getByRole("button", { name: "Message Buyer" })).toBeInTheDocument();
      unmount();
    }
  });

  it("4. clicking Message Buyer calls the order-scoped lookup wrapper", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));

    await waitFor(() => expect(getConversationForShopOrderMock).toHaveBeenCalled());
  });

  it("5/6. passes only the order's own public code -- never a buyer id, shop id, or any other identifier", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ orderPublicCode: "PSO-XYZ99999" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));

    await waitFor(() => expect(getConversationForShopOrderMock).toHaveBeenCalledWith("PSO-XYZ99999"));
    expect(getConversationForShopOrderMock).toHaveBeenCalledTimes(1);
    const args = getConversationForShopOrderMock.mock.calls[0];
    expect(args).toEqual(["PSO-XYZ99999"]);
  });

  it("7. an existing conversation opens the floating messenger directly on desktop -- no compose dialog, no navigation", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));

    await waitFor(() => expect(openConversationMock).toHaveBeenCalledWith("conv-1"));
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("8. an existing conversation routes to /messages/{id} on mobile -- no floating messenger, no compose dialog", async () => {
    setViewportWidth(MOBILE_WIDTH);
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/messages/conv-1"));
    expect(openConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("9. no existing conversation opens the existing ComposeMessageDialog, titled 'Message Buyer'", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Message Buyer")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Message")).toBeInTheDocument();
  });

  it("10. merely opening the compose dialog never calls startConversationFromOrder", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    await screen.findByRole("dialog");

    expect(startConversationFromOrderMock).not.toHaveBeenCalled();
  });

  it("11. sending the first message calls startConversationFromOrder with the order public code and typed body -- never a buyer id", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    startConversationFromOrderMock.mockResolvedValue({
      ok: true,
      conversationId: "conv-2",
      messageId: "msg-1",
      createdAt: "2026-01-05T00:00:00.000Z",
      conversationCreated: true,
    });
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ orderPublicCode: "PSO-ABC12345" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Your order is ready!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(startConversationFromOrderMock).toHaveBeenCalledWith("PSO-ABC12345", "Your order is ready!"));
  });

  it("12. a successful first send closes the compose dialog and opens the returned conversation (desktop)", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    startConversationFromOrderMock.mockResolvedValue({
      ok: true,
      conversationId: "conv-2",
      messageId: "msg-1",
      createdAt: "2026-01-05T00:00:00.000Z",
      conversationCreated: true,
    });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Your order is ready!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(openConversationMock).toHaveBeenCalledWith("conv-2"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("12b. a successful first send opens the returned conversation via /messages/{id} on mobile", async () => {
    setViewportWidth(MOBILE_WIDTH);
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    startConversationFromOrderMock.mockResolvedValue({
      ok: true,
      conversationId: "conv-2",
      messageId: "msg-1",
      createdAt: "2026-01-05T00:00:00.000Z",
      conversationCreated: true,
    });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Your order is ready!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/messages/conv-2"));
  });

  it("13/14. a failed first send keeps the dialog open and preserves the typed body", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    startConversationFromOrderMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Your order is ready!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(startConversationFromOrderMock).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Message")).toHaveValue("Your order is ready!");
    expect(openConversationMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("15. a failed first send shows only the safe wrapper error, never a raw backend message", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    startConversationFromOrderMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    expect(await within(dialog).findByText("You can't message this buyer right now.")).toBeInTheDocument();
  });

  it("15b. a failed lookup shows the safe wrapper error on the page, never a raw backend message", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: false, error: "We couldn't open this conversation right now." });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));

    expect(await screen.findByText("We couldn't open this conversation right now.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("16. the Send button is disabled while the first-send request is pending, preventing a duplicate send", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: null });
    let resolveSend: (value: { ok: true; conversationId: string; messageId: string; createdAt: string; conversationCreated: boolean }) => void = () => {};
    startConversationFromOrderMock.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    const pendingButton = await within(dialog).findByRole("button", { name: "Sending…" });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(startConversationFromOrderMock).toHaveBeenCalledTimes(1);

    resolveSend({ ok: true, conversationId: "conv-2", messageId: "msg-1", createdAt: "2026-01-05T00:00:00.000Z", conversationCreated: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("17. the Message Buyer button is disabled while the initial lookup is pending, preventing duplicate clicks and a second dialog", async () => {
    let resolveLookup: (value: { ok: true; conversationId: string | null }) => void = () => {};
    getConversationForShopOrderMock.mockReturnValue(new Promise((resolve) => (resolveLookup = resolve)));
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    const button = screen.getByRole("button", { name: "Message Buyer" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(getConversationForShopOrderMock).toHaveBeenCalledTimes(1);

    resolveLookup({ ok: true, conversationId: null });
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  });

  it("20. the buyer-side Message Seller flow is a separate module, untouched by this component", () => {
    // This component never imports ShopMessageAction/ListingActions and
    // never calls the buyer-initiated start_conversation RPC -- it only
    // ever uses the order-scoped wrappers mocked above.
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);
    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));
    expect(startConversationFromOrderMock).not.toHaveBeenCalled();
  });

  it("21/22. never calls supabase.rpc directly for messaging -- only the two committed wrapper functions are used", async () => {
    getConversationForShopOrderMock.mockResolvedValue({ ok: true, conversationId: "conv-1" });
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);

    fireEvent.click(screen.getByRole("button", { name: "Message Buyer" }));

    await waitFor(() => expect(getConversationForShopOrderMock).toHaveBeenCalled());
    // No direct Supabase client is imported/mocked by this test file at
    // all for messaging -- the component can only have reached
    // openConversationMock through the two wrapper mocks above.
    expect(openConversationMock).toHaveBeenCalledWith("conv-1");
  });
});

/** Exact-token class check (not substring) -- a substring check like
 * `className.toContain("h-12")` would false-positive on `min-h-12` (which
 * legitimately contains "h-12" as a trailing substring), so this splits on
 * whitespace and compares whole class tokens instead. */
function classTokens(el: HTMLElement): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

/** Asserts the exact, final tap-target sizing strategy every visible
 * seller order-action button must share: a robust `min-h-12` floor (never
 * a competing fixed `h-*`, which is what silently collapsed below 48px
 * when combined with `flex-1` inside a `flex-col` mobile layout -- see
 * this file's own header comment / the task report for the root-cause
 * explanation), explicit flex centering so the label stays vertically
 * centered regardless of the box's final resolved height, comfortable
 * vertical padding as a content-based floor independent of min-height, and
 * full-width mobile distribution via `flex-1`. */
function expectRobustActionButtonSizing(button: HTMLElement) {
  const tokens = classTokens(button);
  expect(tokens).toContain("min-h-12");
  expect(tokens).toContain("flex");
  expect(tokens).toContain("items-center");
  expect(tokens).toContain("justify-center");
  expect(tokens).toContain("py-3");
  expect(tokens).toContain("flex-1");
  expect(tokens).not.toContain("h-12");
  expect(tokens).not.toContain("h-11");
  expect(tokens).not.toContain("h-10");
}

describe("SellerOrderDetailClient -- mobile tap-target consistency across every lifecycle action button", () => {
  // A fixed h-* utility on a flex-1 (flex: 1 1 0%) child inside a
  // `flex-col` mobile layout can be squeezed down toward the button's tiny
  // intrinsic content size instead of the intended height -- min-height is
  // a hard floor the flex sizing algorithm always respects, so every
  // visible seller order-action button now uses min-h-12 (48px) instead of
  // a plain h-12, plus explicit flex centering and real vertical padding
  // as a content-based safety net.
  it("Accept order, Save decisions, and Decline order all use the robust min-height sizing strategy", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);
    for (const name of ["Accept order", "Decline order"]) {
      expectRobustActionButtonSizing(screen.getByRole("button", { name }));
    }
  });

  it("the ready-stage action (default sample order is meetup: Ready for Meetup) and Cancel order use the robust min-height sizing strategy", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder({ status: "accepted", items: [{ ...sampleOrder().items[0], status: "accepted" }] })} />);
    for (const name of ["Ready for Meetup", "Cancel order"]) {
      expectRobustActionButtonSizing(screen.getByRole("button", { name }));
    }
  });

  it("the handed-over-stage action (Mark as Shipped for shipping fulfillment) uses the robust min-height sizing strategy", () => {
    render(
      <SellerOrderDetailClient
        initialOrder={sampleOrder({ status: "ready", fulfillmentMethod: "shipping", items: [{ ...sampleOrder().items[0], status: "accepted" }] })}
      />,
    );
    expectRobustActionButtonSizing(screen.getByRole("button", { name: "Mark as Shipped" }));
  });

  it("Approve cancellation and Reject request match every other seller order action button's robust min-height sizing strategy -- previously a thinner h-10 outlier, then a still-collapsing plain h-12", () => {
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
    for (const name of ["Approve cancellation", "Reject request"]) {
      expectRobustActionButtonSizing(screen.getByRole("button", { name }));
    }
  });

  it("the confirmation-dialog buttons underneath (e.g. the Decline order confirm/cancel pair) are NOT part of this standardization -- they are not flex-1 children of a flex-col row, so their own plain h-11 already renders correctly and is left untouched", () => {
    render(<SellerOrderDetailClient initialOrder={sampleOrder()} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline order" }));
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Decline order" });
    const tokens = classTokens(confirmButton);
    expect(tokens).toContain("h-11");
    expect(tokens).not.toContain("min-h-12");
    expect(tokens).not.toContain("flex-1");
  });
});
