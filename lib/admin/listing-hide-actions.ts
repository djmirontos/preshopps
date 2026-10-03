import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrappers around the three listing-visibility RPCs (0106,
 * 0112): admin_get_listing_hide_state, admin_hide_listing, and
 * admin_unhide_listing. Every admin-authorization check happens server-side
 * inside each RPC -- these wrappers never send a role or admin flag.
 *
 * Successful responses are validated against the expected shape for the
 * requested listing. Anything empty, multi-row, mismatched, or malformed is
 * returned as UNKNOWN -- never as a success. For mutations, UNKNOWN means the
 * outcome is unconfirmed (the change may or may not have committed), so the
 * caller must recheck the listing's state before offering further actions.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export const UNHIDE_NOTE_MAX_LENGTH = 1000;

/** Exactly one row, and it must be a plain object. */
function singleRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row: unknown = data[0];
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null;
}

function isTimestampString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// ============================================================
// getListingHideState (admin_get_listing_hide_state)
// ============================================================
export type GetListingHideStateErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "LISTING_NOT_FOUND";

const GET_LISTING_HIDE_STATE_ERROR_CODES: ReadonlySet<string> = new Set<GetListingHideStateErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "LISTING_NOT_FOUND",
]);

export const GET_LISTING_HIDE_STATE_ERROR_MESSAGES: ErrorMap<GetListingHideStateErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  LISTING_NOT_FOUND: "This listing no longer exists.",
  UNKNOWN: "Couldn't load this listing's visibility. Please try again.",
};

/** `hiddenAt: null` means the listing is currently visible -- a successful
 * read, never a fallback for a failed one (a failure is always ok: false). */
export type GetListingHideStateResult =
  | { ok: true; hiddenAt: string | null }
  | { ok: false; code: GetListingHideStateErrorCode | "UNKNOWN" };

function parseListingHideStateRow(data: unknown, listingId: string): { hiddenAt: string | null } | null {
  const row = singleRow(data);
  if (!row || row.listing_id !== listingId) return null;
  if (row.hidden_by_admin_at === null) return { hiddenAt: null };
  if (isTimestampString(row.hidden_by_admin_at)) return { hiddenAt: row.hidden_by_admin_at };
  return null;
}

export async function getListingHideState(listingId: string): Promise<GetListingHideStateResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_get_listing_hide_state", { p_listing_id: listingId });

    if (error) {
      console.error("admin_get_listing_hide_state RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<GetListingHideStateErrorCode>((error as { details?: string }).details, GET_LISTING_HIDE_STATE_ERROR_CODES),
      };
    }

    const parsed = parseListingHideStateRow(data, listingId);
    if (!parsed) {
      console.error("admin_get_listing_hide_state returned a malformed response");
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, hiddenAt: parsed.hiddenAt };
  } catch (err) {
    console.error("admin_get_listing_hide_state RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// hideListing (admin_hide_listing)
// ============================================================
export type HideListingErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "REASON_REQUIRED" | "LISTING_NOT_FOUND";

const HIDE_LISTING_ERROR_CODES: ReadonlySet<string> = new Set<HideListingErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "REASON_REQUIRED",
  "LISTING_NOT_FOUND",
]);

/** UNKNOWN for a mutation means the outcome is unconfirmed, not failed. */
export const HIDE_LISTING_ERROR_MESSAGES: ErrorMap<HideListingErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  REASON_REQUIRED: "Please provide a reason.",
  LISTING_NOT_FOUND: "This listing no longer exists.",
  UNKNOWN: "Couldn't confirm this change. Recheck the listing's visibility before trying again.",
};

export type HideListingResult =
  | { ok: true; listingId: string; hiddenAt: string; wasAlreadyHidden: boolean }
  | { ok: false; code: HideListingErrorCode | "UNKNOWN" };

function parseHideRow(data: unknown, listingId: string): { hiddenAt: string; wasAlreadyHidden: boolean } | null {
  const row = singleRow(data);
  if (!row || row.listing_id !== listingId) return null;
  if (!isTimestampString(row.hidden_by_admin_at)) return null;
  if (typeof row.was_already_hidden !== "boolean") return null;
  return { hiddenAt: row.hidden_by_admin_at, wasAlreadyHidden: row.was_already_hidden };
}

export async function hideListing(listingId: string, reason: string): Promise<HideListingResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_hide_listing", { p_listing_id: listingId, p_reason: reason });

    if (error) {
      console.error("admin_hide_listing RPC failed:", error.message);
      return { ok: false, code: toErrorCode<HideListingErrorCode>((error as { details?: string }).details, HIDE_LISTING_ERROR_CODES) };
    }

    const parsed = parseHideRow(data, listingId);
    if (!parsed) {
      console.error("admin_hide_listing returned a malformed response");
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, listingId, hiddenAt: parsed.hiddenAt, wasAlreadyHidden: parsed.wasAlreadyHidden };
  } catch (err) {
    console.error("admin_hide_listing RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// unhideListing (admin_unhide_listing)
// ============================================================
export type UnhideListingErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "LISTING_NOT_FOUND" | "ADMIN_UNHIDE_NOTE_TOO_LONG";

const UNHIDE_LISTING_ERROR_CODES: ReadonlySet<string> = new Set<UnhideListingErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "LISTING_NOT_FOUND",
  "ADMIN_UNHIDE_NOTE_TOO_LONG",
]);

/** UNKNOWN for a mutation means the outcome is unconfirmed, not failed. */
export const UNHIDE_LISTING_ERROR_MESSAGES: ErrorMap<UnhideListingErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  LISTING_NOT_FOUND: "This listing no longer exists.",
  ADMIN_UNHIDE_NOTE_TOO_LONG: "Please shorten your note.",
  UNKNOWN: "Couldn't confirm this change. Recheck the listing's visibility before trying again.",
};

export type UnhideListingResult =
  | { ok: true; listingId: string; wasAlreadyVisible: boolean }
  | { ok: false; code: UnhideListingErrorCode | "UNKNOWN" };

function parseUnhideRow(data: unknown, listingId: string): { wasAlreadyVisible: boolean } | null {
  const row = singleRow(data);
  if (!row || row.listing_id !== listingId) return null;
  if (row.hidden_by_admin_at !== null) return null;
  if (typeof row.was_already_visible !== "boolean") return null;
  return { wasAlreadyVisible: row.was_already_visible };
}

export async function unhideListing(listingId: string, note: string | null): Promise<UnhideListingResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_unhide_listing", { p_listing_id: listingId, p_note: note });

    if (error) {
      console.error("admin_unhide_listing RPC failed:", error.message);
      return { ok: false, code: toErrorCode<UnhideListingErrorCode>((error as { details?: string }).details, UNHIDE_LISTING_ERROR_CODES) };
    }

    const parsed = parseUnhideRow(data, listingId);
    if (!parsed) {
      console.error("admin_unhide_listing returned a malformed response");
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, listingId, wasAlreadyVisible: parsed.wasAlreadyVisible };
  } catch (err) {
    console.error("admin_unhide_listing RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
