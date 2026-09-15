"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError } from "@/lib/auth/errors";
import { RECOVERY_SIGN_OUT_FAILED_MESSAGE } from "@/lib/auth/recovery-errors";
import { PasswordVisibilityToggle } from "@/components/ui/PasswordVisibilityToggle";

const INPUT_CLASS =
  "h-12 w-full rounded-[10px] border border-border bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand";

type LinkStatus = "checking" | "ready" | "invalid";

/**
 * Relies entirely on the Supabase JS client's own URL detection
 * (createBrowserClient defaults to detectSessionInUrl: true) rather than
 * a custom token parser: it inspects the reset-link URL itself (fragment
 * tokens or a PKCE code, depending on project auth flow settings -- both
 * are handled transparently by the client library) and fires a
 * PASSWORD_RECOVERY auth event once a recovery session is established.
 *
 * This is the legacy link-based recovery fallback, kept functional for
 * emails already in flight while /forgot-password rolls out its new
 * 6-digit-code flow (ForgotPasswordForm.tsx) -- the link
 * detection/checking/invalid states above are otherwise untouched. Only
 * the SUCCESS behavior below was aligned with that new flow's locked
 * security policy: a successful password update always ends in a
 * mandatory GLOBAL sign-out and a redirect to /sign-in, never a "stay
 * signed in" success state.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [status, setStatus] = useState<LinkStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // One visibility flag per field -- toggling "New password" must never
  // reveal "Confirm new password" and vice versa.
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let resolved = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (resolved) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        resolved = true;
        setStatus("ready");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (resolved) return;
      if (data.session) {
        resolved = true;
        setStatus("ready");
        return;
      }
      // Give the client library a brief moment to finish processing the
      // link's URL before concluding there's no recovery session.
      setTimeout(() => {
        if (!resolved) setStatus("invalid");
      }, 1500);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setIsSubmitting(false);
      setError(mapAuthError(updateError));
      return;
    }

    // Success: clear both password fields immediately. Visibility
    // resets to hidden too, even though the fields themselves are
    // about to unmount either way.
    setPassword("");
    setConfirmPassword("");
    setIsNewPasswordVisible(false);
    setIsConfirmPasswordVisible(false);

    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
    setIsSubmitting(false);

    if (signOutError) {
      // The password update itself already succeeded and can't be
      // undone -- never claim the account was fully signed out
      // everywhere when we can't confirm that, and never auto-retry.
      console.error("Global sign-out after link-based account recovery failed:", signOutError.message);
      setSignOutFailed(true);
      return;
    }

    setIsRedirecting(true);
    router.push("/sign-in");
    router.refresh();
  }

  if (status === "checking") {
    return <p className="text-sm text-ink-secondary">Checking your reset link…</p>;
  }

  if (status === "invalid") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-secondary">This password reset link is invalid or has expired.</p>
        <Link
          href="/forgot-password"
          className="inline-flex h-11 items-center rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (signOutFailed) {
    return (
      <p role="alert" className="text-sm text-danger">
        {RECOVERY_SIGN_OUT_FAILED_MESSAGE}
      </p>
    );
  }

  if (isRedirecting) {
    return <p role="status" className="text-sm text-ink-secondary">Password updated. Signing you out…</p>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="reset-password-new" className="mb-1.5 block text-sm font-medium text-ink">
          New password
        </label>
        <div className="relative">
          <input
            id="reset-password-new"
            name="password"
            type={isNewPasswordVisible ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${INPUT_CLASS} pr-10`}
          />
          <PasswordVisibilityToggle
            isVisible={isNewPasswordVisible}
            onToggle={() => setIsNewPasswordVisible((visible) => !visible)}
            fieldLabel="new password"
            disabled={isSubmitting}
          />
        </div>
        <p className="mt-1 text-xs text-ink-muted">At least 6 characters.</p>
      </div>

      <div>
        <label htmlFor="reset-password-confirm" className="mb-1.5 block text-sm font-medium text-ink">
          Confirm new password
        </label>
        <div className="relative">
          <input
            id="reset-password-confirm"
            name="confirmPassword"
            type={isConfirmPasswordVisible ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={`${INPUT_CLASS} pr-10`}
          />
          <PasswordVisibilityToggle
            isVisible={isConfirmPasswordVisible}
            onToggle={() => setIsConfirmPasswordVisible((visible) => !visible)}
            fieldLabel="password confirmation"
            disabled={isSubmitting}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-12 w-full rounded-[10px] bg-brand-action text-sm font-semibold text-brand-action-text transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        {isSubmitting ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
