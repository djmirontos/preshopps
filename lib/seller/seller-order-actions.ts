import { createClient } from "@/lib/supabase/client";
import type { OrderStatus } from "@/lib/orders/order-status-copy";

/**
 * Thin client wrappers around the existing seller lifecycle RPCs
 * (accept_order_items, mark_order_ready, mark_order_handed_over_or_shipped,
 * cancel_accepted_order, resolve_order_cancellation -- all defined across
 * 0016-0026 and re-defined unchanged in signature/behavior by
 * 0040_notifications.sql). No new RPC is introduced here -- this module
 * only calls each function with a payload built entirely from ids already
 * present in the caller's own seller order detail view, and maps each
 * function's own `detail` error code (read directly from its migration
 * source, listed per-function below) to safe, non-technical copy. Every
 * RPC derives seller identity from shops.owner_id = auth.uid() itself, so
 * no shop/seller/user id is ever sent from the client.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// acceptOrderItems (accept_order_items)
// ============================================================

export type AcceptOrderItemsErrorCode =
  | "NOT_AUTHENTICATED"
  | "ORDER_NOT_FOUND"
  | "NOT_ORDER_SELLER"
  | "INVALID_ITEM_DECISIONS"
  | "DUPLICATE_ITEM_DECISION"
  | "ITEM_NOT_IN_ORDER"
  | "ITEM_ALREADY_DECIDED";

const ACCEPT_ORDER_ITEMS_ERROR_CODES: ReadonlySet<string> = new Set<AcceptOrderItemsErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_SELLER",
  "INVALID_ITEM_DECISIONS",
  "DUPLICATE_ITEM_DECISION",
  "ITEM_NOT_IN_ORDER",
  "ITEM_ALREADY_DECIDED",
]);

export const ACCEPT_ORDER_ITEMS_ERROR_MESSAGES: ErrorMap<AcceptOrderItemsErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_SELLER: "You don't have permission to act on this order.",
  INVALID_ITEM_DECISIONS: "Please decide on every item before continuing.",
  DUPLICATE_ITEM_DECISION: "Something went wrong with your selection. Please refresh and try again.",
  ITEM_NOT_IN_ORDER: "Something went wrong with your selection. Please refresh and try again.",
  ITEM_ALREADY_DECIDED: "This order has already been updated. Refreshing to show the latest status.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type AcceptOrderItemsSuccess = {
  ok: true;
  orderStatus: OrderStatus;
  wasAlreadyProcessed: boolean;
  acceptedItemIds: string[];
  declinedItemIds: string[];
  stockConflictItemIds: string[];
};

export type AcceptOrderItemsResult = AcceptOrderItemsSuccess | { ok: false; code: AcceptOrderItemsErrorCode | "UNKNOWN" };

type AcceptOrderItemsRpcRow = {
  order_id: string;
  order_status: OrderStatus;
  was_already_processed: boolean;
  accepted_item_ids: string[];
  declined_item_ids: string[];
  stock_conflict_item_ids: string[];
};

/**
 * accepted/declined ids must be exactly the pending order_item ids
 * belonging to this order -- the caller (the seller order detail page)
 * only ever sources them from that order's own already-loaded item list,
 * never from an arbitrary client-side id.
 */
export async function acceptOrderItems(
  orderId: string,
  acceptedItemIds: string[],
  declinedItemIds: string[],
): Promise<AcceptOrderItemsResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("accept_order_items", {
      p_order_id: orderId,
      p_accepted_item_ids: acceptedItemIds,
      p_declined_item_ids: declinedItemIds,
    });

    if (error) {
      console.error("accept_order_items RPC failed:", error.message);
      return { ok: false, code: toErrorCode<AcceptOrderItemsErrorCode>((error as { details?: string }).details, ACCEPT_ORDER_ITEMS_ERROR_CODES) };
    }

    const row = ((data ?? []) as AcceptOrderItemsRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return {
      ok: true,
      orderStatus: row.order_status,
      wasAlreadyProcessed: row.was_already_processed,
      acceptedItemIds: row.accepted_item_ids,
      declinedItemIds: row.declined_item_ids,
      stockConflictItemIds: row.stock_conflict_item_ids,
    };
  } catch (err) {
    console.error("accept_order_items RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// markOrderReady (mark_order_ready)
// ============================================================

export type MarkOrderReadyErrorCode = "NOT_AUTHENTICATED" | "ORDER_NOT_FOUND" | "NOT_ORDER_SELLER" | "ORDER_NOT_READYABLE" | "CANCELLATION_REQUEST_PENDING";

const MARK_ORDER_READY_ERROR_CODES: ReadonlySet<string> = new Set<MarkOrderReadyErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_SELLER",
  "ORDER_NOT_READYABLE",
  "CANCELLATION_REQUEST_PENDING",
]);

