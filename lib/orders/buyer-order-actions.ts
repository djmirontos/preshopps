import { createClient } from "@/lib/supabase/client";
import type { OrderStatus } from "@/lib/orders/order-status-copy";

/**
 * Thin client wrappers around the existing buyer lifecycle RPCs
 * (cancel_pending_order [0020], request_order_cancellation [0040],
 * confirm_order_received [0044], confirm_order_changes [0017],
 * cancel_order_changes [0019]). No new RPC is introduced here -- this
 * module only calls each function with the order id (plus a reason for
 * request_order_cancellation) and maps each function's own `detail` error
 * code (read directly from its migration source, listed per-function
 * below) to safe, non-technical copy. Every RPC derives buyer identity
 * from orders.buyer_id = auth.uid() itself, so no buyer/user/shop id is
 * ever sent from the client.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// cancelPendingOrder (cancel_pending_order)
// ============================================================

export type CancelPendingOrderErrorCode = "NOT_AUTHENTICATED" | "ORDER_NOT_FOUND" | "NOT_ORDER_BUYER" | "ORDER_NOT_CANCELLABLE" | "RESERVATION_ALREADY_EXISTS";

const CANCEL_PENDING_ORDER_ERROR_CODES: ReadonlySet<string> = new Set<CancelPendingOrderErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_BUYER",
  "ORDER_NOT_CANCELLABLE",
  "RESERVATION_ALREADY_EXISTS",
]);

export const CANCEL_PENDING_ORDER_ERROR_MESSAGES: ErrorMap<CancelPendingOrderErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_BUYER: "You don't have permission to act on this order.",
  ORDER_NOT_CANCELLABLE: "This order can no longer be cancelled. Refreshing to show the latest status.",
  RESERVATION_ALREADY_EXISTS: "This order can't be cancelled right now. Please try again shortly.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type CancelPendingOrderResult =
  | { ok: true; orderStatus: OrderStatus; wasAlreadyCancelled: boolean }
  | { ok: false; code: CancelPendingOrderErrorCode | "UNKNOWN" };

type CancelOrderRpcRow = { order_id: string; order_status: OrderStatus; was_already_cancelled: boolean };

export async function cancelPendingOrder(orderId: string): Promise<CancelPendingOrderResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("cancel_pending_order", { p_order_id: orderId });

    if (error) {
      console.error("cancel_pending_order RPC failed:", error.message);
      return { ok: false, code: toErrorCode<CancelPendingOrderErrorCode>((error as { details?: string }).details, CANCEL_PENDING_ORDER_ERROR_CODES) };
    }

    const row = ((data ?? []) as CancelOrderRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, orderStatus: row.order_status, wasAlreadyCancelled: row.was_already_cancelled };
  } catch (err) {
    console.error("cancel_pending_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// cancelOrderChanges (cancel_order_changes)
// ============================================================

export type CancelOrderChangesErrorCode = "NOT_AUTHENTICATED" | "ORDER_NOT_FOUND" | "NOT_ORDER_BUYER" | "ORDER_NOT_CANCELLABLE" | "RESERVATION_ALREADY_EXISTS";

const CANCEL_ORDER_CHANGES_ERROR_CODES: ReadonlySet<string> = new Set<CancelOrderChangesErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_BUYER",
  "ORDER_NOT_CANCELLABLE",
  "RESERVATION_ALREADY_EXISTS",
]);

export const CANCEL_ORDER_CHANGES_ERROR_MESSAGES: ErrorMap<CancelOrderChangesErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_BUYER: "You don't have permission to act on this order.",
  ORDER_NOT_CANCELLABLE: "This order can no longer be cancelled. Refreshing to show the latest status.",
  RESERVATION_ALREADY_EXISTS: "This order can't be cancelled right now. Please try again shortly.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type CancelOrderChangesResult =
  | { ok: true; orderStatus: OrderStatus; wasAlreadyCancelled: boolean }
  | { ok: false; code: CancelOrderChangesErrorCode | "UNKNOWN" };

export async function cancelOrderChanges(orderId: string): Promise<CancelOrderChangesResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("cancel_order_changes", { p_order_id: orderId });

    if (error) {
      console.error("cancel_order_changes RPC failed:", error.message);
      return { ok: false, code: toErrorCode<CancelOrderChangesErrorCode>((error as { details?: string }).details, CANCEL_ORDER_CHANGES_ERROR_CODES) };
    }

    const row = ((data ?? []) as CancelOrderRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, orderStatus: row.order_status, wasAlreadyCancelled: row.was_already_cancelled };
  } catch (err) {
    console.error("cancel_order_changes RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// confirmOrderChanges (confirm_order_changes)
// ============================================================

export type ConfirmOrderChangesErrorCode =
  | "NOT_AUTHENTICATED"
  | "ORDER_NOT_FOUND"
  | "NOT_ORDER_BUYER"
  | "ORDER_NOT_CONFIRMABLE"
  | "INVALID_ORDER_ITEM_STATE"
  | "RESERVATION_ALREADY_EXISTS"
  | "ORDER_NO_LONGER_FULFILLABLE";

const CONFIRM_ORDER_CHANGES_ERROR_CODES: ReadonlySet<string> = new Set<ConfirmOrderChangesErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_BUYER",
  "ORDER_NOT_CONFIRMABLE",
  "INVALID_ORDER_ITEM_STATE",
  "RESERVATION_ALREADY_EXISTS",
  "ORDER_NO_LONGER_FULFILLABLE",
]);

export const CONFIRM_ORDER_CHANGES_ERROR_MESSAGES: ErrorMap<ConfirmOrderChangesErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_BUYER: "You don't have permission to act on this order.",
  ORDER_NOT_CONFIRMABLE: "This order is no longer awaiting your confirmation. Refreshing to show the latest status.",
  INVALID_ORDER_ITEM_STATE: "Something went wrong with this order. Please try again.",
  RESERVATION_ALREADY_EXISTS: "This order can't be confirmed right now. Please try again shortly.",
  ORDER_NO_LONGER_FULFILLABLE: "One or more items are no longer available. Please review the order.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type ConfirmOrderChangesResult =
  | { ok: true; orderStatus: OrderStatus; wasAlreadyConfirmed: boolean; acceptedItemIds: string[]; declinedItemIds: string[] }
  | { ok: false; code: ConfirmOrderChangesErrorCode | "UNKNOWN" };

type ConfirmOrderChangesRpcRow = {
  order_id: string;
  order_status: OrderStatus;
  was_already_confirmed: boolean;
  accepted_item_ids: string[];
  declined_item_ids: string[];
};

export async function confirmOrderChanges(orderId: string): Promise<ConfirmOrderChangesResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("confirm_order_changes", { p_order_id: orderId });

    if (error) {
      console.error("confirm_order_changes RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<ConfirmOrderChangesErrorCode>((error as { details?: string }).details, CONFIRM_ORDER_CHANGES_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as ConfirmOrderChangesRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return {
      ok: true,
      orderStatus: row.order_status,
      wasAlreadyConfirmed: row.was_already_confirmed,
      acceptedItemIds: row.accepted_item_ids,
      declinedItemIds: row.declined_item_ids,
    };
  } catch (err) {
    console.error("confirm_order_changes RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// requestOrderCancellation (request_order_cancellation)
// ============================================================

export type RequestOrderCancellationErrorCode = "NOT_AUTHENTICATED" | "ORDER_NOT_FOUND" | "NOT_ORDER_BUYER" | "ORDER_NOT_CANCELLABLE" | "INVALID_CANCELLATION_REASON";

const REQUEST_ORDER_CANCELLATION_ERROR_CODES: ReadonlySet<string> = new Set<RequestOrderCancellationErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_BUYER",
  "ORDER_NOT_CANCELLABLE",
  "INVALID_CANCELLATION_REASON",
]);

export const REQUEST_ORDER_CANCELLATION_ERROR_MESSAGES: ErrorMap<RequestOrderCancellationErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_BUYER: "You don't have permission to act on this order.",
  ORDER_NOT_CANCELLABLE: "This order can no longer be cancelled. Refreshing to show the latest status.",
  INVALID_CANCELLATION_REASON: "Please provide a reason for the cancellation request.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type RequestOrderCancellationResult =
  | { ok: true; requestId: string; wasAlreadyPending: boolean }
  | { ok: false; code: RequestOrderCancellationErrorCode | "UNKNOWN" };

type RequestOrderCancellationRpcRow = {
  request_id: string;
  order_id: string;
  request_status: "pending" | "confirmed" | "rejected";
  was_already_pending: boolean;
  requested_at: string;
};

/**
 * Idempotent on the backend: calling this again while a request is already
 * pending returns the existing request rather than erroring. The buyer
 * UI still hides this action once a pending request exists (see
 * getAllowedBuyerActions) to avoid inviting a redundant submission, but a
 * duplicate call arriving anyway (e.g. a stale UI state) is still safe.
 */
