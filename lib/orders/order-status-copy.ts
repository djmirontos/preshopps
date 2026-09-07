import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

/** Exactly the ten values of public.order_status_enum (0002_enums.sql) --
 * never invent an eleventh. */
export type OrderStatus =
  | "pending"
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
 * into two statuses in the database. It reads more naturally to a buyer as
 * either "Handed Over" or "Shipped" depending on how the order is actually
 * being fulfilled, which get_my_orders/get_my_order_detail already return
 * alongside status (orders.fulfillment_method). This is a display-only
 * distinction, not an invented status.
 */
export function getOrderStatusLabel(status: OrderStatus, fulfillmentMethod: FulfillmentMethod): string {
  if (status === "handed_over_or_shipped") {
    return fulfillmentMethod === "shipping" ? "Shipped" : "Handed Over";
  }
  return STATUS_LABELS[status];
}

export function getOrderStatusGuidance(status: OrderStatus, fulfillmentMethod: FulfillmentMethod): string {
  switch (status) {
    case "pending":
      return "Waiting for the seller to review your order.";
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
