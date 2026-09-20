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
 * reusable by future INTERACTION_BLOCKED call sites without a rewrite --
 * callers scope which of these actually apply to their own action via
 * `relevantTypesInPrecedenceOrder`, so an irrelevant type (e.g.
 * seller_suspended for a buyer-facing checkout) can never surface here.
 */
const RESTRICTION_MESSAGES: Record<RestrictionType, string> = {
  seller_suspended: "Your selling access is currently suspended.",
  buyer_restricted: "Your buying access is currently restricted.",
  account_suspended: "Your account is currently suspended.",
};

/**
 * Pure precedence-matching core shared by every INTERACTION_BLOCKED
 * interpreter, browser (interpretInteractionBlocked) and server
 * (interpretInteractionBlockedServer) alike -- no Supabase client, no
 * network I/O, no knowledge of error codes or RPC identity, only a plain
 * value in, plain value out. Both interpreters fetch the caller's own
 * active restrictions through their own context-appropriate client, then
 * delegate the actual "which one wins, and what does it say" decision
 * here, so the two can never silently diverge in copy or precedence.
 *
 * Given the caller's own already-fetched active restriction types and
 * the ordered list of types a specific action cares about, returns the
 * first matching presentation, or null when none of the caller's active
 * restrictions are relevant to this action -- including when the caller
 * has no active restrictions at all (e.g. an unrelated deleted-account
 * INTERACTION_BLOCKED, which correctly has zero active restriction rows).
 */
export function selectInteractionBlockedPresentation(
  activeRestrictionTypes: RestrictionType[],
  relevantTypesInPrecedenceOrder: RestrictionType[],
): InteractionBlockedPresentation | null {
  const activeTypes = new Set(activeRestrictionTypes);

  for (const type of relevantTypesInPrecedenceOrder) {
    if (activeTypes.has(type)) {
      return { message: RESTRICTION_MESSAGES[type], ctaLabel: CTA_LABEL, href: ACCOUNT_STATUS_HREF };
    }
  }

  return null;
}
