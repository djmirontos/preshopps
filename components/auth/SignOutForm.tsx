"use client";

import { useActionState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import type { SignOutActionState } from "@/lib/auth/sign-out-state";

const INITIAL_STATE: SignOutActionState = { error: null };

type Props = {
  className: string;
  /** Passed straight through to the underlying <button> -- e.g. "menuitem"
   * for AccountMenu's dropdown, omitted for /account's own plain button --
   * so each caller's exact existing DOM shape is preserved. */
  role?: string;
};

/** Shared wrapper around signOutAction (lib/auth/actions.ts), used by both
 * entry points -- the desktop AccountMenu dropdown and the /account page's
 * own Account section -- so both get identical behavior from one place.
 * Wired through useActionState (rather than a plain
 * `<form action={signOutAction}>`) specifically so a genuine sign-out
 * failure surfaces here, inline, on the caller's own current page,
 * instead of the old unconditional redirect. On success the action itself
 * redirects and never returns -- this component shows nothing for that
 * case; SignedOutNotice (mounted on the homepage) is what shows the actual
 * confirmation, once, after that redirect lands. */
export function SignOutForm({ className, role }: Props) {
  const [state, formAction, isPending] = useActionState(signOutAction, INITIAL_STATE);

  return (
    <form action={formAction}>
      <button type="submit" role={role} disabled={isPending} className={className}>
        Sign out
      </button>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