export async function requestOrderCancellation(orderId: string, reason: string): Promise<RequestOrderCancellationResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("request_order_cancellation", { p_order_id: orderId, p_reason: reason });

    if (error) {
      console.error("request_order_cancellation RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<RequestOrderCancellationErrorCode>((error as { details?: string }).details, REQUEST_ORDER_CANCELLATION_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as RequestOrderCancellationRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, requestId: row.request_id, wasAlreadyPending: row.was_already_pending };
  } catch (err) {
    console.error("request_order_cancellation RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// confirmOrderReceived (confirm_order_received)
// ============================================================

export type ConfirmOrderReceivedErrorCode = "NOT_AUTHENTICATED" | "ORDER_NOT_FOUND" | "NOT_ORDER_BUYER" | "ORDER_NOT_RECEIVABLE";

const CONFIRM_ORDER_RECEIVED_ERROR_CODES: ReadonlySet<string> = new Set<ConfirmOrderReceivedErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_BUYER",
  "ORDER_NOT_RECEIVABLE",
]);

export const CONFIRM_ORDER_RECEIVED_ERROR_MESSAGES: ErrorMap<ConfirmOrderReceivedErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_BUYER: "You don't have permission to act on this order.",
  ORDER_NOT_RECEIVABLE: "This order can no longer be confirmed. Refreshing to show the latest status.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type ConfirmOrderReceivedResult =
  | { ok: true; orderStatus: OrderStatus; wasAlreadyReceivedConfirmed: boolean }
  | { ok: false; code: ConfirmOrderReceivedErrorCode | "UNKNOWN" };

type ConfirmOrderReceivedRpcRow = {
  order_id: string;
  order_status: OrderStatus;
  was_already_received_confirmed: boolean;
  received_confirmed_at: string;
};

/**
 * Per 0044_confirm_order_received_auto_complete.sql, a fresh confirmation
 * now attempts completion synchronously in the same call -- order_status
 * in the returned row may already be 'completed', not just
 * 'received_confirmed'. There is no separate "Complete" action anywhere in
 * this module; the resulting canonical status is whatever this call (plus
 * a subsequent refresh) reports.
 */
export async function confirmOrderReceived(orderId: string): Promise<ConfirmOrderReceivedResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("confirm_order_received", { p_order_id: orderId });

    if (error) {
      console.error("confirm_order_received RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<ConfirmOrderReceivedErrorCode>((error as { details?: string }).details, CONFIRM_ORDER_RECEIVED_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as ConfirmOrderReceivedRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, orderStatus: row.order_status, wasAlreadyReceivedConfirmed: row.was_already_received_confirmed };
  } catch (err) {
    console.error("confirm_order_received RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
