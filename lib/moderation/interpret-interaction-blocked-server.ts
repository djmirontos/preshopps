import { getMyActiveRestrictions } from "@/lib/moderation/get-my-active-restrictions";
import { selectInteractionBlockedPresentation, type InteractionBlockedPresentation } from "@/lib/moderation/select-interaction-blocked-presentation";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

export type { InteractionBlockedPresentation };

/**
 * Server-safe counterpart to interpretInteractionBlocked (browser) -- for
 * Server Component callers only. Uses getMyActiveRestrictions (the
 * cookie-aware server wrapper already used by app/account/page.tsx),
 * never the browser client -- a browser Supabase client constructed
 * during SSR silently carries no session and executes as `anon` (see
 * lib/seller/get-published-listing-edit-state.ts's own header for the
 * exact same failure mode this avoids). Delegates the actual "which
 * restriction wins, and what does it say" decision to the same pure
 * selectInteractionBlockedPresentation the browser interpreter uses, so
 * the two can never silently diverge in copy or precedence -- only the
 * restriction-fetching client differs.
 *
 * Same contract as interpretInteractionBlocked: returns null immediately
 * for anything other than INTERACTION_BLOCKED (no lookup is issued for
 * any other code), never throws, and returns null on a failed lookup,
 * an empty/malformed result, or when the caller's active restrictions
 * don't include any type this action cares about. The backend remains
 * the sole enforcement authority -- this only re-interprets a denial
 * that has already happened server-side, and can never cause an action
 * to proceed.
 */
export async function interpretInteractionBlockedServer(
  errorCode: string,
  relevantTypesInPrecedenceOrder: RestrictionType[],
): Promise<InteractionBlockedPresentation | null> {
  if (errorCode !== "INTERACTION_BLOCKED") return null;

  try {
    const result = await getMyActiveRestrictions();
    if (result.hadError) return null;

    const activeTypes = result.restrictions.map((restriction) => restriction.restrictionType);
    return selectInteractionBlockedPresentation(activeTypes, relevantTypesInPrecedenceOrder);
  } catch (err) {
    // getMyActiveRestrictions is documented to fail open and never throw,
    // but this helper preserves the generic error unconditionally
    // regardless -- it must never itself become the reason a load failure
    // surfaces worse than the existing generic copy.
    console.error("interpretInteractionBlockedServer lookup threw:", err instanceof Error ? err.message : err);
    return null;
  }
}
