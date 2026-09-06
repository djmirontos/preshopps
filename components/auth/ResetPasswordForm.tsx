"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError } from "@/lib/auth/errors";

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
 */
export function ResetPasswordForm() {
  const [status, setStatus] = useState<LinkStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

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
    setIsSubmitting(false);

    if (updateError) {
      setError(mapAuthError(updateError));
      return;
    }

    setIsSuccess(true);
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

  if (isSuccess) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-secondary">Your password has been updated.</p>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-[10px] bg-brand-hover px-4 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Continue to Preshopps
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="reset-password-new" className="mb-1.5 block text-sm font-medium text-ink">
          New password
        </label>
        <input
          id="reset-password-new"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-xs text-ink-muted">At least 6 characters.</p>
      </div>

      <div>
        <label htmlFor="reset-password-confirm" className="mb-1.5 block text-sm font-medium text-ink">
          Confirm new password
        </label>
        <input
          id="reset-password-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-12 w-full rounded-[10px] bg-brand-hover text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        {isSubmitting ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