export const MARK_ORDER_READY_ERROR_MESSAGES: ErrorMap<MarkOrderReadyErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_SELLER: "You don't have permission to act on this order.",
  ORDER_NOT_READYABLE: "This order can no longer be marked ready. Refreshing to show the latest status.",
  CANCELLATION_REQUEST_PENDING: "Resolve the buyer's pending cancellation request before continuing.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type MarkOrderReadyResult =
  | { ok: true; orderStatus: OrderStatus; wasAlreadyReady: boolean }
  | { ok: false; code: MarkOrderReadyErrorCode | "UNKNOWN" };

type MarkOrderReadyRpcRow = { order_id: string; order_status: OrderStatus; was_already_ready: boolean; ready_at: string };

export async function markOrderReady(orderId: string): Promise<MarkOrderReadyResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("mark_order_ready", { p_order_id: orderId });

    if (error) {
      console.error("mark_order_ready RPC failed:", error.message);
      return { ok: false, code: toErrorCode<MarkOrderReadyErrorCode>((error as { details?: string }).details, MARK_ORDER_READY_ERROR_CODES) };
    }

    const row = ((data ?? []) as MarkOrderReadyRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, orderStatus: row.order_status, wasAlreadyReady: row.was_already_ready };
  } catch (err) {
    console.error("mark_order_ready RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// markOrderHandedOverOrShipped (mark_order_handed_over_or_shipped)
// ============================================================

export type MarkOrderHandedOverOrShippedErrorCode =
  | "NOT_AUTHENTICATED"
  | "ORDER_NOT_FOUND"
  | "NOT_ORDER_SELLER"
  | "ORDER_NOT_HANDOVERABLE"
  | "CANCELLATION_REQUEST_PENDING";

const MARK_ORDER_HANDED_OVER_OR_SHIPPED_ERROR_CODES: ReadonlySet<string> = new Set<MarkOrderHandedOverOrShippedErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_SELLER",
  "ORDER_NOT_HANDOVERABLE",
  "CANCELLATION_REQUEST_PENDING",
]);

export const MARK_ORDER_HANDED_OVER_OR_SHIPPED_ERROR_MESSAGES: ErrorMap<MarkOrderHandedOverOrShippedErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_SELLER: "You don't have permission to act on this order.",
  ORDER_NOT_HANDOVERABLE: "This order can no longer be updated. Refreshing to show the latest status.",
  CANCELLATION_REQUEST_PENDING: "Resolve the buyer's pending cancellation request before continuing.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type MarkOrderHandedOverOrShippedResult =
  | { ok: true; orderStatus: OrderStatus; wasAlreadyHandedOverOrShipped: boolean }
  | { ok: false; code: MarkOrderHandedOverOrShippedErrorCode | "UNKNOWN" };

type MarkOrderHandedOverOrShippedRpcRow = {
  order_id: string;
  order_status: OrderStatus;
  was_already_handed_over_or_shipped: boolean;
  handed_over_or_shipped_at: string;
};

export async function markOrderHandedOverOrShipped(orderId: string): Promise<MarkOrderHandedOverOrShippedResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("mark_order_handed_over_or_shipped", { p_order_id: orderId });

    if (error) {
      console.error("mark_order_handed_over_or_shipped RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<MarkOrderHandedOverOrShippedErrorCode>(
          (error as { details?: string }).details,
          MARK_ORDER_HANDED_OVER_OR_SHIPPED_ERROR_CODES,
        ),
      };
    }

    const row = ((data ?? []) as MarkOrderHandedOverOrShippedRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, orderStatus: row.order_status, wasAlreadyHandedOverOrShipped: row.was_already_handed_over_or_shipped };
  } catch (err) {
    console.error("mark_order_handed_over_or_shipped RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// cancelAcceptedOrder (cancel_accepted_order)
// ============================================================

export type CancelAcceptedOrderErrorCode =
  | "NOT_AUTHENTICATED"
  | "ORDER_NOT_FOUND"
  | "NOT_ORDER_SELLER"
  | "ORDER_NOT_CANCELLABLE"
  | "INVALID_CANCELLATION_REASON";

const CANCEL_ACCEPTED_ORDER_ERROR_CODES: ReadonlySet<string> = new Set<CancelAcceptedOrderErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_SELLER",
  "ORDER_NOT_CANCELLABLE",
  "INVALID_CANCELLATION_REASON",
]);

