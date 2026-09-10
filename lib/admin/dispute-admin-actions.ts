import { createClient } from "@/lib/supabase/client";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// add_dispute_admin_note
// ============================================================
export type AddDisputeAdminNoteErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "DISPUTE_NOT_FOUND" | "NOTE_REQUIRED" | "NOTE_TOO_LONG";

const ADD_NOTE_ERROR_CODES: ReadonlySet<string> = new Set<AddDisputeAdminNoteErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "DISPUTE_NOT_FOUND",
  "NOTE_REQUIRED",
  "NOTE_TOO_LONG",
]);

export const ADD_DISPUTE_ADMIN_NOTE_ERROR_MESSAGES: ErrorMap<AddDisputeAdminNoteErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  DISPUTE_NOT_FOUND: "We couldn't find this dispute. Please refresh and try again.",
  NOTE_REQUIRED: "Please enter a note.",
  NOTE_TOO_LONG: "Please shorten the note.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type AddDisputeAdminNoteResult =
  | { ok: true; noteId: string; createdAt: string }
  | { ok: false; code: AddDisputeAdminNoteErrorCode | "UNKNOWN" };

export async function addDisputeAdminNote(disputeId: string, note: string): Promise<AddDisputeAdminNoteResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("add_dispute_admin_note", { p_dispute_id: disputeId, p_note: note });
    if (error) {
      console.error("add_dispute_admin_note RPC failed:", error.message);
      return { ok: false, code: toErrorCode<AddDisputeAdminNoteErrorCode>((error as { details?: string }).details, ADD_NOTE_ERROR_CODES) };
    }
    const row = ((data ?? []) as { note_id: string; created_at: string }[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, noteId: row.note_id, createdAt: row.created_at };
  } catch (err) {
    console.error("add_dispute_admin_note RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// update_dispute_status
// ============================================================
export type UpdateDisputeStatusErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_ADMIN"
  | "DISPUTE_NOT_FOUND"
  | "DISPUTE_ALREADY_RESOLVED"
  | "DISPUTE_STATUS_BACKWARD_NOT_ALLOWED";

const UPDATE_STATUS_ERROR_CODES: ReadonlySet<string> = new Set<UpdateDisputeStatusErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "DISPUTE_NOT_FOUND",
  "DISPUTE_ALREADY_RESOLVED",
  "DISPUTE_STATUS_BACKWARD_NOT_ALLOWED",
]);

export const UPDATE_DISPUTE_STATUS_ERROR_MESSAGES: ErrorMap<UpdateDisputeStatusErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  DISPUTE_NOT_FOUND: "We couldn't find this dispute. Please refresh and try again.",
  DISPUTE_ALREADY_RESOLVED: "This dispute is already resolved.",
  DISPUTE_STATUS_BACKWARD_NOT_ALLOWED: "A dispute cannot move backward to Opened.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type UpdateDisputeStatusResult =
  | { ok: true; status: DisputeStatus; resolvedAt: string | null }
  | { ok: false; code: UpdateDisputeStatusErrorCode | "UNKNOWN" };

export async function updateDisputeStatus(disputeId: string, status: DisputeStatus): Promise<UpdateDisputeStatusResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("update_dispute_status", { p_dispute_id: disputeId, p_status: status });
    if (error) {
      console.error("update_dispute_status RPC failed:", error.message);
      return { ok: false, code: toErrorCode<UpdateDisputeStatusErrorCode>((error as { details?: string }).details, UPDATE_STATUS_ERROR_CODES) };
    }
    const row = ((data ?? []) as { status: DisputeStatus; resolved_at: string | null }[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, status: row.status, resolvedAt: row.resolved_at };
  } catch (err) {
    console.error("update_dispute_status RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// admin_cancel_disputed_order
// ============================================================
export type AdminCancelDisputedOrderErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_ADMIN"
  | "DISPUTE_NOT_FOUND"
  | "ORDER_NOT_CANCELLABLE"
  | "INVALID_CANCELLATION_REASON"
  | "RESERVATION_STATE_INVALID";

const CANCEL_ERROR_CODES: ReadonlySet<string> = new Set<AdminCancelDisputedOrderErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "DISPUTE_NOT_FOUND",
  "ORDER_NOT_CANCELLABLE",
  "INVALID_CANCELLATION_REASON",
  "RESERVATION_STATE_INVALID",
]);

