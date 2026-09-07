import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { refreshMock, cancelPendingOrderMock, cancelOrderChangesMock, confirmOrderChangesMock, requestOrderCancellationMock, confirmOrderReceivedMock } =
  vi.hoisted(() => ({
    refreshMock: vi.fn(),
    cancelPendingOrderMock: vi.fn(),
    cancelOrderChangesMock: vi.fn(),
    confirmOrderChangesMock: vi.fn(),
    requestOrderCancellationMock: vi.fn(),
    confirmOrderReceivedMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
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
