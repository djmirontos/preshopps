"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { FULFILLMENT_LABELS } from "@/lib/marketplace/search-params";
import { getSellerOrderStatusGuidance, getAllowedSellerActions } from "@/lib/orders/order-status-copy";
import type { SellerOrderDetail } from "@/lib/seller/get-my-shop-order-detail";
import {
  acceptOrderItems,
  markOrderReady,
  markOrderHandedOverOrShipped,
  cancelAcceptedOrder,
  resolveOrderCancellation,
  ACCEPT_ORDER_ITEMS_ERROR_MESSAGES,
  MARK_ORDER_READY_ERROR_MESSAGES,
  MARK_ORDER_HANDED_OVER_OR_SHIPPED_ERROR_MESSAGES,
  CANCEL_ACCEPTED_ORDER_ERROR_MESSAGES,
  RESOLVE_ORDER_CANCELLATION_ERROR_MESSAGES,
} from "@/lib/seller/seller-order-actions";

type Props = {
  initialOrder: SellerOrderDetail;
};

type DialogKind = "decline" | "cancel_accepted" | "resolve_approve" | "resolve_reject" | null;

/**
 * All lifecycle mutation is driven by the centralized
 * getAllowedSellerActions model (lib/orders/order-status-copy.ts) -- this
 * component never invents a status transition itself. After every
 * successful mutation it calls router.refresh() so the server re-fetches
 * get_my_shop_order_detail and this component's props resync to the
 * canonical backend state -- rather than syncing via an effect (which
 * would cause an extra cascading render), the sync happens during render
 * itself by comparing against the previous initialOrder reference, the
 * pattern React recommends for "adjusting state when a prop changes"; it
 * never assumes the outcome and mutates local state as if it were
 * authoritative.
 */
function decisionsFor(order: SellerOrderDetail): Record<string, boolean> {
  return Object.fromEntries(order.items.filter((item) => item.status === "pending").map((item) => [item.orderItemId, true]));
}

