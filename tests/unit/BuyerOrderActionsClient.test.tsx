import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const {
  refreshMock,
  cancelPendingOrderMock,
  cancelOrderChangesMock,
  confirmOrderChangesMock,
  requestOrderCancellationMock,
  confirmOrderReceivedMock,
  notifySuccessMock,
} = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  cancelPendingOrderMock: vi.fn(),
  cancelOrderChangesMock: vi.fn(),
  confirmOrderChangesMock: vi.fn(),
  requestOrderCancellationMock: vi.fn(),
  confirmOrderReceivedMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/notifications/toast", () => ({
  notifySuccess: notifySuccessMock,
}));

vi.mock("@/lib/orders/buyer-order-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/buyer-order-actions")>("@/lib/orders/buyer-order-actions");
  return {
    ...actual,
    cancelPendingOrder: cancelPendingOrderMock,
    cancelOrderChanges: cancelOrderChangesMock,
    confirmOrderChanges: confirmOrderChangesMock,
    requestOrderCancellation: requestOrderCancellationMock,
    confirmOrderReceived: confirmOrderReceivedMock,
  };
});

import { BuyerOrderActionsClient } from "@/components/orders/BuyerOrderActionsClient";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BuyerOrderActionsClient -- pending", () => {
  it("shows a Cancel order button", () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="pending" hasPendingCancellationRequest={false} />);
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
  });

  it("requires an explicit confirmation step before cancelling", async () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="pending" hasPendingCancellationRequest={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(cancelPendingOrderMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    cancelPendingOrderMock.mockResolvedValue({ ok: true, orderStatus: "cancelled", wasAlreadyCancelled: false });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => expect(cancelPendingOrderMock).toHaveBeenCalledWith("order-1"));
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("BuyerOrderActionsClient -- changes_pending", () => {
  it("shows Confirm changes and Cancel order buttons", () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);
    expect(screen.getByRole("button", { name: "Confirm changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
  });

  it("calls confirm_order_changes with only the order id after confirmation", async () => {
    confirmOrderChangesMock.mockResolvedValue({ ok: true, orderStatus: "accepted", wasAlreadyConfirmed: false, acceptedItemIds: ["item-1"], declinedItemIds: [] });
    render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" }));

    await waitFor(() => expect(confirmOrderChangesMock).toHaveBeenCalledWith("order-1"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("calls cancel_order_changes (not cancel_pending_order) when the buyer cancels from changes_pending", async () => {
    cancelOrderChangesMock.mockResolvedValue({ ok: true, orderStatus: "cancelled", wasAlreadyCancelled: false });
    render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => expect(cancelOrderChangesMock).toHaveBeenCalledWith("order-1"));
    expect(cancelPendingOrderMock).not.toHaveBeenCalled();
  });
});

describe("BuyerOrderActionsClient -- accepted/ready cancellation requests", () => {
  it("shows Request cancellation when no request is pending", () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="accepted" hasPendingCancellationRequest={false} />);
    expect(screen.getByRole("button", { name: "Request cancellation" })).toBeInTheDocument();
  });

  it("hides Request cancellation once a request is already pending, preventing a duplicate", () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="accepted" hasPendingCancellationRequest={true} />);
    expect(screen.queryByRole("button", { name: "Request cancellation" })).not.toBeInTheDocument();
  });

  it("requires a reason before the request can be confirmed, and calls request_order_cancellation with it", async () => {
    requestOrderCancellationMock.mockResolvedValue({ ok: true, requestId: "req-1", wasAlreadyPending: false });
    render(<BuyerOrderActionsClient orderId="order-1" status="accepted" hasPendingCancellationRequest={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Request cancellation" }));
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Send request" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for cancellation"), { target: { value: "Found it cheaper elsewhere" } });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(requestOrderCancellationMock).toHaveBeenCalledWith("order-1", "Found it cheaper elsewhere"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("renders no action for ready with a pending request either", () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="ready" hasPendingCancellationRequest={true} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("BuyerOrderActionsClient -- confirm receipt", () => {
  it("shows Confirm receipt only for handed_over_or_shipped", () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);
    expect(screen.getByRole("button", { name: "Confirm receipt" })).toBeInTheDocument();
  });

  it("requires confirmation before calling confirm_order_received", async () => {
    confirmOrderReceivedMock.mockResolvedValue({ ok: true, orderStatus: "completed", wasAlreadyReceivedConfirmed: false });
    render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    expect(confirmOrderReceivedMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm receipt" }));

    await waitFor(() => expect(confirmOrderReceivedMock).toHaveBeenCalledWith("order-1"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("exposes no separate Complete action anywhere", () => {
    render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);
    expect(screen.queryByRole("button", { name: /complete/i })).not.toBeInTheDocument();
  });
});

describe("BuyerOrderActionsClient -- no-action statuses", () => {
  it("renders nothing for completed", () => {
    const { container } = render(<BuyerOrderActionsClient orderId="order-1" status="completed" hasPendingCancellationRequest={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for received_confirmed", () => {
    const { container } = render(<BuyerOrderActionsClient orderId="order-1" status="received_confirmed" hasPendingCancellationRequest={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for cancelled/declined/expired/disputed", () => {
    for (const status of ["cancelled", "declined", "expired", "disputed"] as const) {
      const { container } = render(<BuyerOrderActionsClient orderId="order-1" status={status} hasPendingCancellationRequest={false} />);
      expect(container).toBeEmptyDOMElement();
    }
  });
});

describe("BuyerOrderActionsClient -- error handling", () => {
  it("shows a safe error message and does not crash when a mutation fails", async () => {
    cancelPendingOrderMock.mockResolvedValue({ ok: false, code: "ORDER_NOT_CANCELLABLE" });
    render(<BuyerOrderActionsClient orderId="order-1" status="pending" hasPendingCancellationRequest={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => expect(screen.getAllByText(/can no longer be cancelled/i).length).toBeGreaterThan(0));
    expect(refreshMock).toHaveBeenCalled();
  });
});

/**
 * LAUNCH UX S1.2 buyer-order success feedback. Mirrors
 * SellerOrderDetailClient.test.tsx's own established assertion style for
 * exactly this feature (exact copy, toHaveBeenCalledTimes(1), never on
 * failure, never on a merely-cancelled dialog, exactly one toast on a
 * successful retry after a failure).
 */
describe("BuyerOrderActionsClient -- LAUNCH UX S1.2 success feedback (notifySuccess)", () => {
  describe("Cancel pending", () => {
    it("calls notifySuccess('Order cancelled') exactly once, after the confirmation dialog closes", async () => {
      cancelPendingOrderMock.mockResolvedValue({ ok: true, orderStatus: "cancelled", wasAlreadyCancelled: false });
      render(<BuyerOrderActionsClient orderId="order-1" status="pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel order" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(notifySuccessMock).toHaveBeenCalledWith("Order cancelled");
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });

    it("never calls notifySuccess when the confirmation dialog is merely cancelled", () => {
      render(<BuyerOrderActionsClient orderId="order-1" status="pending" hasPendingCancellationRequest={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(cancelPendingOrderMock).not.toHaveBeenCalled();
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("never calls notifySuccess when cancel_pending_order fails", async () => {
      cancelPendingOrderMock.mockResolvedValue({ ok: false, code: "ORDER_NOT_CANCELLABLE" });
      render(<BuyerOrderActionsClient orderId="order-1" status="pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));

      await waitFor(() => expect(within(dialog).getByText(/can no longer be cancelled/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("a successful retry after a failed cancellation fires exactly one toast, never two", async () => {
      cancelPendingOrderMock.mockResolvedValueOnce({ ok: false, code: "ORDER_NOT_CANCELLABLE" });
      render(<BuyerOrderActionsClient orderId="order-1" status="pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
      let dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
      await waitFor(() => expect(within(dialog).getByText(/can no longer be cancelled/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();

      cancelPendingOrderMock.mockResolvedValueOnce({ ok: true, orderStatus: "cancelled", wasAlreadyCancelled: false });
      dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));

      await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Order cancelled"));
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Confirm changes", () => {
    it("calls notifySuccess('Changes confirmed') exactly once, never 'Order cancelled'", async () => {
      confirmOrderChangesMock.mockResolvedValue({ ok: true, orderStatus: "accepted", wasAlreadyConfirmed: false, acceptedItemIds: ["item-1"], declinedItemIds: [] });
      render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm changes" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(notifySuccessMock).toHaveBeenCalledWith("Changes confirmed");
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
      expect(notifySuccessMock).not.toHaveBeenCalledWith("Order cancelled");
    });

    it("never calls notifySuccess when the confirmation dialog is merely cancelled", () => {
      render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(confirmOrderChangesMock).not.toHaveBeenCalled();
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("never calls notifySuccess when confirm_order_changes fails", async () => {
      confirmOrderChangesMock.mockResolvedValue({ ok: false, code: "ORDER_NOT_CONFIRMABLE" });
      render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" }));

      await waitFor(() => expect(within(dialog).getByText(/no longer awaiting your confirmation/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("a successful retry after a failed confirmation fires exactly one toast, never two", async () => {
      confirmOrderChangesMock.mockResolvedValueOnce({ ok: false, code: "ORDER_NOT_CONFIRMABLE" });
      render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
      let dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" }));
      await waitFor(() => expect(within(dialog).getByText(/no longer awaiting your confirmation/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();

      confirmOrderChangesMock.mockResolvedValueOnce({ ok: true, orderStatus: "accepted", wasAlreadyConfirmed: false, acceptedItemIds: ["item-1"], declinedItemIds: [] });
      dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm changes" }));

      await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Changes confirmed"));
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Cancel changes (cancelling from changes_pending)", () => {
    it("calls notifySuccess('Order cancelled') exactly once", async () => {
      cancelOrderChangesMock.mockResolvedValue({ ok: true, orderStatus: "cancelled", wasAlreadyCancelled: false });
      render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel order" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(notifySuccessMock).toHaveBeenCalledWith("Order cancelled");
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });

    it("never calls notifySuccess when the confirmation dialog is merely cancelled", () => {
      render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(cancelOrderChangesMock).not.toHaveBeenCalled();
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("never calls notifySuccess when cancel_order_changes fails", async () => {
      cancelOrderChangesMock.mockResolvedValue({ ok: false, code: "ORDER_NOT_CANCELLABLE" });
      render(<BuyerOrderActionsClient orderId="order-1" status="changes_pending" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));

      await waitFor(() => expect(within(dialog).getByText(/can no longer be cancelled/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });
  });

  describe("Request cancellation", () => {
    it("calls notifySuccess('Cancellation requested') exactly once", async () => {
      requestOrderCancellationMock.mockResolvedValue({ ok: true, requestId: "req-1", wasAlreadyPending: false });
      render(<BuyerOrderActionsClient orderId="order-1" status="accepted" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Request cancellation" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Reason for cancellation"), { target: { value: "Found it cheaper elsewhere" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(notifySuccessMock).toHaveBeenCalledWith("Cancellation requested");
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });

    it("never calls notifySuccess when the confirmation dialog is merely cancelled", () => {
      render(<BuyerOrderActionsClient orderId="order-1" status="accepted" hasPendingCancellationRequest={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Request cancellation" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(requestOrderCancellationMock).not.toHaveBeenCalled();
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("never calls notifySuccess when request_order_cancellation fails", async () => {
      requestOrderCancellationMock.mockResolvedValue({ ok: false, code: "INVALID_CANCELLATION_REASON" });
      render(<BuyerOrderActionsClient orderId="order-1" status="accepted" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Request cancellation" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Reason for cancellation"), { target: { value: "x" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));

      await waitFor(() => expect(within(dialog).getByText(/provide a reason/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("a successful retry after a failed request fires exactly one toast, never two", async () => {
      requestOrderCancellationMock.mockResolvedValueOnce({ ok: false, code: "INVALID_CANCELLATION_REASON" });
      render(<BuyerOrderActionsClient orderId="order-1" status="accepted" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Request cancellation" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Reason for cancellation"), { target: { value: "x" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
      await waitFor(() => expect(within(dialog).getByText(/provide a reason/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();

      requestOrderCancellationMock.mockResolvedValueOnce({ ok: true, requestId: "req-1", wasAlreadyPending: false });
      fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));

      await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Cancellation requested"));
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Confirm receipt -- gated strictly on orderStatus === 'completed', never merely result.ok", () => {
    it("a fresh confirmation that reaches 'completed' calls notifySuccess('Order completed') exactly once, after the dialog closes", async () => {
      confirmOrderReceivedMock.mockResolvedValue({ ok: true, orderStatus: "completed", wasAlreadyReceivedConfirmed: false });
      render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm receipt" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(notifySuccessMock).toHaveBeenCalledWith("Order completed");
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });

    it("review finding: a successful call that does NOT reach 'completed' (the rare caught auto-complete failure, orderStatus stays 'received_confirmed') never calls notifySuccess -- the order is not actually complete", async () => {
      confirmOrderReceivedMock.mockResolvedValue({ ok: true, orderStatus: "received_confirmed", wasAlreadyReceivedConfirmed: false });
      render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm receipt" }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("the idempotent branch (was_already_received_confirmed, orderStatus 'received_confirmed') also never calls notifySuccess", async () => {
      confirmOrderReceivedMock.mockResolvedValue({ ok: true, orderStatus: "received_confirmed", wasAlreadyReceivedConfirmed: true });
      render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm receipt" }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("never calls notifySuccess when the confirmation dialog is merely cancelled", () => {
      render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);
      fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(confirmOrderReceivedMock).not.toHaveBeenCalled();
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("never calls notifySuccess when confirm_order_received fails outright", async () => {
      confirmOrderReceivedMock.mockResolvedValue({ ok: false, code: "ORDER_NOT_RECEIVABLE" });
      render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm receipt" }));

      await waitFor(() => expect(within(dialog).getByText(/can no longer be confirmed/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("a successful retry that reaches 'completed' after an earlier outright failure fires exactly one toast, never two", async () => {
      confirmOrderReceivedMock.mockResolvedValueOnce({ ok: false, code: "ORDER_NOT_RECEIVABLE" });
      render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
      let dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm receipt" }));
      await waitFor(() => expect(within(dialog).getByText(/can no longer be confirmed/i)).toBeInTheDocument());
      expect(notifySuccessMock).not.toHaveBeenCalled();

      confirmOrderReceivedMock.mockResolvedValueOnce({ ok: true, orderStatus: "completed", wasAlreadyReceivedConfirmed: false });
      dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm receipt" }));

      await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Order completed"));
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    });

    it("review correction: after a non-completed success, the parent supplying the refreshed 'received_confirmed' status removes the Confirm Receipt action entirely -- there is no reachable second click through this component", async () => {
      // A prior version of this test clicked "Confirm receipt" a second
      // time on the SAME rendered instance after a non-completed success,
      // relying on the mocked router.refresh() being a no-op that left the
      // stale status="handed_over_or_shipped" prop in place -- a second
      // click that is impossible in production. router.refresh() actually
      // re-fetches get_my_order_detail server-side and the parent page
      // passes THIS component a fresh status prop; getAllowedBuyerActions
      // has no case for 'received_confirmed' (falls to its default: no
      // actions), so the button disappears with the very next render,
      // before any second click could ever happen. Separately,
      // confirm_order_received's own idempotent branch (see this file's
      // header comment) never retries the completion attempt even if it
      // somehow were called again -- there is no path from
      // 'received_confirmed' back to 'completed' via a UI retry at all.
      confirmOrderReceivedMock.mockResolvedValueOnce({ ok: true, orderStatus: "received_confirmed", wasAlreadyReceivedConfirmed: false });
      const { rerender } = render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);

      fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm receipt" }));
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(notifySuccessMock).not.toHaveBeenCalled();

      // Simulates what router.refresh() actually causes in production: the
      // parent (app/orders/[publicCode]/page.tsx) re-renders this
      // component with the server's true, refreshed status -- never the
      // stale prop this test started with.
      rerender(<BuyerOrderActionsClient orderId="order-1" status="received_confirmed" hasPendingCancellationRequest={false} />);

      expect(screen.queryByRole("button", { name: "Confirm receipt" })).not.toBeInTheDocument();
      // No buyer action remains at all for this status -- the component
      // renders nothing (matches the pre-existing "renders nothing for
      // received_confirmed" fresh-mount test elsewhere in this file). The
      // corresponding "You've confirmed receiving this order" guidance for
      // this status is rendered by the parent page itself
      // (getOrderStatusGuidance), not by this component, so it is not
      // asserted here.
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });
  });

  describe("no cross-action duplicate/leak", () => {
    it("mounting the page with no action taken never calls notifySuccess", () => {
      render(<BuyerOrderActionsClient orderId="order-1" status="handed_over_or_shipped" hasPendingCancellationRequest={false} />);
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });
  });
});