export const ADMIN_CANCEL_DISPUTED_ORDER_ERROR_MESSAGES: ErrorMap<AdminCancelDisputedOrderErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  DISPUTE_NOT_FOUND: "We couldn't find this dispute. Please refresh and try again.",
  ORDER_NOT_CANCELLABLE: "This order can't be cancelled from a dispute right now.",
  INVALID_CANCELLATION_REASON: "Please enter a cancellation reason.",
  RESERVATION_STATE_INVALID: "This order's inventory state is inconsistent. Please refresh and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type AdminCancelDisputedOrderResult =
  | { ok: true; orderId: string; orderStatus: string; cancelledAt: string }
  | { ok: false; code: AdminCancelDisputedOrderErrorCode | "UNKNOWN" };

export async function adminCancelDisputedOrder(disputeId: string, reason: string): Promise<AdminCancelDisputedOrderResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("admin_cancel_disputed_order", { p_dispute_id: disputeId, p_reason: reason });
    if (error) {
      console.error("admin_cancel_disputed_order RPC failed:", error.message);
      return { ok: false, code: toErrorCode<AdminCancelDisputedOrderErrorCode>((error as { details?: string }).details, CANCEL_ERROR_CODES) };
    }
    const row = ((data ?? []) as { order_id: string; order_status: string; cancelled_at: string }[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, orderId: row.order_id, orderStatus: row.order_status, cancelledAt: row.cancelled_at };
  } catch (err) {
    console.error("admin_cancel_disputed_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// admin_complete_disputed_order
// ============================================================
export type AdminCompleteDisputedOrderErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_ADMIN"
  | "DISPUTE_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_COMPLETABLE"
  | "RESERVATION_STATE_INVALID";

const COMPLETE_ERROR_CODES: ReadonlySet<string> = new Set<AdminCompleteDisputedOrderErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "DISPUTE_NOT_FOUND",
  "ORDER_NOT_FOUND",
  "ORDER_NOT_COMPLETABLE",
  "RESERVATION_STATE_INVALID",
]);

export const ADMIN_COMPLETE_DISPUTED_ORDER_ERROR_MESSAGES: ErrorMap<AdminCompleteDisputedOrderErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  DISPUTE_NOT_FOUND: "We couldn't find this dispute. Please refresh and try again.",
  ORDER_NOT_FOUND: "We couldn't find this order. Please refresh and try again.",
  ORDER_NOT_COMPLETABLE: "This order can't be completed right now.",
  RESERVATION_STATE_INVALID: "This order's inventory state is inconsistent. Please refresh and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type AdminCompleteDisputedOrderResult =
  | { ok: true; orderId: string; orderStatus: string; completedAt: string }
  | { ok: false; code: AdminCompleteDisputedOrderErrorCode | "UNKNOWN" };

export async function adminCompleteDisputedOrder(disputeId: string): Promise<AdminCompleteDisputedOrderResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("admin_complete_disputed_order", { p_dispute_id: disputeId });
    if (error) {
      console.error("admin_complete_disputed_order RPC failed:", error.message);
      return { ok: false, code: toErrorCode<AdminCompleteDisputedOrderErrorCode>((error as { details?: string }).details, COMPLETE_ERROR_CODES) };
    }
    const row = ((data ?? []) as { order_id: string; order_status: string; completed_at: string }[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, orderId: row.order_id, orderStatus: row.order_status, completedAt: row.completed_at };
  } catch (err) {
    console.error("admin_complete_disputed_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
