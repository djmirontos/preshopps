import type { NotificationItem, NotificationType } from "@/lib/notifications/get-my-notifications";

/**
 * Centralized notification title/message/destination mapping -- the single
 * source of truth so no component hardcodes per-type strings or routing
 * logic. Backend remains authoritative: every fact used here (actor name,
 * order code, listing title) comes straight from get_my_notifications'
 * own projection (0040_notifications.sql); nothing is invented.
 */
export function getNotificationTitle(type: NotificationType): string {
  switch (type) {
    case "order_request_received":
      return "New order request";
    case "order_accepted":
      return "Order accepted";
    case "order_declined":
      return "Order declined";
    case "order_changes_pending":
      return "Order partially accepted";
    case "order_ready":
      return "Order ready";
    case "order_handed_over_or_shipped":
      return "Order handed over or shipped";
    case "order_completed":
      return "Order completed";
    case "order_cancelled":
      return "Order cancelled";
    case "order_cancellation_requested":
      return "Cancellation requested";
    case "order_cancellation_rejected":
      return "Cancellation request rejected";
    case "order_expired":
      return "Order expired";
    case "new_message":
      return "New message";
    case "new_review":
      return "New review";
    case "review_reply":
      return "Seller replied to your review";
  }
}

/**
 * Concise, restrained message text using only fields get_my_notifications
 * already returns. Never references a raw id/UUID.
 */
export function getNotificationMessage(item: NotificationItem): string {
  const code = item.orderPublicCode;
  const actor = item.actorDisplayName ?? "Someone";

  switch (item.type) {
    case "order_request_received":
      return code ? `${actor} placed an order (${code}).` : `${actor} placed an order.`;
    case "order_accepted":
      return code ? `Your order ${code} was accepted.` : "Your order was accepted.";
    case "order_declined":
      return code ? `Your order ${code} was declined.` : "Your order was declined.";
    case "order_changes_pending":
      return code
        ? `The seller partially accepted order ${code}. Review and confirm to continue.`
        : "The seller partially accepted your order. Review and confirm to continue.";
    case "order_ready":
      return code ? `Your order ${code} is ready.` : "Your order is ready.";
    case "order_handed_over_or_shipped":
      return code ? `Your order ${code} has been handed over or shipped.` : "Your order has been handed over or shipped.";
    case "order_completed":
      return code ? `Order ${code} is complete.` : "An order is complete.";
    case "order_cancelled":
      return code ? `Your order ${code} was cancelled.` : "Your order was cancelled.";
    case "order_cancellation_requested":
      return code ? `${actor} requested to cancel order ${code}.` : `${actor} requested to cancel an order.`;
    case "order_cancellation_rejected":
      return code ? `The seller rejected your cancellation request for order ${code}.` : "The seller rejected your cancellation request.";
    case "order_expired":
      return code ? `Your order ${code} expired without a response.` : "Your order expired without a response.";
    case "new_message":
      return item.conversationListingTitle ? `${actor} sent you a message about ${item.conversationListingTitle}.` : `${actor} sent you a message.`;
    case "new_review":
      return `${actor} left a review on your shop.`;
    case "review_reply":
      return "The seller replied to your review.";
  }
}

/**
 * Safe destination route, or null when it cannot be derived without
 * guessing. Every non-null case below is backed by a role that is
 * deterministic from `type` alone (verified against every notification
 * INSERT site in 0040_notifications.sql):
 *
 * - Seller-only types (the recipient is always the shop owner):
 *   order_request_received, order_cancellation_requested -> /seller/orders/{code}
 * - Buyer-only types (the recipient is always the order's buyer):
 *   order_accepted, order_declined, order_changes_pending, order_ready,
 *   order_handed_over_or_shipped, order_cancelled,
 *   order_cancellation_rejected, order_expired -> /orders/{code}
 * - new_message routes to /messages/{conversationId} regardless of
 *   whether the viewer is the conversation's initiator or the shop owner
 *   -- the route itself doesn't depend on role.
 *
 * Deliberately no link (return null) for:
 * - order_completed: complete_order notifies BOTH the buyer and the
 *   seller with the identical type value and no role indicator in the
 *   returned row -- there is no safe way to know from this notification
 *   alone whether *this* viewer should land on /orders or /seller/orders,
 *   and guessing would send the wrong party to a page where their own
 *   order is invisible. Reported as a known limitation, not silently
 *   guessed.
 * - new_review / review_reply: get_my_notifications returns only
 *   review_id, with no shop slug or order code to route to -- no reviews
 *   UI exists in this module's scope either.
 */
export function getNotificationHref(item: NotificationItem): string | null {
  switch (item.type) {
    case "order_request_received":
    case "order_cancellation_requested":
      return item.orderPublicCode ? `/seller/orders/${item.orderPublicCode}` : null;
    case "order_accepted":
    case "order_declined":
    case "order_changes_pending":
    case "order_ready":
    case "order_handed_over_or_shipped":
    case "order_cancelled":
    case "order_cancellation_rejected":
    case "order_expired":
      return item.orderPublicCode ? `/orders/${item.orderPublicCode}` : null;
    case "new_message":
      return item.conversationId ? `/messages/${item.conversationId}` : null;
    case "order_completed":
    case "new_review":
    case "review_reply":
      return null;
  }
}
