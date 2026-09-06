"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAppUrl } from "@/lib/env";

const INPUT_CLASS =
  "h-12 w-full rounded-[10px] border border-border bg-canvas px-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const GENERIC_SUCCESS_MESSAGE = "If an account exists for that email, we've sent reset instructions.";

/**
 * Always shows the same generic message regardless of whether the email
 * matches an account -- resetPasswordForEmail itself never reveals
 * account existence via its response, and this UI doesn't add any of its
 * own (a "real" failure, e.g. a network/rate-limit error, still gets the
 * same generic copy rather than a technical message).
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getAppUrl()}/reset-password`,
    });

    setIsSubmitting(false);
    setIsSubmitted(true);
  }

  if (isSubmitted) {
    return <p className="text-sm text-ink-secondary">{GENERIC_SUCCESS_MESSAGE}</p>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
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

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-12 w-full rounded-[10px] bg-brand-hover text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        {isSubmitting ? "Sending…" : "Send reset instructions"}
      </button>
    </form>
  );
}
