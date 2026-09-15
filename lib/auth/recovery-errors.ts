/**
 * Safe, locked error copy for the Forgot Password recovery flow (email ->
 * 6-digit code -> new password). Never derived from the raw Supabase
 * error message: distinguishing "no such account" from "wrong code"
 * would leak account existence, so every string below is a fixed product
 * decision rather than a translation of GoTrue's own wording.
 */

export const RECOVERY_CODE_INVALID_MESSAGE =
  "That verification code is invalid or has expired. Request a new code and try again.";

export const RECOVERY_RATE_LIMIT_MESSAGE = "Please wait before requesting another code.";

export const RECOVERY_REQUEST_FAILED_MESSAGE = "We couldn't send a password reset code right now. Please try again.";

export const RECOVERY_PASSWORDS_DONT_MATCH_MESSAGE = "Passwords don't match.";

export const RECOVERY_PASSWORD_TOO_SHORT_MESSAGE = "Password must be at least 6 characters.";

export const RECOVERY_PASSWORD_UPDATE_FAILED_MESSAGE = "We couldn't update your password. Please try again.";

export const RECOVERY_NETWORK_ERROR_MESSAGE = "Check your connection and try again.";

/** Shown when the recovery password update itself succeeds but the
 * mandatory follow-up global sign-out fails -- must never claim the
 * account was fully signed out everywhere when that can't be confirmed.
 * Shared by both the new code-based flow and the existing link-based
 * /reset-password fallback, since both end in the same policy. */
export const RECOVERY_SIGN_OUT_FAILED_MESSAGE =
  "Your password was updated, but we couldn't finish signing you out automatically. Please close this window and sign in again with your new password.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

/** resetPasswordForEmail (initial request and resend) failures. A "no
 * such account" outcome from Supabase never surfaces as an error here in
 * the first place -- Supabase itself never reveals that via this call's
 * response -- so inspecting a genuine error (network/Auth-service/rate-
 * limit failure) does not risk leaking account existence. Still never
 * echoes the raw message: only distinguishes "you're sending requests
 * too fast" from "something went wrong," both fixed, safe strings. */
export function mapRecoveryRequestError(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("only request this after")) {
    return RECOVERY_RATE_LIMIT_MESSAGE;
  }
  return RECOVERY_REQUEST_FAILED_MESSAGE;
}

/** updateUser({ password }) failures once a recovery code has already
 * been verified -- current_password is never involved here (ownership
 * was already proven via the code), so this is a smaller mapper than
 * security-errors.ts#mapChangePasswordError. */
export function mapRecoveryPasswordUpdateError(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("password") && (message.includes("least") || message.includes("short"))) {
    return RECOVERY_PASSWORD_TOO_SHORT_MESSAGE;
  }
  if (message.includes("network") || message.includes("fetch")) {
    return RECOVERY_NETWORK_ERROR_MESSAGE;
  }
  return RECOVERY_PASSWORD_UPDATE_FAILED_MESSAGE;
}
