"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAppUrl } from "@/lib/env";
import { getPendingSignupEmail, clearPendingSignupEmail } from "@/lib/auth/pending-signup-email";
import { maskEmail } from "@/lib/auth/mask-email";
import { mergeGuestCartOnAuth } from "@/lib/cart/merge-guest-cart-on-auth";
import { OtpCodeInput } from "@/components/auth/OtpCodeInput";
import { AUTH_BUTTON_CLASS } from "@/components/auth/auth-field-styles";

type Props = {
  next: string;
};

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

// Deliberately fixed, generic copy for both failure cases -- never the raw
// Supabase error message, and never a message that would distinguish "no
// such account" from "wrong code" (that distinction would leak whether an
// email is registered). Locked wording, not sourced from lib/auth/errors.ts's
// general-purpose mapAuthError.
const INVALID_CODE_MESSAGE = "That code is invalid or has expired. Please try again or request a new code.";
const RESEND_FAILED_MESSAGE = "Couldn't resend the code. Please try again.";

/**
 * Reads the pending signup email set by SignUpForm (see
 * lib/auth/pending-signup-email.ts) and lets the seller/buyer type the
 * 6-digit code Supabase Auth emailed them, verifying via
 * `verifyOtp({ email, token, type: "signup" })` -- the Supabase-native
 * signup-confirmation OTP, not a custom table/RPC of any kind.
 *
 * sessionStorage is read in an effect (never during render) purely
 * because this component's initial render can happen server-side (App
 * Router still SSRs "use client" components for their first HTML), where
 * `sessionStorage` does not exist at all -- reading it at render time
 * would throw. This mirrors CartProvider's identical reasoning for its own
 * localStorage hydration read. The `Promise.resolve().then(...)`
 * microtask deferral (rather than calling setState synchronously inside
 * the effect body) exists only to satisfy this project's
 * react-hooks/set-state-in-effect lint rule, matching CartProvider's own
 * documented workaround -- functionally it still resolves on the same
 * tick, imperceptibly to the user.
 */
export function VerifyEmailForm({ next }: Props) {
  const router = useRouter();
  const [pendingEmail, setPendingEmail] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setPendingEmail(getPendingSignupEmail());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 60-second resend cooldown, counted down client-side purely for UX --
  // Supabase's own server-side per-user OTP-resend throttle remains the
  // actual, authoritative enforcement regardless of what this countdown
  // shows. Starts immediately on page load (the initial signUp() call
  // already sent the first code) and restarts on every successful resend.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingEmail) return;
    setError(null);

    if (code.length !== CODE_LENGTH) {
      setError(INVALID_CODE_MESSAGE);
      return;
    }

    setIsVerifying(true);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: code,
      type: "signup",
    });

    if (verifyError) {
      setIsVerifying(false);
      setCode("");
      setError(INVALID_CODE_MESSAGE);
      return;
    }

    clearPendingSignupEmail();
    // Same cart-merge call SignInForm/SignUpForm's own session branch
    // already uses -- not duplicated logic, the existing helper.
    await mergeGuestCartOnAuth();
    router.push(next);
    router.refresh();
  }

  async function handleResend() {
    if (!pendingEmail || resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);
    setResendMessage(null);

    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: {
        emailRedirectTo: `${getAppUrl()}/auth/confirm`,
      },
    });

    setIsResending(false);

    if (resendError) {
      setError(RESEND_FAILED_MESSAGE);
      return;
    }

    setCode("");
    setResendMessage("A new code was sent.");
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  if (pendingEmail === undefined) {
    return null;
  }

  if (pendingEmail === null) {
    return (
      <div className="space-y-4 text-sm text-ink-secondary">
        <p>We couldn&rsquo;t find a pending email verification.</p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            Back to Sign Up
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} noValidate className="space-y-4">
      <p className="text-sm text-ink-secondary">
        We sent a 6-digit verification code to <span className="font-medium text-ink">{maskEmail(pendingEmail)}</span>.
      </p>

      <div>
        <label htmlFor="verify-email-code" className="mb-1.5 block text-sm font-medium text-ink">
          Verification code
        </label>
        <OtpCodeInput
          id="verify-email-code"
          value={code}
          onChange={(value) => {
            setCode(value);
            setError(null);
          }}
          disabled={isVerifying}
          hasError={Boolean(error)}
          ariaDescribedBy={error ? "verify-email-error" : undefined}
        />
      </div>

      {error && (
        <p id="verify-email-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {resendMessage && !error && (
        <p role="status" className="text-sm text-success">
          {resendMessage}
        </p>
      )}

      <button type="submit" disabled={isVerifying || code.length !== CODE_LENGTH} className={AUTH_BUTTON_CLASS}>
        {isVerifying ? "Verifying…" : "Verify email"}
      </button>

      <p className="text-center text-sm text-ink-secondary">
        Didn&rsquo;t receive the code?{" "}
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={resendCooldown > 0 || isResending}
          className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
        >
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : isResending ? "Resending…" : "Resend code"}
        </button>
      </p>
    </form>
  );
}
