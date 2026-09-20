import { getMyActiveRestrictionsClient } from "@/lib/moderation/get-my-active-restrictions-client";
import { selectInteractionBlockedPresentation, type InteractionBlockedPresentation } from "@/lib/moderation/select-interaction-blocked-presentation";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

// Re-exported so every existing importer of this module keeps working
// unchanged -- the canonical definition now lives in the pure,
// dependency-free selector module, shared with the server interpreter
// (interpret-interaction-blocked-server.ts) as well.
export type { InteractionBlockedPresentation };

/**
 * Turns a generic INTERACTION_BLOCKED failure into a restriction-aware
 * explanation, IF (and only if) the caller's own current restriction
 * state actually confirms one of the types the specific action cares
 * about -- never assumes a restriction caused the failure.
 * INTERACTION_BLOCKED is also raised for an unrelated deleted/anonymized-
 * account condition across the same RPCs, which correctly falls through
 * to null here, since get_my_active_restrictions() returns no rows for a
 * deleted profile.
 *
 * `relevantTypesInPrecedenceOrder` both scopes which restriction types
 * this action cares about (a seller-only action must never surface
 * buyer_restricted) and fixes the precedence when more than one is
 * active -- the first entry in this array the caller currently has wins.
 * Reads only get_my_active_restrictions() -- never another user's data.
 *
 * Never throws, and never runs the lookup for anything other than
 * INTERACTION_BLOCKED (not other error codes, not a successful result).
 * The backend remains the sole enforcement authority: this only
 * interprets a denial that has already happened server-side, and its
 * result can never cause an action to proceed.
 *
 * Browser-only: uses getMyActiveRestrictionsClient (the browser Supabase
 * client). Server Component callers must use the separate server-safe
 * interpretInteractionBlockedServer (interpret-interaction-blocked-server.ts)
 * instead -- see that module's own header for why. Both delegate the
 * actual precedence-matching decision to the same pure
 * selectInteractionBlockedPresentation, so they can never diverge in
 * copy or precedence; only the restriction-fetching client differs.
 */
export async function interpretInteractionBlocked(
  errorCode: string,
  relevantTypesInPrecedenceOrder: RestrictionType[],
): Promise<InteractionBlockedPresentation | null> {
  if (errorCode !== "INTERACTION_BLOCKED") return null;

  try {
    const result = await getMyActiveRestrictionsClient();
    if (!result.ok) return null;

    const activeTypes = result.restrictions.map((restriction) => restriction.restrictionType);
    return selectInteractionBlockedPresentation(activeTypes, relevantTypesInPrecedenceOrder);
  } catch (err) {
    // getMyActiveRestrictionsClient is documented to fail open and never
    // throw, but this helper preserves the generic error unconditionally
    // regardless -- it must never itself become the reason a checkout
    // failure surfaces worse than the existing generic copy.
    console.error("interpretInteractionBlocked lookup threw:", err instanceof Error ? err.message : err);
    return null;
  }
}
