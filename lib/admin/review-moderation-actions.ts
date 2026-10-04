import { createClient } from "@/lib/supabase/client";

/**
 * Client wrappers around the Phase 1 review-moderation RPCs (0115):
 * get_admin_review_state, remove_review, restore_review. Every admin check
 * happens server-side inside each RPC. These wrappers never send a role or
 * admin flag, and they validate every successful response against the
 * expected shape for the requested review before it reaches the UI.
 *
 * For mutations, UNKNOWN means the outcome is unconfirmed (the change may or
 * may not have committed). Callers must recheck state before offering further
 * actions. An UNKNOWN is never reported as success.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

/** Matches the RPC's char_length (code points), not UTF-16 length. */
export const REVIEW_MODERATION_TEXT_MAX_LENGTH = 1000;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Trimmed text, or null when blank. Same trim the RPC applies. */
function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Exactly one row, and it must be a plain object. */
function singleRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row: unknown = data[0];
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null;
}

function isTimestampString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ============================================================
// getAdminReviewState (get_admin_review_state)
// ============================================================
export type GetAdminReviewStateErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "REVIEW_NOT_FOUND";

const GET_ADMIN_REVIEW_STATE_ERROR_CODES: ReadonlySet<string> = new Set<GetAdminReviewStateErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "REVIEW_NOT_FOUND",
]);

export const GET_ADMIN_REVIEW_STATE_ERROR_MESSAGES: ErrorMap<GetAdminReviewStateErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  REVIEW_NOT_FOUND: "This review no longer exists.",
  UNKNOWN: "Couldn't load this review's state. Please try again.",
};

export type AdminReviewState = {
  reviewId: string;
  orderId: string;
  shopId: string;
  rating: number;
  body: string | null;
  replyBody: string | null;
  replyCreatedAt: string | null;
  replyUpdatedAt: string | null;
  reviewCreatedAt: string;
  removedAt: string | null;
  imagePaths: string[];
  removalPublicMessage: string | null;
  removalPrivateNote: string | null;
};

export type GetAdminReviewStateResult =
  | { ok: true; state: AdminReviewState }
  | { ok: false; code: GetAdminReviewStateErrorCode | "UNKNOWN" };

function parseAdminReviewStateRow(data: unknown, reviewId: string): AdminReviewState | null {
  const row = singleRow(data);
  if (!row || row.review_id !== reviewId) return null;
  if (!isUuidString(row.order_id) || !isUuidString(row.shop_id)) return null;
  if (typeof row.rating !== "number" || !Number.isInteger(row.rating) || row.rating < 1 || row.rating > 5) return null;
  if (row.body !== null && typeof row.body !== "string") return null;
  if (row.reply_body !== null && typeof row.reply_body !== "string") return null;
  if (row.reply_created_at !== null && !isTimestampString(row.reply_created_at)) return null;
  if (row.reply_updated_at !== null && !isTimestampString(row.reply_updated_at)) return null;
  if (!isTimestampString(row.review_created_at)) return null;
  if (row.removed_at !== null && !isTimestampString(row.removed_at)) return null;
  if (!Array.isArray(row.image_paths) || !row.image_paths.every((p) => typeof p === "string")) return null;
  if (row.removal_public_message !== null && typeof row.removal_public_message !== "string") return null;
  if (row.removal_private_note !== null && typeof row.removal_private_note !== "string") return null;
  // Removal details are present only while the review is removed.
  if (row.removed_at === null && (row.removal_public_message !== null || row.removal_private_note !== null)) return null;

  return {
    reviewId,
    orderId: row.order_id,
    shopId: row.shop_id,
    rating: row.rating,
    body: row.body,
    replyBody: row.reply_body,
    replyCreatedAt: row.reply_created_at,
    replyUpdatedAt: row.reply_updated_at,
    reviewCreatedAt: row.review_created_at,
    removedAt: row.removed_at,
    imagePaths: row.image_paths as string[],
    removalPublicMessage: row.removal_public_message,
    removalPrivateNote: row.removal_private_note,
  };
}

export async function getAdminReviewState(reviewId: string): Promise<GetAdminReviewStateResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_admin_review_state", { p_review_id: reviewId });

    if (error) {
      console.error("get_admin_review_state RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<GetAdminReviewStateErrorCode>((error as { details?: string }).details, GET_ADMIN_REVIEW_STATE_ERROR_CODES),
      };
    }

    const state = parseAdminReviewStateRow(data, reviewId);
    if (!state) {
      console.error("get_admin_review_state returned a malformed response");
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, state };
  } catch (err) {
    console.error("get_admin_review_state RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// removeReview (remove_review)
// ============================================================
export type RemoveReviewErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_ADMIN"
  | "REASON_REQUIRED"
  | "REASON_TOO_LONG"
  | "NOTE_TOO_LONG"
  | "REVIEW_NOT_FOUND";

const REMOVE_REVIEW_ERROR_CODES: ReadonlySet<string> = new Set<RemoveReviewErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "REASON_REQUIRED",
  "REASON_TOO_LONG",
  "NOTE_TOO_LONG",
  "REVIEW_NOT_FOUND",
]);

/** UNKNOWN for a mutation means the outcome is unconfirmed, not failed. */
export const REMOVE_REVIEW_ERROR_MESSAGES: ErrorMap<RemoveReviewErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  REASON_REQUIRED: "Please enter a reason the buyer will see.",
  REASON_TOO_LONG: `Please keep the reason to ${REVIEW_MODERATION_TEXT_MAX_LENGTH} characters or fewer.`,
  NOTE_TOO_LONG: `Please keep the private note to ${REVIEW_MODERATION_TEXT_MAX_LENGTH} characters or fewer.`,
  REVIEW_NOT_FOUND: "This review no longer exists.",
  UNKNOWN: "Couldn't confirm this change. Recheck the review's state before trying again.",
};

