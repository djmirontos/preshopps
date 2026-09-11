/**
 * Shared compact input/button styling for the Sign In and Create Account
 * forms only (SignInForm.tsx, SignUpForm.tsx, and the PasswordInput they
 * both use) -- guarantees the two forms stay visually identical (height,
 * radius, spacing) without introducing a full shared Input/Button
 * component for just two pages. ForgotPasswordForm/ResetPasswordForm are
 * a separate, untouched flow and intentionally do not import this.
 */
export const AUTH_INPUT_CLASS =
  "h-11 w-full rounded-md border border-border bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export const AUTH_BUTTON_CLASS =
  "h-11 w-full rounded-md bg-brand-action text-sm font-semibold text-brand-action-text transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";
