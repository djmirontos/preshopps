"use client";

import { useEffect, useState } from "react";
import { clearPasswordJustUpdatedFlag, hasPasswordJustUpdatedFlag } from "@/lib/auth/password-updated-flag";

/**
 * One-time explanation shown on /sign-in after ChangePasswordForm's own
 * successful password update + confirmed global sign-out. Driven entirely
 * by a same-origin, per-tab sessionStorage flag (see
 * lib/auth/password-updated-flag.ts for the full rationale) -- never a URL
 * query param. A URL marker would let anyone who can type an address bar
 * or share/click a link see this exact confirmation regardless of whether
 * any password was ever actually changed; sessionStorage cannot be set by
 * a link at all, so the banner can only ever appear in the one tab that
 * actually just completed the real flow.
 *
 * Because there is no URL involved, there is also no router.replace (or
 * any other navigation) needed to consume the flag, and therefore no risk
 * of a Suspense boundary re-suspending on a searchParams change and
 * blanking an already-shown banner -- the earlier design (a URL marker
 * read via next/navigation's search-params hook) carried exactly that
 * risk, since that hook requires wrapping in Suspense and the App Router
 * can re-render/re-suspend that consumer when the query string changes
 * via a replace-style navigation.
 *
 * showNotice is a plain useState boolean, deliberately NOT read live from
 * the external store on every render (i.e. deliberately not
 * useSyncExternalStore here): the read-then-clear below happens together,
 * once, inside the same deferred callback, and after that this component
 * never looks at sessionStorage again. Once showNotice flips to true,
 * nothing in this component ever sets it back to false, so clearing the
 * flag right after capturing it can never make the already-shown banner
 * disappear on some later, unrelated re-render of this same mounted
 * instance -- a live external-store subscription would re-invoke its
 * getSnapshot on every render and see the just-cleared flag as absent,
 * hiding the banner far too early. The message can only ever go away by
 * this component actually unmounting (i.e. navigating away from
 * /sign-in).
 *
 * The setState call itself is deferred to a microtask (Promise.resolve
 * ().then(...)) rather than called synchronously in the effect body,
 * matching this project's own established pattern for exactly this
 * "read a client-only value on mount" case (see CartProvider's own guest-
 * cart hydration) -- purely to satisfy the react-hooks/set-state-in-effect
 * lint rule; functionally this still resolves on the same tick.
 * sessionStorage can't be read during render without risking an
 * SSR/hydration mismatch (the server has no window), so a mount-time
 * effect is the correct tool here.
 *
 * Mounted only on /sign-in (app/sign-in/page.tsx). No isAuthenticated
 * guard, unlike SignedOutNotice: /sign-in's own page component already
 * redirects any authenticated visitor away before this could ever render,
 * so by the time this mounts the visitor is guaranteed to already be
 * signed out.
 */
export function PasswordUpdatedNotice() {
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (!hasPasswordJustUpdatedFlag()) return;
      clearPasswordJustUpdatedFlag();
      setShowNotice(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showNotice) return null;

  return (
    <p role="status" className="mb-4 rounded-[10px] border border-border bg-canvas px-3 py-2 text-sm text-ink">
      Password updated. Sign in with your new password.
    </p>
  );
}
