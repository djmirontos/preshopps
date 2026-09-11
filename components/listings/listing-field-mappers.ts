import type { VehicleRegistrationStatus, RentalAvailability, RentalPeriod } from "@/lib/marketplace/listing-detail";
import type { MyListingVehicleDetails, MyListingRentalDetails } from "@/lib/seller/get-my-listing";
import { centsToPesosInput } from "@/lib/seller/price-cents";

/**
 * Pure get_my_listing -> edit-form field-value mappers, deliberately kept in
 * a plain module with no "use client" directive and no React/browser APIs.
 * They are called directly (not rendered as JSX) from the Server Component
 * at app/sell/[listingId]/edit/page.tsx, which only Server Components can
 * do for exports of a module that isn't a client boundary -- a "use client"
 * file's exports are opaque client references there and throw
 * "Attempted to call X() from the server but X is on the client" the
 * instant a Server Component invokes them as functions. ListingVehicleFields
 * and ListingRentalFields (both "use client", since they render the actual
 * form controls) re-export these same values rather than redefining them,
 * so client-side callers keep their existing import paths and there is
 * exactly one definition of each type/constant/mapper.
 */

export type VehicleFieldValues = {
  brand: string;
  model: string;
  year: string;
  mileageKm: string;
  transmission: string;
  fuelType: string;
  registrationStatus: VehicleRegistrationStatus | "";
  documentsAvailable: string[];
};

export const EMPTY_VEHICLE_VALUES: VehicleFieldValues = {
  brand: "",
  model: "",
  year: "",
  mileageKm: "",
  transmission: "",
  fuelType: "",
  registrationStatus: "",
  documentsAvailable: [],
};

/** Converts get_my_listing's vehicleDetails row (or its absence) into this
 * form's raw-string field shape, for the edit page's own initial prefill. */
export function vehicleFieldValuesFromServer(details: MyListingVehicleDetails | null): VehicleFieldValues {
  if (!details) return EMPTY_VEHICLE_VALUES;
  return {
    brand: details.brand ?? "",
    model: details.model ?? "",
    year: details.year !== null ? String(details.year) : "",
    mileageKm: details.mileageKm !== null ? String(details.mileageKm) : "",
    transmission: details.transmission ?? "",
    fuelType: details.fuelType ?? "",
    registrationStatus: details.registrationStatus ?? "",
    documentsAvailable: details.documentsAvailable ?? [],
  };
}

/** All-string raw form state -- money fields parsed via parsePesosToCents
 * only at submit/build time, same convention as ListingForm's own price
 * field. `availability` defaults to "available" (the column's own NOT
 * NULL default, and what create_listing/update_listing already default to
 * when the sub-key is omitted from a supplied object) rather than an
 * empty/unset state, since the column structurally can never be null. */
export type RentalFieldValues = {
  priceInput: string;
  period: RentalPeriod | "";
  securityDepositInput: string;
  terms: string;
  minimumRentalPeriod: string;
  capacity: string;
  whatsIncluded: string;
  rulesRestrictions: string;
  availability: RentalAvailability;
};

export const EMPTY_RENTAL_VALUES: RentalFieldValues = {
  priceInput: "",
  period: "",
  securityDepositInput: "",
  terms: "",
  minimumRentalPeriod: "",
  capacity: "",
  whatsIncluded: "",
  rulesRestrictions: "",
  availability: "available",
};

/** Converts get_my_listing's rentalDetails row (or its absence) into this
 * form's raw-string field shape, for the edit page's own initial prefill. */
export function rentalFieldValuesFromServer(details: MyListingRentalDetails | null): RentalFieldValues {
  if (!details) return EMPTY_RENTAL_VALUES;
  return {
    priceInput: centsToPesosInput(details.rentalPriceCents),
    period: details.rentalPeriod ?? "",
    securityDepositInput: centsToPesosInput(details.securityDepositCents),
    terms: details.rentalTerms ?? "",
    minimumRentalPeriod: details.minimumRentalPeriod ?? "",
    capacity: details.capacity !== null ? String(details.capacity) : "",
    whatsIncluded: details.whatsIncluded ?? "",
    rulesRestrictions: details.rulesRestrictions ?? "",
    availability: details.availability ?? "available",
  };
}
