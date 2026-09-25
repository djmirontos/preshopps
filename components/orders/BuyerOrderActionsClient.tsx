"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { notifySuccess } from "@/lib/notifications/toast";
import { getAllowedBuyerActions, type OrderStatus } from "@/lib/orders/order-status-copy";
import {
  cancelPendingOrder,
  cancelOrderChanges,
  confirmOrderChanges,
  requestOrderCancellation,
  confirmOrderReceived,
  CANCEL_PENDING_ORDER_ERROR_MESSAGES,
  CANCEL_ORDER_CHANGES_ERROR_MESSAGES,
  CONFIRM_ORDER_CHANGES_ERROR_MESSAGES,
  REQUEST_ORDER_CANCELLATION_ERROR_MESSAGES,
  CONFIRM_ORDER_RECEIVED_ERROR_MESSAGES,
} from "@/lib/orders/buyer-order-actions";

type Props = {
  orderId: string;
  status: OrderStatus;
  hasPendingCancellationRequest: boolean;
};

type DialogKind = "cancel_pending" | "confirm_changes" | "cancel_changes" | "request_cancellation" | "confirm_receipt" | null;

/**
 * Focused buyer-order action component -- one place for every buyer
 * lifecycle mutation, driven entirely by the centralized
 * getAllowedBuyerActions model (lib/orders/order-status-copy.ts) so no
 * status/action logic is duplicated here. Reuses the same compact
 * ConfirmDialog pattern already established for Seller Order Management
 * (components/seller/ConfirmDialog.tsx) rather than introducing a second
 * modal system. After every successful mutation it calls router.refresh()
 * so the server re-fetches get_my_order_detail and this component's own
 * status prop resyncs to the canonical backend state -- it never assumes
 * an outcome and mutates local state as if it were authoritative.
 *
 * LAUNCH UX S1.2 buyer-order success feedback: each action's authoritative
 * RPC result was checked before adding a toast (each RPC's own migration
 * source, not just its TypeScript return type) -- cancelPendingOrder/
 * cancelOrderChanges always return orderStatus 'cancelled' on any ok:true
 * result (fresh or already-idempotent), and confirmOrderChanges always
 * returns 'accepted', so those three fire unconditionally on result.ok.
 * confirmOrderReceived is the one exception: per
 * 0044_confirm_order_received_auto_complete.sql, a fresh confirmation
 * attempts completion in the same call, but a caught completion failure
 * (rare -- an inventory/reservation inconsistency) leaves orderStatus at
 * 'received_confirmed' instead of 'completed', with result.ok still true.
 * handleConfirmReceipt's toast is therefore gated on
 * `result.orderStatus === "completed"` specifically, not merely
 * `result.ok` -- it must never claim the order is complete (and reviewable)
 * when it is not. In that rare non-completed outcome the buyer is not left
 * with zero feedback: closeDialog()/router.refresh() still run as normal,
 * the order's own status prop resyncs to 'received_confirmed', and the
 * parent page's existing getOrderStatusGuidance text updates to "You've
 * confirmed receiving this order." -- accurate, if less celebratory than
 * true completion. getAllowedBuyerActions has no case for
 * 'received_confirmed' (falls to its default: no actions), so the button
 * also correctly disappears either way. Retrying confirm_order_received
 * from that state hits its own idempotent branch server-side, which
 * (by design, see that migration's own header) never retries the
 * completion attempt -- a known, accepted, backend-only limitation, not
 * something this component can or should work around.
 *
 * Every toast fires only after closeDialog() and before the existing
 * router.refresh(), mirroring SellerOrderDetailClient's own pattern for
 * the equivalent seller-side actions. Never fires on a validation/mutation
 * failure (those return before reaching it, unchanged) or a merely-
 * cancelled/closed dialog (closeDialog() itself never calls any of these
 * handlers). The existing per-status guidance text (getOrderStatusGuidance)
 * is a persistent state description, never an action-specific completion
 * acknowledgment, so there is nothing here for these toasts to duplicate.
 */
