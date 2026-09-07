"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError } from "@/lib/auth/errors";
import { mergeGuestCartOnAuth } from "@/lib/cart/merge-guest-cart-on-auth";

type Props = {
  next: string;
};

const INPUT_CLASS =
  "h-12 w-full rounded-[10px] border border-border bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export function SignInForm({ next }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setIsSubmitting(false);
      setError(mapAuthError(signInError));
      return;
    }

    // Merge the local guest cart into the account cart now that a session
    // exists (PRD S20.2/AGENTS.md Cart Rules) -- must happen before the
    // refresh below so the root layout's next render picks up the merged
    // DB cart, not the pre-merge state.
    await mergeGuestCartOnAuth();

    // A Server Component layout/page (e.g. the header's auth state) only
    // reflects the session on its next render -- refresh so it picks up
    // the cookies the browser client just set, without a full reload.
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="sign-in-email" className="mb-1.5 block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="sign-in-email"
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
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="sign-in-password" className="block text-sm font-medium text-ink">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="rounded text-xs font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="sign-in-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-ink-secondary">
        New to Preshopps?{" "}
        <Link
          href={`/sign-up?next=${encodeURIComponent(next)}`}
          className="rounded font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
