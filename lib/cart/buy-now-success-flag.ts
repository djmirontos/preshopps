const STORAGE_KEY = "preshopps:buy-now-order-public-code";

/** Exported for tests only -- production code never needs the raw key,
 * only the two functions below. */
export const BUY_NOW_SUCCESS_STORAGE_KEY = STORAGE_KEY;

/**
 * A one-time signal that BuyNowDialog's own confirmed successful
 * submission just happened, for the destination order-detail page
 * (/orders/[publicCode]) to read exactly once and show "Order submitted
 * successfully." as a persistent confirmation.
 *
 * sessionStorage (never a URL query param), same-origin and per-tab, is
 * the whole point -- mirrors lib/auth/password-updated-flag.ts's own
 * rationale exactly: a URL marker like `?justSubmitted=1` could be typed
 * into an address bar or pasted into a shared link, showing a false
 * confirmation on ANY order's page regardless of whether it was ever
 * actually just created. sessionStorage cannot be set by a link at all.
 *
 * Keyed to the ACTUAL created order's own public code (not a bare
 * boolean), which is the second half of the same guarantee: even a
 * genuine flag from an earlier, real Buy Now submission must never bleed
 * onto a DIFFERENT order's page (an older order visited later in the same
 * tab, or a second Buy Now for a different listing whose own page hasn't
 * been reached yet) -- consumeBuyNowSuccessFlagFor only ever matches the
 * exact order code that was actually just submitted.
 *
 * Best-effort: sessionStorage access can throw in some privacy modes/
 * embedding contexts, and that must never break the surrounding Buy Now
 * flow -- a failure to set the flag just means the confirmation silently
 * doesn't show.
 */
export function markBuyNowOrderSubmitted(orderPublicCode: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, orderPublicCode);
  } catch {
    // Best-effort only -- see file header comment.
  }
}

/**
 * Atomically checks whether the stored flag matches this exact order code
 * and, only if so, attempts to remove it -- reporting whether that removal
 * actually succeeded, never merely whether the flag WAS present. A
 * mismatch (including no flag at all) returns false without ever calling
 * removeItem, so visiting a DIFFERENT order's page can never disturb or
 * consume another order's own still-pending flag.
 *
 * This deliberately does NOT assume sessionStorage.getItem succeeding
 * means removeItem will too. If removeItem itself throws right after a
 * successful matching read (a rare privacy-mode/storage-permission quirk
 * where reads are allowed but writes/deletes are blocked), this returns
 * false and the raw value is left exactly as it was -- the caller must
 * treat that exactly like "no flag" and show nothing this time. Showing
 * the confirmation without a CONFIRMED removal would leave the flag
 * sitting in storage unconsumed, so a later ordinary revisit to this same
 * order's page in this same tab would find it still there and show the
 * exact same "just submitted" confirmation again. A stale repeat is
 * strictly worse than an occasional missed confirmation: the order's own
 * existence and the buyer's ownership of it are already proven by the
 * authoritative submit_buy_now_order RPC result and the destination page's
 * own server-side access check, never by this flag -- this is only ever a
 * one-time UI nicety layered on top, not a source of truth.
 */
export function consumeBuyNowSuccessFlagFor(orderPublicCode: string): boolean {
  try {
    if (sessionStorage.getItem(STORAGE_KEY) !== orderPublicCode) return false;
    sessionStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
