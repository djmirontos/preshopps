import { getMyActiveRestrictionsClient } from "@/lib/moderation/get-my-active-restrictions-client";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

export type InteractionBlockedPresentation = {
  message: string;
  ctaLabel: string;
  href: string;
};

const ACCOUNT_STATUS_HREF = "/account#account-status";
const CTA_LABEL = "View account status";

/**
 * Copy for every restriction_type_enum value, so this helper stays
 * reusable by future INTERACTION_BLOCKED call sites (A2.2.2) without a
 * rewrite -- callers scope which of these actually apply to their own
 * action via `relevantTypesInPrecedenceOrder`, so an irrelevant type (e.g.
 * seller_suspended for a buyer-facing checkout) can never surface here.
 */
const RESTRICTION_MESSAGES: Record<RestrictionType, string> = {
  seller_suspended: "Your selling access is currently suspended.",
  buyer_restricted: "Your buying access is currently restricted.",
  account_suspended: "Your account is currently suspended.",
};

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
 */
export async function interpretInteractionBlocked(
  errorCode: string,
  relevantTypesInPrecedenceOrder: RestrictionType[],
): Promise<InteractionBlockedPresentation | null> {
  if (errorCode !== "INTERACTION_BLOCKED") return null;

  try {
    const result = await getMyActiveRestrictionsClient();
    if (!result.ok) return null;

    const activeTypes = new Set(result.restrictions.map((restriction) => restriction.restrictionType));

    for (const type of relevantTypesInPrecedenceOrder) {
      if (activeTypes.has(type)) {
        return { message: RESTRICTION_MESSAGES[type], ctaLabel: CTA_LABEL, href: ACCOUNT_STATUS_HREF };
      }
    }

    return null;
  } catch (err) {
    // getMyActiveRestrictionsClient is documented to fail open and never
    // throw, but this helper preserves the generic error unconditionally
    // regardless -- it must never itself become the reason a checkout
    // failure surfaces worse than the existing generic copy.
    console.error("interpretInteractionBlocked lookup threw:", err instanceof Error ? err.message : err);
    return null;
  }
}
