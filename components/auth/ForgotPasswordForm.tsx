"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAppUrl } from "@/lib/env";
import { AuthCard } from "@/components/auth/AuthCard";
import { OtpCodeInput } from "@/components/auth/OtpCodeInput";
import { PasswordVisibilityToggle } from "@/components/ui/PasswordVisibilityToggle";
import {
  RECOVERY_CODE_INVALID_MESSAGE,
  RECOVERY_PASSWORDS_DONT_MATCH_MESSAGE,
  RECOVERY_PASSWORD_TOO_SHORT_MESSAGE,
  RECOVERY_SIGN_OUT_FAILED_MESSAGE,
  mapRecoveryPasswordUpdateError,
  mapRecoveryRequestError,
} from "@/lib/auth/recovery-errors";

const INPUT_CLASS =
  "h-12 w-full rounded-[10px] border border-border bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const BUTTON_CLASS =
  "h-12 w-full rounded-[10px] bg-brand-action text-sm font-semibold text-brand-action-text transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;
const PASSWORD_MIN_LENGTH = 6;

type Step = "email" | "code" | "password";

const BACK_TO_SIGN_IN = (
  <Link
    href="/sign-in"
    className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
  >
    Back to sign in
  </Link>
);

/**
 * Three-step recovery flow, all on /forgot-password: email -> 6-digit
 * code (native `verifyOtp({ email, token, type: "recovery" })`, same
 * pattern as VerifyEmailForm's signup-code flow, just a different
 * `type`) -> new password (`updateUser({ password })`, no
 * `current_password` -- ownership was already proven by the code, not by
 * an existing password). A successful password update always ends in a
 * mandatory GLOBAL sign-out and a redirect to /sign-in: there is no
 * "stay signed in" success state, mirroring the Account Security
 * ChangePasswordForm's own locked behavior.
 *
 * Owns its own AuthCard (title/subtitle/footer) rather than the page
 * rendering one statically, since the copy shown there changes per step
 * -- app/forgot-password/page.tsx now renders just this component.
 *
 * `email` lives only in this component's own transient state -- never
 * localStorage/sessionStorage/cookies/a query param -- for exactly as
 * long as the current flow needs it to call verifyOtp/
 * resetPasswordForEmail again. It is never displayed back to the user
 * (step 2's copy is deliberately generic about "your email").
 *
 * The initial code request only advances to step 2 when
 * resetPasswordForEmail reports no error, showing the exact same
 * privacy-safe step-2 copy whether or not the account exists (Supabase
 * itself never reveals that via this call's response either way, so
 * inspecting a genuine error here -- network/Auth-service/rate-limit
 * failure -- never risks leaking account existence). A real error keeps
 * the user on the email step (with what they typed still in the field)
 * and shows a safe, mapped message instead of silently claiming a code
 * was sent. Resend, once already on the code step, uses the same
 * mapper -- a resend failure never falsely restarts the cooldown or
 * claims success either.
 *
 * Once step 3 (password) is reached, there is deliberately no "back"
 * action to an earlier step -- a recovery session already exists at
 * that point, and returning to the code step could only produce
 * confusing, undefined behavior rather than a real do-over.
 *
 * Each password field on step 3 owns its own show/hide visibility
 * state (never one toggle for both) via the shared
 * PasswordVisibilityToggle, reset to hidden alongside the fields'
 * values the moment the update succeeds.
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");

  const [isSendingCode, setIsSendingCode] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [passwordFieldError, setPasswordFieldError] = useState<string | null>(null);
  const [passwordSubmitError, setPasswordSubmitError] = useState<string | null>(null);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  // Client-side countdown only, for UX -- Supabase's own server-side
  // per-email rate limit on resetPasswordForEmail remains the actual,
  // authoritative enforcement regardless of what this shows.
  useEffect(() => {
    if (step !== "code" || resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [step, resendCooldown]);

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSendingCode) return;
    setRequestError(null);
    setIsSendingCode(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${getAppUrl()}/reset-password`,
    });

    setIsSendingCode(false);

    if (error) {
      // A genuine request failure (network/Auth-service/rate limit) --
      // never advance to the code step on a false claim that one was
      // sent, but also never echo the raw error or imply anything about
      // whether the account exists. The typed email is left in place so
      // the user can simply retry.
      setRequestError(mapRecoveryRequestError(error));
      return;
    }

    setCode("");
    setCodeError(null);
    setResendMessage(null);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setStep("code");
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isVerifyingCode) return;
    setCodeError(null);

    if (code.length !== CODE_LENGTH) {
      setCodeError(RECOVERY_CODE_INVALID_MESSAGE);
      return;
    }

    setIsVerifyingCode(true);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: "recovery",
    });
    setIsVerifyingCode(false);

    if (error) {
      setCode("");
      setCodeError(RECOVERY_CODE_INVALID_MESSAGE);
      return;
    }

    setCode("");
    setStep("password");
  }

  async function handleResend() {
    if (resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setCodeError(null);
    setResendMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${getAppUrl()}/reset-password`,
    });

    setIsResending(false);

    if (error) {
      setCodeError(mapRecoveryRequestError(error));
      return;
    }

    setCode("");
    setResendMessage("A new code was sent.");
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  function handleUseDifferentEmail() {
    setStep("email");
    setCode("");
    setCodeError(null);
    setResendMessage(null);
    setResendCooldown(0);
  }

  async function handleUpdatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUpdatingPassword) return;
    setPasswordFieldError(null);
    setPasswordSubmitError(null);

    if (newPassword.length === 0) {
      setPasswordFieldError("Enter a new password.");
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordFieldError(RECOVERY_PASSWORD_TOO_SHORT_MESSAGE);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFieldError(RECOVERY_PASSWORDS_DONT_MATCH_MESSAGE);
      return;
    }

    setIsUpdatingPassword(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setIsUpdatingPassword(false);
      setPasswordSubmitError(mapRecoveryPasswordUpdateError(error));
      return;
    }

    // Success: clear every sensitive value immediately -- none of this
    // may remain in state after completion. Visibility resets to
    // hidden too, even though the fields themselves are about to
    // unmount either way.
    setNewPassword("");
    setConfirmPassword("");
    setIsNewPasswordVisible(false);
    setIsConfirmPasswordVisible(false);
    setCode("");
    setEmail("");

    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
    setIsUpdatingPassword(false);

    if (signOutError) {
      // The password update itself already succeeded and can't be
      // undone -- never claim the account was fully signed out
      // everywhere when we can't confirm that, and never auto-retry.
      console.error("Global sign-out after account recovery failed:", signOutError.message);
      setSignOutFailed(true);
      return;
    }

    setIsRedirecting(true);
    router.push("/sign-in");
    router.refresh();
  }

  let title = "Forgot your password?";
  let subtitle: string | undefined = "Enter your email and we'll send you a password reset code.";
  let content: ReactNode;

  if (signOutFailed) {
    title = "Create a new password";
    subtitle = undefined;
    content = (
      <p role="alert" className="text-sm text-danger">
        {RECOVERY_SIGN_OUT_FAILED_MESSAGE}
      </p>
    );
  } else if (isRedirecting) {
    title = "Create a new password";
    subtitle = undefined;
    content = <p role="status" className="text-sm text-ink-secondary">Password updated. Signing you out…</p>;
  } else if (step === "password") {
    title = "Create a new password";
    subtitle = "Choose a new password for your Preshopps account.";
    content = (
      <form onSubmit={handleUpdatePassword} noValidate className="space-y-4">
        <div>
          <label htmlFor="forgot-password-new" className="mb-1.5 block text-sm font-medium text-ink">
            New password
          </label>
          <div className="relative">
            <input
              id="forgot-password-new"
              type={isNewPasswordVisible ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={isUpdatingPassword}
              className={`${INPUT_CLASS} pr-10`}
            />
            <PasswordVisibilityToggle
              isVisible={isNewPasswordVisible}
              onToggle={() => setIsNewPasswordVisible((visible) => !visible)}
              fieldLabel="new password"
              disabled={isUpdatingPassword}
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">At least 6 characters.</p>
        </div>

        <div>
          <label htmlFor="forgot-password-confirm" className="mb-1.5 block text-sm font-medium text-ink">
            Confirm new password
          </label>
          <div className="relative">
            <input
              id="forgot-password-confirm"
              type={isConfirmPasswordVisible ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={isUpdatingPassword}
              className={`${INPUT_CLASS} pr-10`}
            />
            <PasswordVisibilityToggle
              isVisible={isConfirmPasswordVisible}
              onToggle={() => setIsConfirmPasswordVisible((visible) => !visible)}
              fieldLabel="password confirmation"
              disabled={isUpdatingPassword}
            />
          </div>
        </div>

        {(passwordFieldError ?? passwordSubmitError) && (
          <p role="alert" className="text-sm text-danger">
            {passwordFieldError ?? passwordSubmitError}
          </p>
        )}

        <button type="submit" disabled={isUpdatingPassword} className={BUTTON_CLASS}>
          {isUpdatingPassword ? "Updating…" : "Update password"}
        </button>
      </form>
    );
  } else if (step === "code") {
    title = "Check your email";
    subtitle = "Enter the 6-digit password reset code we sent to your email.";
    content = (
      <form onSubmit={handleVerifyCode} noValidate className="space-y-4">
        <div>
          <label htmlFor="forgot-password-code" className="mb-1.5 block text-sm font-medium text-ink">
            Recovery code
          </label>
          <OtpCodeInput
            id="forgot-password-code"
            value={code}
            onChange={(value) => {
              setCode(value);
              setCodeError(null);
            }}
            disabled={isVerifyingCode}
            hasError={Boolean(codeError)}
            ariaDescribedBy={codeError ? "forgot-password-code-error" : undefined}
          />
        </div>

        {codeError && (
          <p id="forgot-password-code-error" role="alert" className="text-sm text-danger">
            {codeError}
          </p>
        )}

        {resendMessage && !codeError && (
          <p role="status" className="text-sm text-success">
            {resendMessage}
          </p>
        )}

        <button type="submit" disabled={isVerifyingCode || code.length !== CODE_LENGTH} className={BUTTON_CLASS}>
          {isVerifyingCode ? "Verifying…" : "Verify code"}
        </button>

        <p className="text-center text-sm text-ink-secondary">
          Didn&rsquo;t receive a code?{" "}
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resendCooldown > 0 || isResending}
            className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : isResending ? "Resending…" : "Resend code"}
          </button>
        </p>

        <p className="text-center text-sm text-ink-secondary">
          <button
            type="button"
            onClick={handleUseDifferentEmail}
            className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Use a different email
          </button>
        </p>
      </form>
    );
  } else {
    content = (
      <form onSubmit={handleRequestCode} noValidate className="space-y-4">
        <div>
          <label htmlFor="forgot-password-email" className="mb-1.5 block text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="forgot-password-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        {requestError && (
          <p role="alert" className="text-sm text-danger">
            {requestError}
          </p>
        )}

        <button type="submit" disabled={isSendingCode} className={BUTTON_CLASS}>
          {isSendingCode ? "Sending…" : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <AuthCard title={title} subtitle={subtitle} footer={BACK_TO_SIGN_IN}>
      {content}
    </AuthCard>
  );
}
