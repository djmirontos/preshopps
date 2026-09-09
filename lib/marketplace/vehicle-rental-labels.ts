import type { RentalAvailability, RentalPeriod, VehicleRegistrationStatus } from "@/lib/marketplace/listing-detail";

/**
 * Shared vehicle/rental enum display labels -- extracted from
 * ListingSpecificDetails (the original, buyer-facing owner of these maps)
 * so the seller-facing ListingVehicleFields/ListingRentalFields form
 * components can reuse the exact same copy rather than re-declaring it.
 * Only type-only imports are pulled from lib/marketplace/listing-detail
 * (a server-only module via its own supabase import) -- those are erased
 * at compile time, so this module itself stays fully client-safe.
 */

export const REGISTRATION_LABELS: Record<VehicleRegistrationStatus, string> = {
  registered: "Registered",
  expired_registration: "Expired Registration",
  for_renewal: "For Renewal",
};

/** Per-unit suffix form, e.g. "₱500 / day" -- for display contexts only. */
export const RENTAL_PERIOD_LABELS: Record<RentalPeriod, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  other: "period",
};

/** Standalone option-label form, e.g. a form <select>'s own visible option
 * text -- "day" alone reads as a typo there, so this is a deliberate
 * second map for that different display context, not a duplicate of the
 * per-unit-suffix map above. */
export const RENTAL_PERIOD_OPTION_LABELS: Record<RentalPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  other: "Other",
};

export const RENTAL_AVAILABILITY_LABELS: Record<RentalAvailability, string> = {
  available: "Available",
  unavailable: "Unavailable",
  paused: "Paused",
};
