"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError } from "@/lib/auth/errors";
import { getAppUrl } from "@/lib/env";
import { setPendingSignupEmail } from "@/lib/auth/pending-signup-email";
import { mergeGuestCartOnAuth } from "@/lib/cart/merge-guest-cart-on-auth";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { AUTH_INPUT_CLASS, AUTH_BUTTON_CLASS } from "@/components/auth/auth-field-styles";

type Props = {
  next: string;
};

/**
 * After a successful signUp() call, Supabase returns EITHER an active
 * session (email confirmation is off for this project) OR just a user
 * with no session (confirmation required -- the canon default). This
 * form branches on the actual response rather than assuming either way,
 * per instruction, since that toggle isn't something this task can
 * change or directly inspect. The no-session branch now hands off to
 * /verify-email (P0 Signup Verification Slice 1) for 6-digit-code entry,
 * instead of the previous inline "check your email" panel -- the email
 * itself travels via sessionStorage (lib/auth/pending-signup-email.ts),
 * never the URL, per that task's own locked decision. The session branch
 * below is completely unchanged.
 *
 * PRD 5.5 signup-time Terms of Use / Privacy Policy acceptance: one
 * unchecked-by-default combined checkbox gates the submit button and is
 * re-checked in handleSubmit itself (defense in depth, same pattern as
 * the password-mismatch check above it). Checking it only ever sends
 * `policies_accepted: true` in signUp()'s metadata -- never a client
 * timestamp; the server-side handle_new_user() trigger (0071) is the
 * actual enforcement and the only writer of terms_accepted_at/
 * privacy_accepted_at, both stamped with its own now().
 */
export function SignUpForm({ next }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!policiesAccepted) {
      setError("Please agree to the Terms of Use and Privacy Policy to continue.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${getAppUrl()}/auth/confirm`,
        // Server-side handle_new_user() (0071) is the actual enforcement --
        // this is the explicit consent signal it reads from
        // raw_user_meta_data, never a client-supplied timestamp. Absence or
        // any value other than a checked box (which always sends `true`)
        // makes the trigger reject the signup outright.
        data: { policies_accepted: true },
      },
    });

    if (signUpError) {
      setIsSubmitting(false);
      setError(mapAuthError(signUpError));
      return;
    }

    if (data.session) {
      // Confirmation is off for this project -- the user is already
      // signed in, so treat this exactly like a successful sign-in,
      // including merging any local guest cart (see SignInForm).
      await mergeGuestCartOnAuth();
      router.push(next);
      router.refresh();
      return;
    }

    // No session yet -- email confirmation required (canon default). Hand
    // off to /verify-email for 6-digit-code entry rather than staying on
    // this form. The email is carried via sessionStorage, never the URL;
    // only `next` travels in the URL, through the same getSafeNextPath()
    // architecture every other auth route already uses. Deliberately does
    // not call setIsSubmitting(false) here, matching the session branch
    // above -- both branches now navigate away rather than one of them
    // staying on this same page.
    setPendingSignupEmail(email);
    router.push(`/verify-email?next=${encodeURIComponent(next)}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <div>
        <label htmlFor="sign-up-email" className="mb-1 block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="sign-up-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={AUTH_INPUT_CLASS}
        />
      </div>

      <PasswordInput
        id="sign-up-password"
        name="password"
        label="Password"
        autoComplete="new-password"
        required
        minLength={6}
        value={password}
        onChange={setPassword}
        helperText="At least 6 characters."
      />

      <PasswordInput
        id="sign-up-confirm-password"
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        required
        minLength={6}
        value={confirmPassword}
        onChange={setConfirmPassword}
      />

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={policiesAccepted}
          onChange={(event) => setPoliciesAccepted(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        <span>
          I agree to the{" "}
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Terms of Use
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button type="submit" disabled={isSubmitting || !policiesAccepted} className={AUTH_BUTTON_CLASS}>
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-ink-secondary">
        Already have an account?{" "}
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
