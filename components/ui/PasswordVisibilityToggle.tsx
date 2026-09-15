"use client";

import { Eye, EyeOff } from "lucide-react";

type Props = {
  isVisible: boolean;
  onToggle: () => void;
  /** Builds the accessible label, e.g. fieldLabel="current password" ->
   * "Show current password" / "Hide current password". Always passed
   * explicitly by the caller rather than defaulting to a generic "Show
   * password" -- when more than one password field appears in the same
   * form, a field-specific label is what actually lets a screen reader
   * user tell the toggles apart; the icon alone is never the only
   * signal. */
  fieldLabel: string;
  disabled?: boolean;
};

/**
 * Absolutely positioned inside a `relative` wrapper around a password
 * `<input>` -- the caller adds right padding (e.g. `pr-10`) to the
 * input's own className and renders this as its sibling. `type="button"`
 * so Enter/click here never submits the enclosing form, never affects
 * validation, and never touches the typed value -- it only flips the
 * input's own `type` between "password" and "text". Visibility state is
 * owned by the caller (one boolean per field) so each password field on
 * a form toggles independently and the caller can reset it to hidden
 * (on success, unmount, or a dialog closing) the same way it resets the
 * field's own value.
 */
export function PasswordVisibilityToggle({ isVisible, onToggle, fieldLabel, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={isVisible ? `Hide ${fieldLabel}` : `Show ${fieldLabel}`}
      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
