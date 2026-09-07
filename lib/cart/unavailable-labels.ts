import type { HydratedGuestCartLine } from "@/lib/cart/hydrate-guest-cart-client";

/**
 * Shared human-readable labels for get_my_cart's unavailable_reason enum
 * (0037_favorites_cart_rls_and_rpcs.sql) and the guest-cart equivalent
 * derived client-side in hydrate-guest-cart-client.ts's isGuestLineSubmittable/
 * guestUnavailableReason below. Kept in one place so the authenticated and
 * guest cart renderers never drift on wording.
 */
export const UNAVAILABLE_LABELS: Record<string, string> = {
  no_longer_available: "No longer available",
  own_listing: "This is your own listing",
  blocked: "Unavailable",
  buyer_restricted: "Your account can't submit orders right now",
  inquiry_only: "No longer available for cart",
  reserved: "Reserved",
  sold: "Sold",
  archived: "Archived",
  insufficient_stock: "Not enough stock available",
};

export function labelForUnavailableReason(reason: string | null): string | null {
  if (!reason) return null;
  return UNAVAILABLE_LABELS[reason] ?? "Unavailable";
}

export function isGuestLineSubmittable(line: HydratedGuestCartLine): boolean {
  return (
    line.found &&
    line.status === "available" &&
    !line.isInquiryOnly &&
    line.availableQuantity !== null &&
    line.quantity <= line.availableQuantity
  );
}

export function guestUnavailableReason(line: HydratedGuestCartLine): string | null {
  if (!line.found) return "no_longer_available";
  if (line.isInquiryOnly) return "inquiry_only";
  if (line.status === "reserved") return "reserved";
  if (line.status === "sold") return "sold";
  if (line.status === "archived") return "archived";
  if (line.availableQuantity !== null && line.quantity > line.availableQuantity) return "insufficient_stock";
  return null;
}
