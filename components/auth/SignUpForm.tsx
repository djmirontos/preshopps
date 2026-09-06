"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError } from "@/lib/auth/errors";
import { getAppUrl } from "@/lib/env";

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
 */
export function SignUpForm({ next }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${getAppUrl()}/auth/confirm` },
    });

    if (signUpError) {
      setIsSubmitting(false);
      setError(mapAuthError(signUpError));
      return;
    }

    if (data.session) {
      // Confirmation is off for this project -- the user is already
      // signed in, so treat this exactly like a successful sign-in.
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
