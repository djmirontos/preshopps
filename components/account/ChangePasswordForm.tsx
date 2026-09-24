"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mapChangePasswordError, PASSWORD_CHANGED_SIGN_OUT_FAILED_MESSAGE } from "@/lib/auth/security-errors";
import { markPasswordJustUpdated } from "@/lib/auth/password-updated-flag";
import { PasswordVisibilityToggle } from "@/components/ui/PasswordVisibilityToggle";

const PASSWORD_MIN_LENGTH = 6;

type Props = {
  onUpdatingChange: (isUpdating: boolean) => void;
};

/**
 * Locked product decision: no reauthentication OTP flow. This form asks
 * for the current password directly and verifies it via the installed
 * Supabase Auth SDK's own native support --
 * `updateUser({ password, current_password })` -- never a custom
 * signInWithPassword check and never sent through our own RPCs.
 *
 * A successful change is immediately followed by a mandatory GLOBAL
 * sign-out (`signOut({ scope: "global" })`), then a hard redirect to
 * /sign-in: the user must re-authenticate with their new password on
 * every device, including this one. This is intentional -- there is no
 * "stay signed in" success state here. Right before that redirect,
 * markPasswordJustUpdated() sets a same-origin, per-tab sessionStorage
 * flag (never a URL query param -- see lib/auth/password-updated-flag.ts
 * for why a URL marker would let anyone who can share/click a link see a
 * false confirmation) that /sign-in's own PasswordUpdatedNotice reads
 * exactly once and shows as a persistent one-time explanation, never a
 * toast fired from here (a toast on THIS page is not guaranteed to
 * survive the push+refresh below the way a flag read on the destination
 * page is). If the sign-out call itself fails, the password change
 * already succeeded and cannot be undone, so this shows safe recovery
 * copy and points at the existing "Sign out other devices" action instead
 * of silently claiming success or retrying indefinitely -- the flag is
 * never set and no redirect happens on that path, so PasswordUpdatedNotice
 * can never show on a failed sign-out either.
 *
 * Current/new/confirm password values live only in this component's own
 * transient state -- never logged, never written to localStorage/
 * sessionStorage, and cleared immediately once the update succeeds. The
 * one thing this component does write to sessionStorage (via
 * markPasswordJustUpdated) is a bare non-secret marker with no relation
 * to the password itself.
 */
export function ChangePasswordForm({ onUpdatingChange }: Props) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [signOutFailedNotice, setSignOutFailedNotice] = useState(false);

  // One visibility flag per field -- toggling "Current password" must
  // never reveal "New password"/"Confirm new password" and vice versa.
  const [isCurrentPasswordVisible, setIsCurrentPasswordVisible] = useState(false);
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isUpdating) return;
    setFieldError(null);
    setSubmitError(null);

    if (currentPassword.length === 0) {
      setFieldError("Enter your current password.");
      return;
    }
    if (newPassword.length === 0) {
      setFieldError("Enter a new password.");
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setFieldError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldError("Passwords don't match.");
      return;
    }

    setIsUpdating(true);
    onUpdatingChange(true);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      current_password: currentPassword,
    });

    if (error) {
      setIsUpdating(false);
      onUpdatingChange(false);
      setSubmitError(mapChangePasswordError(error));
      // The password fields are never persisted anywhere outside this
      // component's own state, but a wrong current-password attempt
      // still shouldn't linger in the DOM longer than necessary.
      setCurrentPassword("");
      return;
    }

    // Success: clear every password field immediately -- none of this
    // may remain in the DOM/state after completion, per this feature's
    // own locked requirement. Visibility resets to hidden too, even
    // though the fields themselves are about to unmount either way.
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setIsCurrentPasswordVisible(false);
    setIsNewPasswordVisible(false);
    setIsConfirmPasswordVisible(false);

    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });

    setIsUpdating(false);
    onUpdatingChange(false);

    if (signOutError) {
      // The password change itself already succeeded and can't be
      // undone -- never claim other sessions were revoked when we
      // can't confirm that, never auto-retry, and never expose why the
      // sign-out call itself failed.
      console.error("Global sign-out after password change failed:", signOutError.message);
      setSignOutFailedNotice(true);
      return;
    }

    setIsRedirecting(true);
    // Set only here, after both updateUser and the global sign-out have
    // already succeeded -- the sign-out-failure path above returns before
    // ever reaching this line, so PasswordUpdatedNotice can never show a
    // false confirmation for a flow that didn't fully complete. A
    // sessionStorage flag, not a URL query param -- see
    // lib/auth/password-updated-flag.ts for why.
    markPasswordJustUpdated();
    router.push("/sign-in");
    router.refresh();
  }

  if (signOutFailedNotice) {
    return <p role="alert" className="text-sm text-danger">{PASSWORD_CHANGED_SIGN_OUT_FAILED_MESSAGE}</p>;
  }

  if (isRedirecting) {
    return <p role="status" className="text-sm text-ink-secondary">Password updated. Signing you out…</p>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="security-current-password" className="mb-1.5 block text-sm font-medium text-ink">
          Current password
        </label>
        <div className="relative">
          <input
            id="security-current-password"
            type={isCurrentPasswordVisible ? "text" : "password"}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            disabled={isUpdating}
            className="h-11 w-full rounded-[10px] border border-border bg-surface px-3 pr-10 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          />
          <PasswordVisibilityToggle
            isVisible={isCurrentPasswordVisible}
            onToggle={() => setIsCurrentPasswordVisible((visible) => !visible)}
            fieldLabel="current password"
            disabled={isUpdating}
          />
        </div>
      </div>

      <div>
        <label htmlFor="security-new-password" className="mb-1.5 block text-sm font-medium text-ink">
          New password
        </label>
        <div className="relative">
          <input
            id="security-new-password"
            type={isNewPasswordVisible ? "text" : "password"}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={isUpdating}
            className="h-11 w-full rounded-[10px] border border-border bg-surface px-3 pr-10 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          />
          <PasswordVisibilityToggle
            isVisible={isNewPasswordVisible}
            onToggle={() => setIsNewPasswordVisible((visible) => !visible)}
            fieldLabel="new password"
            disabled={isUpdating}
          />
        </div>
        <p className="mt-1 text-xs text-ink-muted">At least 6 characters.</p>
      </div>

      <div>
        <label htmlFor="security-confirm-password" className="mb-1.5 block text-sm font-medium text-ink">
          Confirm new password
        </label>
        <div className="relative">
          <input
            id="security-confirm-password"
            type={isConfirmPasswordVisible ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isUpdating}
            className="h-11 w-full rounded-[10px] border border-border bg-surface px-3 pr-10 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          />
          <PasswordVisibilityToggle
            isVisible={isConfirmPasswordVisible}
            onToggle={() => setIsConfirmPasswordVisible((visible) => !visible)}
            fieldLabel="password confirmation"
            disabled={isUpdating}
          />
        </div>
      </div>

      {(fieldError ?? submitError) && (
        <p role="alert" className="text-sm text-danger">
          {fieldError ?? submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isUpdating}
        className="h-11 w-full rounded-[10px] bg-brand-action text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isUpdating ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
