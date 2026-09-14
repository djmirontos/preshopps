const PENDING_SIGNUP_EMAIL_KEY = "preshopps:pending-signup-email";

/**
 * Carries the email address a signup is waiting to verify from SignUpForm
 * to /verify-email, via sessionStorage rather than a URL query param (per
 * this task's own locked decision) or any new database/table. Only ever
 * stores the email -- never the password or the verification code, which
 * this module has no knowledge of at all. Every read/write is wrapped in
 * try/catch since sessionStorage can throw (private browsing, disabled
 * storage, quota) and none of that should ever break the signup/verify
 * flow itself -- a failed write just means a direct/refresh visit to
 * /verify-email will show the "couldn't find a pending email" fallback,
 * which is already a handled, safe state.
 */
export function setPendingSignupEmail(email: string): void {
  try {
    sessionStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, email);
  } catch {
    // Ignore -- see module comment.
  }
}

export function getPendingSignupEmail(): string | null {
  try {
    return sessionStorage.getItem(PENDING_SIGNUP_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function clearPendingSignupEmail(): void {
  try {
    sessionStorage.removeItem(PENDING_SIGNUP_EMAIL_KEY);
  } catch {
    // Ignore -- see module comment.
  }
}