export type RemoveReviewResult =
  | { ok: true; reviewId: string; removedAt: string; wasAlreadyRemoved: boolean }
  | { ok: false; code: RemoveReviewErrorCode | "UNKNOWN" };

type RemoveParse = { removedAt: string; wasAlreadyRemoved: boolean } | null;

function parseRemoveRow(data: unknown, reviewId: string): RemoveParse {
  const row = singleRow(data);
  if (!row || row.review_id !== reviewId) return null;
  if (!isTimestampString(row.removed_at)) return null;
  if (typeof row.was_already_removed !== "boolean") return null;
  // A genuine removal creates an audit row; an idempotent repeat does not.
  if (row.was_already_removed) {
    if (row.audit_id !== null) return null;
  } else if (!isUuidString(row.audit_id)) {
    return null;
  }
  return { removedAt: row.removed_at, wasAlreadyRemoved: row.was_already_removed };
}

export async function removeReview(reviewId: string, publicMessage: string, privateNote: string | null): Promise<RemoveReviewResult> {
  const message = trimOrNull(publicMessage);
  if (message === null) return { ok: false, code: "REASON_REQUIRED" };
  if (codePointLength(message) > REVIEW_MODERATION_TEXT_MAX_LENGTH) return { ok: false, code: "REASON_TOO_LONG" };
  const note = trimOrNull(privateNote);
  if (note !== null && codePointLength(note) > REVIEW_MODERATION_TEXT_MAX_LENGTH) return { ok: false, code: "NOTE_TOO_LONG" };

  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("remove_review", {
      p_review_id: reviewId,
      p_public_message: message,
      p_private_note: note,
    });

    if (error) {
      console.error("remove_review RPC failed:", error.message);
      return { ok: false, code: toErrorCode<RemoveReviewErrorCode>((error as { details?: string }).details, REMOVE_REVIEW_ERROR_CODES) };
    }

    const parsed = parseRemoveRow(data, reviewId);
    if (!parsed) {
      console.error("remove_review returned a malformed response");
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, reviewId, removedAt: parsed.removedAt, wasAlreadyRemoved: parsed.wasAlreadyRemoved };
  } catch (err) {
    console.error("remove_review RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// restoreReview (restore_review)
// ============================================================
export type RestoreReviewErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "MESSAGE_TOO_LONG" | "NOTE_TOO_LONG" | "REVIEW_NOT_FOUND";

const RESTORE_REVIEW_ERROR_CODES: ReadonlySet<string> = new Set<RestoreReviewErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "MESSAGE_TOO_LONG",
  "NOTE_TOO_LONG",
  "REVIEW_NOT_FOUND",
]);

/** UNKNOWN for a mutation means the outcome is unconfirmed, not failed. */
export const RESTORE_REVIEW_ERROR_MESSAGES: ErrorMap<RestoreReviewErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  MESSAGE_TOO_LONG: `Please keep the message to ${REVIEW_MODERATION_TEXT_MAX_LENGTH} characters or fewer.`,
  NOTE_TOO_LONG: `Please keep the private note to ${REVIEW_MODERATION_TEXT_MAX_LENGTH} characters or fewer.`,
  REVIEW_NOT_FOUND: "This review no longer exists.",
  UNKNOWN: "Couldn't confirm this change. Recheck the review's state before trying again.",
};

export type RestoreReviewResult =
  | { ok: true; reviewId: string; wasAlreadyRestored: boolean }
  | { ok: false; code: RestoreReviewErrorCode | "UNKNOWN" };

function parseRestoreRow(data: unknown, reviewId: string): { wasAlreadyRestored: boolean } | null {
  const row = singleRow(data);
  if (!row || row.review_id !== reviewId) return null;
  // A visible review has no removal timestamp after a restore.
  if (row.removed_at !== null) return null;
  if (typeof row.was_already_restored !== "boolean") return null;
  if (row.was_already_restored) {
    if (row.audit_id !== null) return null;
  } else if (!isUuidString(row.audit_id)) {
    return null;
  }
  return { wasAlreadyRestored: row.was_already_restored };
}

export async function restoreReview(reviewId: string, publicMessage: string | null, privateNote: string | null): Promise<RestoreReviewResult> {
  const message = trimOrNull(publicMessage);
  if (message !== null && codePointLength(message) > REVIEW_MODERATION_TEXT_MAX_LENGTH) return { ok: false, code: "MESSAGE_TOO_LONG" };
  const note = trimOrNull(privateNote);
  if (note !== null && codePointLength(note) > REVIEW_MODERATION_TEXT_MAX_LENGTH) return { ok: false, code: "NOTE_TOO_LONG" };

  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("restore_review", {
      p_review_id: reviewId,
      p_public_message: message,
      p_private_note: note,
    });

    if (error) {
      console.error("restore_review RPC failed:", error.message);
      return { ok: false, code: toErrorCode<RestoreReviewErrorCode>((error as { details?: string }).details, RESTORE_REVIEW_ERROR_CODES) };
    }

    const parsed = parseRestoreRow(data, reviewId);
    if (!parsed) {
      console.error("restore_review returned a malformed response");
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, reviewId, wasAlreadyRestored: parsed.wasAlreadyRestored };
  } catch (err) {
    console.error("restore_review RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
