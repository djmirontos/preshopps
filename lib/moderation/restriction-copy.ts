import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

/**
 * Centralized plain-language restriction copy -- the single source of
 * truth so no component hardcodes per-type strings, matching
 * lib/notifications/notification-copy.ts's own established convention.
 * Deliberately does not mention expiry/duration, moderator identity, or a
 * severity score -- none of that exists in get_my_active_restrictions' own
 * return shape (there is no expires_at column anywhere in this schema).
 */
export function getRestrictionTitle(type: RestrictionType): string {
  switch (type) {
    case "seller_suspended":
      return "Selling suspended";
    case "buyer_restricted":
      return "Buying restricted";
    case "account_suspended":
      return "Account suspended";
  }
}

export function getRestrictionSupportingCopy(type: RestrictionType): string {
  switch (type) {
    case "seller_suspended":
      return "You can't use normal selling features while this restriction is active.";
    case "buyer_restricted":
      return "You can't place or update purchases while this restriction is active.";
    case "account_suspended":
      return "Buying and selling actions are restricted while this suspension is active.";
  }
}