export function BuyerOrderActionsClient({ orderId, status, hasPendingCancellationRequest }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const allowedActions = getAllowedBuyerActions(status, hasPendingCancellationRequest);

  function closeDialog() {
    setDialog(null);
    setActionError(null);
  }

  async function handleCancelPending() {
    setActionPending("cancel_pending");
    setActionError(null);

    const result = await cancelPendingOrder(orderId);
    setActionPending(null);

    if (!result.ok) {
      setActionError(CANCEL_PENDING_ORDER_ERROR_MESSAGES[result.code]);
      router.refresh();
      return;
    }

    closeDialog();
    notifySuccess("Order cancelled");
    router.refresh();
  }

  async function handleConfirmChanges() {
    setActionPending("confirm_changes");
    setActionError(null);

    const result = await confirmOrderChanges(orderId);
    setActionPending(null);

    if (!result.ok) {
      setActionError(CONFIRM_ORDER_CHANGES_ERROR_MESSAGES[result.code]);
      router.refresh();
      return;
    }

    closeDialog();
    notifySuccess("Changes confirmed");
    router.refresh();
  }

  async function handleCancelChanges() {
    setActionPending("cancel_changes");
    setActionError(null);

    const result = await cancelOrderChanges(orderId);
    setActionPending(null);

    if (!result.ok) {
      setActionError(CANCEL_ORDER_CHANGES_ERROR_MESSAGES[result.code]);
      router.refresh();
      return;
    }

    closeDialog();
    notifySuccess("Order cancelled");
    router.refresh();
  }

  async function handleRequestCancellation(reason: string) {
    setActionPending("request_cancellation");
    setActionError(null);

    const result = await requestOrderCancellation(orderId, reason);
    setActionPending(null);

    if (!result.ok) {
      setActionError(REQUEST_ORDER_CANCELLATION_ERROR_MESSAGES[result.code]);
      return;
    }

    closeDialog();
    notifySuccess("Cancellation requested");
    router.refresh();
  }

  async function handleConfirmReceipt() {
    setActionPending("confirm_receipt");
    setActionError(null);

    const result = await confirmOrderReceived(orderId);
    setActionPending(null);

    if (!result.ok) {
      setActionError(CONFIRM_ORDER_RECEIVED_ERROR_MESSAGES[result.code]);
      router.refresh();
      return;
    }

    closeDialog();
    // Gated on the row's own true final status, not merely result.ok --
    // see this file's own header comment for why confirm_order_received
    // can succeed while the immediate completion attempt it makes
    // internally did not (a rare caught failure, orderStatus staying
    // 'received_confirmed'). Never claim the order is complete when it
    // is not.
    if (result.orderStatus === "completed") {
      notifySuccess("Order completed");
    }
    router.refresh();
  }

  if (allowedActions.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}

      {allowedActions.includes("cancel_pending") && (
        <button
          type="button"
          onClick={() => setDialog("cancel_pending")}
          disabled={actionPending !== null}
          className="h-11 w-full rounded-[10px] border border-danger px-4 text-sm font-semibold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 sm:w-auto"
        >
          Cancel order
        </button>
      )}

      {allowedActions.includes("confirm_changes") && (
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={() => setDialog("confirm_changes")}
            disabled={actionPending !== null}
            className="h-11 flex-1 rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
          >
            Confirm changes
          </button>
          <button
            type="button"
            onClick={() => setDialog("cancel_changes")}
            disabled={actionPending !== null}
            className="h-11 flex-1 rounded-[10px] border border-danger px-4 text-sm font-semibold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          >
            Cancel order
          </button>
        </div>
      )}

      {allowedActions.includes("request_cancellation") && (
        <button
          type="button"
          onClick={() => setDialog("request_cancellation")}
          disabled={actionPending !== null}
          className="h-11 w-full rounded-[10px] border border-danger px-4 text-sm font-semibold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 sm:w-auto"
        >
          Request cancellation
        </button>
      )}

      {allowedActions.includes("confirm_receipt") && (
        <button
          type="button"
          onClick={() => setDialog("confirm_receipt")}
          disabled={actionPending !== null}
          className="h-11 w-full rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
        >
          Confirm receipt
        </button>
      )}

      {dialog === "cancel_pending" && (
        <ConfirmDialog
          title="Cancel this order?"
          description="The seller hasn't reviewed this order yet. This can't be undone."
          confirmLabel="Cancel order"
          destructive
          isPending={actionPending === "cancel_pending"}
          errorMessage={actionError}
          onConfirm={handleCancelPending}
          onClose={closeDialog}
        />
      )}

      {dialog === "confirm_changes" && (
        <ConfirmDialog
          title="Confirm the seller's changes?"
          description="You'll continue with only the items the seller accepted. This can't be undone."
          confirmLabel="Confirm changes"
          isPending={actionPending === "confirm_changes"}
          errorMessage={actionError}
          onConfirm={handleConfirmChanges}
          onClose={closeDialog}
        />
      )}

      {dialog === "cancel_changes" && (
        <ConfirmDialog
          title="Cancel this order?"
          description="You'll cancel instead of continuing with the seller's revised offer. This can't be undone."
          confirmLabel="Cancel order"
          destructive
          isPending={actionPending === "cancel_changes"}
          errorMessage={actionError}
          onConfirm={handleCancelChanges}
          onClose={closeDialog}
        />
      )}

      {dialog === "request_cancellation" && (
        <ConfirmDialog
          title="Request cancellation?"
          description="The seller will review your request and can approve or reject it."
          confirmLabel="Send request"
          noteLabel="Reason for cancellation"
          destructive
          isPending={actionPending === "request_cancellation"}
          errorMessage={actionError}
          onConfirm={handleRequestCancellation}
          onClose={closeDialog}
        />
      )}

      {dialog === "confirm_receipt" && (
        <ConfirmDialog
          title="Confirm that you received this order?"
          description="This can't be undone."
          confirmLabel="Confirm receipt"
          isPending={actionPending === "confirm_receipt"}
          errorMessage={actionError}
          onConfirm={handleConfirmReceipt}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
