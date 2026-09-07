import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

/**
 * Exactly the eleven values of public.order_status_enum -- confirmed
 * against the LIVE enum (not just the original 0002_enums.sql definition,
 * which only had ten; 'changes_pending' was added afterward by
 * 0015_partial_acceptance_state.sql). Never invent a twelfth.
 */
export type OrderStatus =
  | "pending"
  | "changes_pending"
  | "accepted"
  | "ready"
  | "handed_over_or_shipped"
  | "received_confirmed"
  | "completed"
  | "declined"
  | "cancelled"
  | "expired"
  | "disputed";

/** Exactly the three values of public.order_item_status_enum. */
export type OrderItemStatus = "pending" | "accepted" | "declined";

const STATUS_LABELS: Record<Exclude<OrderStatus, "handed_over_or_shipped">, string> = {
  pending: "Pending",
  changes_pending: "Changes Pending",
  accepted: "Accepted",
  ready: "Ready",
  received_confirmed: "Buyer Confirms Received",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  disputed: "Disputed",
};

/**
 * handed_over_or_shipped is one canonical enum value -- it is never split
 * into two statuses in the database. It reads more naturally to either
 * party as "Handed Over" or "Shipped" depending on how the order is
 * actually being fulfilled, which every order RPC already returns
 * alongside status (orders.fulfillment_method). This is a display-only
 * distinction, not an invented status.
 */
export function getOrderStatusLabel(status: OrderStatus, fulfillmentMethod: FulfillmentMethod): string {
  if (status === "handed_over_or_shipped") {
    return fulfillmentMethod === "shipping" ? "Shipped" : "Handed Over";
  }
  return STATUS_LABELS[status];
}

/** Buyer-facing guidance copy. */
export function getOrderStatusGuidance(status: OrderStatus, fulfillmentMethod: FulfillmentMethod): string {
  switch (status) {
    case "pending":
      return "Waiting for the seller to review your order.";
    case "changes_pending":
      return "The seller partially accepted your order. Review and confirm to continue with the remaining items.";
    case "accepted":
      return "The seller has accepted your order.";
    case "ready":
      return "Your order is ready for pickup or handover.";
    case "handed_over_or_shipped":
      return fulfillmentMethod === "shipping"
        ? "The seller marked this order as shipped."
        : "The seller marked this order as handed over.";
    case "received_confirmed":
      return "You've confirmed receiving this order.";
    case "completed":
      return "This order is complete.";
    case "declined":
      return "The seller declined this order.";
    case "cancelled":
      return "This order was cancelled.";
    case "expired":
      return "This order expired without a response from the seller.";
    case "disputed":
      return "This order is under dispute.";
  }
}

/**
 * Seller-facing guidance copy -- deliberately worded from the seller's own
 * perspective, unlike getOrderStatusGuidance above. Kept in this same
 * module (rather than a separate seller-only file) so every status/label/
 * guidance fact about order_status_enum lives in exactly one place.
 */
export function getSellerOrderStatusGuidance(status: OrderStatus, fulfillmentMethod: FulfillmentMethod): string {
  switch (status) {
    case "pending":
      return "Review this order and accept or decline the items.";
    case "changes_pending":
      return "Waiting for the buyer to confirm the accepted items.";
    case "accepted":
      return "You've accepted this order. Mark it ready once it's prepared.";
    case "ready":
      return fulfillmentMethod === "shipping"
        ? "Ready to ship. Mark it shipped once it's sent."
        : "Ready for pickup or handover.";
    case "handed_over_or_shipped":
      return fulfillmentMethod === "shipping"
        ? "Marked as shipped. Waiting for the buyer to confirm receipt."
        : "Marked as handed over. Waiting for the buyer to confirm receipt.";
    case "received_confirmed":
      return "The buyer confirmed receipt. This order will complete automatically.";
    case "completed":
      return "This order is complete.";
    case "declined":
      return "You declined this order.";
    case "cancelled":
      return "This order was cancelled.";
    case "expired":
      return "This order expired without a response.";
    case "disputed":
      return "This order is under dispute.";
  }
}

/** Used only to pick a Badge tone -- guidance/label text is always present
 * too, so status is never communicated by color alone. */
export function isPositiveOrderStatus(status: OrderStatus): boolean {
  return (
    status === "accepted" ||
    status === "ready" ||
    status === "handed_over_or_shipped" ||
    status === "received_confirmed" ||
    status === "completed"
  );
}

/**
 * Centralized seller lifecycle-action model -- the single source of truth
 * for "what can a seller actually do with this order right now", derived
 * from exactly the lifecycle rules the existing backend RPCs already
 * enforce (never invented here):
 *
 * - pending: only accept_order_items exists for the seller (it covers
 *   both accept and full-decline -- a whole-order "Decline" is simply
 *   accept_order_items with every pending item declined).
 * - accepted/ready: mark_order_ready / mark_order_handed_over_or_shipped
 *   progress the order; cancel_accepted_order lets the seller cancel
 *   directly (reason required) from either state. Both progression RPCs
 *   (mark_order_ready, mark_order_handed_over_or_shipped) reject the call
 *   outright with CANCELLATION_REQUEST_PENDING while a pending buyer
 *   cancellation request exists, so progression actions are hidden (not
 *   merely disabled) whenever hasPendingCancellationRequest is true --
 *   resolve_order_cancellation must be used first. cancel_accepted_order
 *   itself has no such guard (it auto-resolves the pending request as a
 *   side effect), so it remains available either way.
 * - handed_over_or_shipped: the next transition (received_confirmed) is a
 *   buyer-only action (confirm_order_received) -- the seller has nothing
 *   to do but wait.
 * - received_confirmed: completion (complete_order) is granted only to a
 *   trusted backend/system role and has no auth.uid() check at all
 *   (confirmed live) -- it cannot be called by any human caller, seller
 *   included. The seller has no action here either.
 * - changes_pending/completed/declined/cancelled/expired/disputed: no
 *   seller action exists for any of these in the current backend.
 */
export type SellerAction = "decide_items" | "mark_ready" | "mark_handed_over_or_shipped" | "cancel_accepted" | "resolve_cancellation";

export function getAllowedSellerActions(status: OrderStatus, hasPendingCancellationRequest: boolean): SellerAction[] {
  switch (status) {
    case "pending":
      return ["decide_items"];
    case "accepted":
      return hasPendingCancellationRequest ? ["resolve_cancellation", "cancel_accepted"] : ["mark_ready", "cancel_accepted"];
    case "ready":
      return hasPendingCancellationRequest
        ? ["resolve_cancellation", "cancel_accepted"]
        : ["mark_handed_over_or_shipped", "cancel_accepted"];
    default:
      return [];
  }
}
