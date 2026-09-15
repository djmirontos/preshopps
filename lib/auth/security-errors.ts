/**
 * Safe error copy for the Account Security actions (Change Password,
 * Sign out other devices). Self-service Change Email is not part of
 * Preshopps MVP -- a login-email change goes through Support instead, so
 * there is no email-change error mapper here. Kept separate from the
 * general-purpose lib/auth/errors.ts#mapAuthError since these actions'
 * safe-copy requirements are specific to an already-authenticated user
 * managing their own security settings. Every mapper below only ever
 * returns one of a small, fixed set of safe strings; none of them echo
 * the raw Supabase message.
 */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

/** updateUser({ password, current_password }) failures. GoTrue's exact
 * wording for a wrong current_password isn't pinned to one fixed string
 * across versions (it can surface as an "invalid" or "incorrect"
 * credentials-style message), so this matches broadly on the same
 * keyword family already used elsewhere in this codebase's auth error
 * mappers rather than a single exact phrase -- worth reconfirming
 * against the live error during hands-on QA. */
export function mapChangePasswordError(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("current_password") || message.includes("current password")) {
    return "The current password is incorrect.";
  }
  if (message.includes("invalid login credentials") || message.includes("invalid credentials")) {
    return "The current password is incorrect.";
  }
  if (message.includes("password") && (message.includes("least") || message.includes("short"))) {
    return "Password must be at least 6 characters.";
  }
  return "We couldn't update your password. Please try again.";
}

/** auth.signOut({ scope: "others" }) failures. */
export function mapSignOutOthersError(): string {
  return "We couldn't sign out your other devices. Please try again.";
}

/** Shown when a password change itself succeeds but the mandatory
 * follow-up global sign-out fails -- must never claim other sessions
 * were revoked when we can't confirm that, but also must not expose any
 * internal detail about why the sign-out call failed. */
export const PASSWORD_CHANGED_SIGN_OUT_FAILED_MESSAGE =
  "Your password was updated, but we couldn't sign out your other sessions automatically. For your security, please use \"Sign out other devices\" below.";