export const CANCEL_ACCEPTED_ORDER_ERROR_MESSAGES: ErrorMap<CancelAcceptedOrderErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_SELLER: "You don't have permission to act on this order.",
  ORDER_NOT_CANCELLABLE: "This order can no longer be cancelled. Refreshing to show the latest status.",
  INVALID_CANCELLATION_REASON: "Please provide a cancellation reason.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type CancelAcceptedOrderResult =
  | { ok: true; orderStatus: OrderStatus; wasAlreadyCancelled: boolean }
  | { ok: false; code: CancelAcceptedOrderErrorCode | "UNKNOWN" };

type CancelAcceptedOrderRpcRow = { order_id: string; order_status: OrderStatus; was_already_cancelled: boolean; cancelled_at: string };

export async function cancelAcceptedOrder(orderId: string, reason: string): Promise<CancelAcceptedOrderResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("cancel_accepted_order", { p_order_id: orderId, p_reason: reason });

    if (error) {
      console.error("cancel_accepted_order RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<CancelAcceptedOrderErrorCode>((error as { details?: string }).details, CANCEL_ACCEPTED_ORDER_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as CancelAcceptedOrderRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, orderStatus: row.order_status, wasAlreadyCancelled: row.was_already_cancelled };
  } catch (err) {
    console.error("cancel_accepted_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// resolveOrderCancellation (resolve_order_cancellation)
// ============================================================

export type ResolveOrderCancellationErrorCode =
  | "NOT_AUTHENTICATED"
  | "REQUEST_NOT_FOUND"
  | "NOT_ORDER_SELLER"
  | "REQUEST_ALREADY_RESOLVED"
  | "ORDER_NOT_CANCELLABLE"
  | "INVALID_REVIEW_NOTE";

const RESOLVE_ORDER_CANCELLATION_ERROR_CODES: ReadonlySet<string> = new Set<ResolveOrderCancellationErrorCode>([
  "NOT_AUTHENTICATED",
  "REQUEST_NOT_FOUND",
  "NOT_ORDER_SELLER",
  "REQUEST_ALREADY_RESOLVED",
  "ORDER_NOT_CANCELLABLE",
  "INVALID_REVIEW_NOTE",
]);

export const RESOLVE_ORDER_CANCELLATION_ERROR_MESSAGES: ErrorMap<ResolveOrderCancellationErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  REQUEST_NOT_FOUND: "This cancellation request could not be found.",
  NOT_ORDER_SELLER: "You don't have permission to act on this request.",
  REQUEST_ALREADY_RESOLVED: "This request has already been resolved. Refreshing to show the latest status.",
  ORDER_NOT_CANCELLABLE: "This order can no longer be acted on. Refreshing to show the latest status.",
  INVALID_REVIEW_NOTE: "Please provide a note explaining why you're rejecting this request.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type ResolveOrderCancellationResult =
  | {
      ok: true;
      requestStatus: "confirmed" | "rejected";
      orderStatus: OrderStatus;
      wasAlreadyResolved: boolean;
    }
  | { ok: false; code: ResolveOrderCancellationErrorCode | "UNKNOWN" };

type ResolveOrderCancellationRpcRow = {
  request_id: string;
  order_id: string;
  request_status: "pending" | "confirmed" | "rejected";
  order_status: OrderStatus;
  was_already_resolved: boolean;
  reviewed_at: string;
};

/**
 * p_confirm true cancels the order (approving the buyer's request);
 * p_confirm false rejects it, in which case p_review_note is required
 * (non-blank) by the RPC itself.
 */
export async function resolveOrderCancellation(
  requestId: string,
  confirm: boolean,
  reviewNote: string | null,
): Promise<ResolveOrderCancellationResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("resolve_order_cancellation", {
      p_request_id: requestId,
      p_confirm: confirm,
      p_review_note: reviewNote,
    });

    if (error) {
      console.error("resolve_order_cancellation RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<ResolveOrderCancellationErrorCode>(
          (error as { details?: string }).details,
          RESOLVE_ORDER_CANCELLATION_ERROR_CODES,
        ),
      };
    }

    const row = ((data ?? []) as ResolveOrderCancellationRpcRow[])[0];
    if (!row || row.request_status === "pending") {
      return { ok: false, code: "UNKNOWN" };
    }

    return {
      ok: true,
      requestStatus: row.request_status,
      orderStatus: row.order_status,
      wasAlreadyResolved: row.was_already_resolved,
    };
  } catch (err) {
    console.error("resolve_order_cancellation RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