export function SellerOrderDetailClient({ initialOrder }: Props) {
  const router = useRouter();
  const [prevInitialOrder, setPrevInitialOrder] = useState(initialOrder);
  const [order, setOrder] = useState(initialOrder);
  const [decisions, setDecisions] = useState<Record<string, boolean>>(() => decisionsFor(initialOrder));
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (initialOrder !== prevInitialOrder) {
    setPrevInitialOrder(initialOrder);
    setOrder(initialOrder);
    setDecisions(decisionsFor(initialOrder));
  }

  const pendingItems = order.items.filter((item) => item.status === "pending");
  const hasPendingCancellationRequest = order.pendingCancellationRequestId !== null;
  const allowedActions = getAllowedSellerActions(order.status, hasPendingCancellationRequest);

  function closeDialog() {
    setDialog(null);
    setActionError(null);
  }

  async function handleAcceptDecisions() {
    setActionPending("decide_items");
    setActionError(null);

    const acceptedItemIds = pendingItems.filter((item) => decisions[item.orderItemId]).map((item) => item.orderItemId);
    const declinedItemIds = pendingItems.filter((item) => !decisions[item.orderItemId]).map((item) => item.orderItemId);

    const result = await acceptOrderItems(order.orderId, acceptedItemIds, declinedItemIds);
    setActionPending(null);

    if (!result.ok) {
      setActionError(ACCEPT_ORDER_ITEMS_ERROR_MESSAGES[result.code]);
      router.refresh();
      return;
    }

    router.refresh();
  }

  async function handleDeclineOrder() {
    setActionPending("decline");
    setActionError(null);

    const declinedItemIds = pendingItems.map((item) => item.orderItemId);
    const result = await acceptOrderItems(order.orderId, [], declinedItemIds);
    setActionPending(null);

    if (!result.ok) {
      setActionError(ACCEPT_ORDER_ITEMS_ERROR_MESSAGES[result.code]);
      router.refresh();
      return;
    }

    closeDialog();
    router.refresh();
  }

  async function handleMarkReady() {
    setActionPending("mark_ready");
    setActionError(null);

    const result = await markOrderReady(order.orderId);
    setActionPending(null);

    if (!result.ok) {
      setActionError(MARK_ORDER_READY_ERROR_MESSAGES[result.code]);
    }

    router.refresh();
  }

  async function handleMarkHandedOverOrShipped() {
    setActionPending("mark_handed_over_or_shipped");
    setActionError(null);

    const result = await markOrderHandedOverOrShipped(order.orderId);
    setActionPending(null);

    if (!result.ok) {
      setActionError(MARK_ORDER_HANDED_OVER_OR_SHIPPED_ERROR_MESSAGES[result.code]);
    }

    router.refresh();
  }

  async function handleCancelAccepted(reason: string) {
    setActionPending("cancel_accepted");
    setActionError(null);

    const result = await cancelAcceptedOrder(order.orderId, reason);
    setActionPending(null);

    if (!result.ok) {
      setActionError(CANCEL_ACCEPTED_ORDER_ERROR_MESSAGES[result.code]);
      return;
    }

    closeDialog();
    router.refresh();
  }

  async function handleResolveCancellation(confirm: boolean, reviewNote: string) {
    if (!order.pendingCancellationRequestId) return;

    setActionPending(confirm ? "resolve_approve" : "resolve_reject");
    setActionError(null);

    const result = await resolveOrderCancellation(order.pendingCancellationRequestId, confirm, confirm ? null : reviewNote);
    setActionPending(null);

    if (!result.ok) {
      setActionError(RESOLVE_ORDER_CANCELLATION_ERROR_MESSAGES[result.code]);
      return;
    }

    closeDialog();
    router.refresh();
  }

  const allChecked = pendingItems.length > 0 && pendingItems.every((item) => decisions[item.orderItemId]);

  return (
    <>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">{order.orderPublicCode}</h1>
        <OrderStatusBadge status={order.status} fulfillmentMethod={order.fulfillmentMethod} />
      </div>
      <p className="mt-1 text-sm text-ink-secondary">{getSellerOrderStatusGuidance(order.status, order.fulfillmentMethod)}</p>

      <div className="mt-6 rounded-[14px] border border-border bg-surface p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Buyer</dt>
            <dd className="mt-0.5 font-medium text-ink">{order.buyerDisplayName}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Order date</dt>
            <dd className="mt-0.5 font-medium text-ink">{formatOrderDate(order.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Fulfillment</dt>
            <dd className="mt-0.5 font-medium text-ink">{FULFILLMENT_LABELS[order.fulfillmentMethod]}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Total</dt>
            <dd className="mt-0.5 font-semibold text-ink">{formatPriceFromCents(order.totalCents)}</dd>
          </div>
        </dl>

        {order.buyerNote && (
          <div className="mt-4 border-t border-divider pt-4">
            <p className="text-xs text-ink-muted">Buyer note</p>
            <p className="mt-1 text-sm text-ink">{order.buyerNote}</p>
          </div>
        )}
      </div>

      {hasPendingCancellationRequest && allowedActions.includes("resolve_cancellation") && (
        <div className="mt-4 rounded-[14px] border border-danger/40 bg-danger/5 p-4">
          <p className="text-sm font-semibold text-ink">The buyer has requested to cancel this order.</p>
          {order.pendingCancellationReason && <p className="mt-1 text-sm text-ink-secondary">&ldquo;{order.pendingCancellationReason}&rdquo;</p>}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setDialog("resolve_approve")}
              disabled={actionPending !== null}
              className="h-10 rounded-[10px] bg-danger px-4 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              Approve cancellation
            </button>
            <button
              type="button"
              onClick={() => setDialog("resolve_reject")}
              disabled={actionPending !== null}
              className="h-10 rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              Reject request
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold text-ink">Items</h2>
        {order.items.map((item) => {
          const isPendingItem = item.status === "pending" && allowedActions.includes("decide_items");
          return (
            <div key={item.orderItemId} className="flex gap-3 rounded-[14px] border border-border bg-surface p-3">
              {isPendingItem && (
                <div className="flex shrink-0 items-center">
                  <input
                    type="checkbox"
                    id={`accept-${item.orderItemId}`}
                    checked={Boolean(decisions[item.orderItemId])}
                    onChange={(event) => setDecisions((prev) => ({ ...prev, [item.orderItemId]: event.target.checked }))}
                    aria-label={`Accept ${item.title}`}
                    className="h-5 w-5 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>
              )}
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-divider">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.title} fill sizes="64px" className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Package className="h-5 w-5 text-ink-muted/60" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-ink">{item.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Qty {item.quantity} × {formatPriceFromCents(item.priceCentsSnapshot)}
                </p>
                <div className="mt-1">
                  <Badge tone={item.status === "accepted" ? "brand" : "neutral"}>
                    {item.status === "pending" ? "Pending" : item.status === "accepted" ? "Accepted" : "Declined"}
                  </Badge>
                </div>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                {formatPriceFromCents(item.priceCentsSnapshot * item.quantity)}
              </p>
            </div>
          );
        })}
      </div>

      {actionError && <p className="mt-4 text-sm text-danger">{actionError}</p>}

      {allowedActions.includes("decide_items") && (
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={handleAcceptDecisions}
            disabled={actionPending !== null}
            className="h-11 flex-1 rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {actionPending === "decide_items" ? "Saving…" : allChecked ? "Accept order" : "Save decisions"}
          </button>
          <button
            type="button"
            onClick={() => setDialog("decline")}
            disabled={actionPending !== null}
            className="h-11 flex-1 rounded-[10px] border border-danger px-4 text-sm font-semibold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          >
            Decline order
          </button>
        </div>
      )}

      {(allowedActions.includes("mark_ready") || allowedActions.includes("mark_handed_over_or_shipped") || allowedActions.includes("cancel_accepted")) && (
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          {allowedActions.includes("mark_ready") && (
            <button
              type="button"
              onClick={handleMarkReady}
              disabled={actionPending !== null}
              className="h-11 flex-1 rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {actionPending === "mark_ready" ? "Updating…" : "Mark ready"}
            </button>
          )}
          {allowedActions.includes("mark_handed_over_or_shipped") && (
            <button
              type="button"
              onClick={handleMarkHandedOverOrShipped}
              disabled={actionPending !== null}
              className="h-11 flex-1 rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {actionPending === "mark_handed_over_or_shipped"
                ? "Updating…"
                : order.fulfillmentMethod === "shipping"
                  ? "Mark shipped"
                  : "Mark handed over"}
            </button>
          )}
          {allowedActions.includes("cancel_accepted") && (
            <button
              type="button"
              onClick={() => setDialog("cancel_accepted")}
              disabled={actionPending !== null}
              className="h-11 flex-1 rounded-[10px] border border-danger px-4 text-sm font-semibold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              Cancel order
            </button>
          )}
        </div>
      )}

      {dialog === "decline" && (
        <ConfirmDialog
          title="Decline this order?"
          description="The buyer will be notified that you declined this order. This can't be undone."
          confirmLabel="Decline order"
          destructive
          isPending={actionPending === "decline"}
          errorMessage={actionError}
          onConfirm={handleDeclineOrder}
          onClose={closeDialog}
        />
      )}

      {dialog === "cancel_accepted" && (
        <ConfirmDialog
          title="Cancel this order?"
          description="This will cancel the order and release any reserved stock. This can't be undone."
          confirmLabel="Cancel order"
          noteLabel="Reason for cancellation"
          destructive
          isPending={actionPending === "cancel_accepted"}
          errorMessage={actionError}
          onConfirm={handleCancelAccepted}
          onClose={closeDialog}
        />
      )}

      {dialog === "resolve_approve" && (
        <ConfirmDialog
          title="Approve this cancellation?"
          description="This will cancel the order and release any reserved stock. This can't be undone."
          confirmLabel="Approve cancellation"
          destructive
          isPending={actionPending === "resolve_approve"}
          errorMessage={actionError}
          onConfirm={() => handleResolveCancellation(true, "")}
          onClose={closeDialog}
        />
      )}

      {dialog === "resolve_reject" && (
        <ConfirmDialog
          title="Reject this cancellation request?"
          description="The order will continue as normal. The buyer will see your note explaining why."
          confirmLabel="Reject request"
          noteLabel="Review note"
          isPending={actionPending === "resolve_reject"}
          errorMessage={actionError}
          onConfirm={(note) => handleResolveCancellation(false, note)}
          onClose={closeDialog}
        />
      )}
    </>
  );
}
