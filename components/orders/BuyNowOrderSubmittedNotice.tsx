"use client";

import { useEffect, useState } from "react";
import { consumeBuyNowSuccessFlagFor } from "@/lib/cart/buy-now-success-flag";

type Props = {
  orderPublicCode: string;
};

/**
 * One-time completion confirmation shown on /orders/[publicCode] after
 * BuyNowDialog's own successful submission (Buy Now creates exactly one
 * order and navigates straight to its detail page, unlike /cart's own
 * checkout flow, which shows a persistent inline success card -- order
 * codes, seller, item count, total -- before ever navigating away; Buy Now
 * had no equivalent confirmation of any kind before this component).
 * Driven entirely by a same-origin, per-tab sessionStorage flag keyed to
 * the specific order's own public code (see lib/cart/buy-now-success-flag.ts
 * for the full rationale) -- never a URL query param. A URL marker would
 * let anyone who can type or share a link to ANY order's page see a false
 * "just submitted" confirmation; sessionStorage cannot be set by a link at
 * all, and keying it to the exact order code additionally guarantees a
 * genuine flag from one order can never bleed onto a different order's
 * page (an older order visited later in the same tab, or a second Buy Now
 * for a different listing).
 *
 * Deliberately does not repeat the order code/items/total this component's
 * own destination page already renders in full below it -- unlike the
 * /cart success card (which has no other way to show that information,
 * since it stays on /cart), this confirmation only needs to say the one
 * thing the destination page cannot say on its own: that this specific
 * page is showing what the buyer JUST created, not an order they are
 * merely revisiting.
 *
 * showNotice is a plain useState boolean, deliberately NOT read live from
 * the external store on every render (i.e. deliberately not
 * useSyncExternalStore here) -- exact same reasoning as
 * PasswordUpdatedNotice.tsx: the atomic consume below happens once, inside
 * the deferred callback, and after that this component never looks at
 * sessionStorage again, so a later, unrelated re-render of this same
 * mounted instance can never make the already-shown banner disappear. The
 * message can only ever go away by this component actually unmounting
 * (i.e. navigating away from this order's page).
 *
 * consumeBuyNowSuccessFlagFor (lib/cart/buy-now-success-flag.ts) reports
 * whether it actually removed the matching flag, not merely whether one
 * was present -- setShowNotice(true) is gated on that confirmed removal.
 * If the removal itself fails (a rare storage-permission quirk where reads
 * succeed but deletes don't), the flag is left exactly as it was and this
 * component shows nothing this time, rather than showing a confirmation it
 * couldn't actually consume -- which would otherwise repeat on every later
 * revisit to this same order's page in this same tab.
 *
 * The setState call itself is deferred to a microtask (Promise.resolve
 * ().then(...)) rather than called synchronously in the effect body,
 * matching this project's own established pattern for exactly this "read
 * a client-only value on mount" case (see CartProvider's own guest-cart
 * hydration, and PasswordUpdatedNotice's identical structure) -- purely to
 * satisfy the react-hooks/set-state-in-effect lint rule; functionally this
 * still resolves on the same tick. sessionStorage can't be read during
 * render without risking an SSR/hydration mismatch (the server has no
 * window), so a mount-time effect is the correct tool here.
 *
 * No isAuthenticated/ownership guard needed here: /orders/[publicCode]'s
 * own page component already scopes get_my_order_detail to the caller's
 * own buyer_id server-side (a public_code belonging to another buyer 404s
 * before this ever renders), so by the time this mounts the visitor is
 * already confirmed to be this exact order's own buyer.
 */
export function BuyNowOrderSubmittedNotice({ orderPublicCode }: Props) {
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (!consumeBuyNowSuccessFlagFor(orderPublicCode)) return;
      setShowNotice(true);
    });
    return () => {
      cancelled = true;
    };
  }, [orderPublicCode]);

  if (!showNotice) return null;

  return (
    <p role="status" className="mb-4 rounded-[10px] border border-border bg-canvas px-3 py-2 text-sm text-ink">
      Order submitted successfully.
    </p>
  );
}
