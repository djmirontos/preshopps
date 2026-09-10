"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError } from "@/lib/auth/errors";
import { getAppUrl } from "@/lib/env";
import { mergeGuestCartOnAuth } from "@/lib/cart/merge-guest-cart-on-auth";

type Props = {
  next: string;
};

const INPUT_CLASS =
  "h-12 w-full rounded-[10px] border border-border bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/**
 * After a successful signUp() call, Supabase returns EITHER an active
 * session (email confirmation is off for this project) OR just a user
 * with no session (confirmation required -- the canon default). This
 * form branches on the actual response rather than assuming either way,
 * per instruction, since that toggle isn't something this task can
 * change or directly inspect.
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
  const [checkEmailAddress, setCheckEmailAddress] = useState<string | null>(null);

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

    setIsSubmitting(false);
    setCheckEmailAddress(email);
  }

  if (checkEmailAddress) {
    return (
      <div className="space-y-3 text-sm text-ink-secondary">
        <p>
          We sent a verification link to <span className="font-medium text-ink">{checkEmailAddress}</span>.
        </p>
        <p>Verify your email, then sign in.</p>
        <Link
          href="/sign-in"
          className="inline-flex h-11 items-center rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="sign-up-email" className="mb-1.5 block text-sm font-medium text-ink">
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
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <label htmlFor="sign-up-password" className="mb-1.5 block text-sm font-medium text-ink">
          Password
        </label>
        <input
          id="sign-up-password"
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
        <label htmlFor="sign-up-confirm-password" className="mb-1.5 block text-sm font-medium text-ink">
          Confirm password
        </label>
        <input
          id="sign-up-confirm-password"
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

      <button
        type="submit"
        disabled={isSubmitting || !policiesAccepted}
        className="h-12 w-full rounded-[10px] bg-brand-action text-sm font-semibold text-brand-action-text transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
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
