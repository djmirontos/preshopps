const STORAGE_KEY = "preshopps:password-updated";

/** Exported for tests only -- production code never needs the raw key,
 * only the three functions below. */
export const PASSWORD_UPDATED_STORAGE_KEY = STORAGE_KEY;

/**
 * A one-time signal that ChangePasswordForm's own successful password
 * update + confirmed global sign-out just happened, for
 * PasswordUpdatedNotice to read exactly once on /sign-in.
 *
 * sessionStorage (never a URL query param) is the whole point: a
 * same-origin, per-tab, unshareable signal that only this browser tab's
 * own completed flow could have set. A URL marker like
 * `?passwordUpdated=1` can be typed into an address bar, pasted into a
 * shared/phishing link, cached, or crawled -- anyone reaching that URL
 * would see the confirmation regardless of whether any password was ever
 * actually changed. sessionStorage cannot be set by a link at all; the
 * only way this flag exists in a given tab is for markPasswordJustUpdated
 * to have actually run there, which only happens after updateUser AND the
 * global sign-out have both already succeeded (see ChangePasswordForm's
 * own call site). This is not a secret -- a bare marker with no meaning
 * outside "show the confirmation once" -- so this never risks storing a
 * password or any other sensitive value.
 *
 * Every function here is best-effort: sessionStorage access can throw in
 * some privacy modes/embedding contexts, and that must never break the
 * surrounding password-change or sign-in flow either direction -- a
 * failure to set the flag just means the confirmation silently doesn't
 * show, and a failure to read/clear it just means it's treated as absent.
 */
export function markPasswordJustUpdated(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Best-effort only -- see file header comment.
  }
}

/** Pure read, deliberately with no side effect -- PasswordUpdatedNotice
 * calls this once (inside a deferred mount-time check) and never again
 * for the lifetime of that mount, so this never mutates anything or
 * assumes it's the only reader. Clearing the flag is a separate, explicit
 * step (clearPasswordJustUpdatedFlag below), never bundled into this
 * read. */
export function hasPasswordJustUpdatedFlag(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Consumes the flag so it can only ever be read as present once -- a
 * later reload/revisit of /sign-in in this same tab reads nothing. */
export function clearPasswordJustUpdatedFlag(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only -- see file header comment.
  }
}
