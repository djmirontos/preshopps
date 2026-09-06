/**
 * Maps Supabase Auth errors to safe, human-readable copy. Never surfaces
 * raw error objects, stack traces, or internal Supabase URLs -- only a
 * small set of common cases get a specific message; everything else
 * falls back to a generic one. Not every possible Supabase error string
 * is enumerated here on purpose (per instruction: handle common cases
 * safely, generic fallback for the rest).
 */
export function mapAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (message.includes("email not confirmed")) {
    return "Please verify your email before signing in.";
  }
  if (message.includes("already registered") || message.includes("already exists")) {
    return "An account with that email already exists.";
  }
  if (message.includes("password") && (message.includes("least") || message.includes("short"))) {
    return "Password must be at least 6 characters.";
  }
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (message.includes("valid email")) {
    return "Please enter a valid email address.";
  }

  return "Something went wrong. Please try again.";
}
