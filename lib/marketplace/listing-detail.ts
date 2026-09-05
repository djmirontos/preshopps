import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime, getListingImageUrl } from "@/lib/marketplace/browse-listings";
import type { ListingCondition } from "@/components/marketplace/ListingCard";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

export type VehicleRegistrationStatus = "registered" | "expired_registration" | "for_renewal";
export type RentalPeriod = "daily" | "weekly" | "monthly" | "other";
export type RentalAvailability = "available" | "unavailable" | "paused";

/**
 * Row shape exactly matching public.get_listing_detail's RETURNS TABLE,
 * confirmed live via pg_get_functiondef immediately before writing this
 * module. The vehicle_ and rental_ prefixed columns each come from their
 * own LEFT JOIN (listing_vehicle_details / listing_rental_details) --
 * all null together when the listing has no matching detail row, and
 * individually nullable within that row otherwise.
 */
export type GetListingDetailRow = {
  listing_id: string;
  public_code: string;
  slug: string;
  title: string;
  description: string;
  listing_type: "preloved" | "brand_new";
  condition: "brand_new" | "like_new" | "very_good" | "good" | "fair";
  known_flaws: string | null;
  brand: string | null;
  price_cents: number;
  original_price_cents: number | null;
  is_negotiable: boolean;
  status: "available" | "reserved" | "sold" | "archived";
  available_quantity: number;
  meetup_note: string | null;
  published_at: string | null;
  created_at: string;
  category_id: number;
  category_name: string;
  is_inquiry_only: boolean;
  province_name: string;
  city_name: string;
  barangay_name: string | null;
  image_paths: string[];
  fulfillment_methods: FulfillmentMethod[];
  shop_id: string;
  shop_slug: string;
  shop_name: string;
  shop_description: string | null;
  shop_logo_storage_path: string | null;
  shop_messenger_link: string | null;
  shop_status: "active" | "away";
  shop_is_trusted_seller: boolean;
  shop_member_since: string;
  review_count: number;
  average_rating: number | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_mileage_km: number | null;
  vehicle_transmission: string | null;
  vehicle_fuel_type: string | null;
  vehicle_registration_status: VehicleRegistrationStatus | null;
  vehicle_documents_available: string[] | null;
  rental_price_cents: number | null;
  rental_period: RentalPeriod | null;
  rental_security_deposit_cents: number | null;
  rental_terms: string | null;
  rental_minimum_rental_period: string | null;
  rental_capacity: number | null;
  rental_whats_included: string | null;
  rental_rules_restrictions: string | null;
  rental_availability: RentalAvailability | null;
};

export type VehicleDetails = {
  brand: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  transmission: string | null;
  fuelType: string | null;
  registrationStatus: VehicleRegistrationStatus | null;
  documentsAvailable: string[];
};

export type RentalDetails = {
  priceCents: number | null;
  period: RentalPeriod | null;
  securityDepositCents: number | null;
  terms: string | null;
  minimumRentalPeriod: string | null;
  capacity: number | null;
  whatsIncluded: string | null;
  rulesRestrictions: string | null;
  availability: RentalAvailability | null;
};

export type ListingStatus = GetListingDetailRow["status"];

export type ListingDetail = {
  id: string;
  publicCode: string;
  title: string;
  description: string;
  knownFlaws: string | null;
  listingType: "preloved" | "brand_new";
  condition: ListingCondition | undefined;
  priceCents: number;
  originalPriceCents: number | undefined;
  isNegotiable: boolean;
  status: ListingStatus;
  availableQuantity: number;
  meetupNote: string | null;
  postedLabel: string;
  categoryName: string;
  isInquiryOnly: boolean;
  locationLabel: string;
  imageUrls: string[];
  fulfillmentMethods: FulfillmentMethod[];
  shop: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | undefined;
    messengerLink: string | null;
    isTrustedSeller: boolean;
    memberSinceLabel: string;
    locationLabel: string;
  };
  reviewCount: number;
  averageRating: number | null;
  /** Present only when at least one structured field exists -- Cars/
   * Motorcycles listings without a matching listing_vehicle_details row
   * (or an ordinary non-vehicle listing) get null, never an empty object. */
  vehicleDetails: VehicleDetails | null;
  /** Present only when at least one structured field exists -- see
   * vehicleDetails. */
  rentalDetails: RentalDetails | null;
};

const VALID_CARD_CONDITIONS: ReadonlySet<string> = new Set<ListingCondition>([
  "like_new",
  "very_good",
  "good",
  "fair",
]);

function mapCondition(raw: GetListingDetailRow["condition"]): ListingCondition | undefined {
  return VALID_CARD_CONDITIONS.has(raw) ? (raw as ListingCondition) : undefined;
}

/** Barangay, City/Municipality, Province -- omitting any missing level
 * cleanly rather than rendering an empty segment. */
function composeLocationLabel(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(", ");
}

/** Built only when at least one field the LEFT JOIN could have returned is
 * actually present -- an ordinary listing (or a vehicle listing with no
 * matching detail row) maps to null, never an empty object. */
function mapVehicleDetails(row: GetListingDetailRow): VehicleDetails | null {
  const hasAnyField =
    row.vehicle_brand !== null ||
    row.vehicle_model !== null ||
    row.vehicle_year !== null ||
    row.vehicle_mileage_km !== null ||
    row.vehicle_transmission !== null ||
    row.vehicle_fuel_type !== null ||
    row.vehicle_registration_status !== null ||
    (row.vehicle_documents_available?.length ?? 0) > 0;

  if (!hasAnyField) return null;

  return {
    brand: row.vehicle_brand,
    model: row.vehicle_model,
    year: row.vehicle_year,
    mileageKm: row.vehicle_mileage_km,
    transmission: row.vehicle_transmission,
    fuelType: row.vehicle_fuel_type,
    registrationStatus: row.vehicle_registration_status,
    documentsAvailable: row.vehicle_documents_available ?? [],
  };
}

function mapRentalDetails(row: GetListingDetailRow): RentalDetails | null {
  const hasAnyField =
    row.rental_price_cents !== null ||
    row.rental_period !== null ||
    row.rental_security_deposit_cents !== null ||
    row.rental_terms !== null ||
    row.rental_minimum_rental_period !== null ||
    row.rental_capacity !== null ||
    row.rental_whats_included !== null ||
    row.rental_rules_restrictions !== null ||
    row.rental_availability !== null;

  if (!hasAnyField) return null;

  return {
    priceCents: row.rental_price_cents,
    period: row.rental_period,
    securityDepositCents: row.rental_security_deposit_cents,
    terms: row.rental_terms,
    minimumRentalPeriod: row.rental_minimum_rental_period,
    capacity: row.rental_capacity,
    whatsIncluded: row.rental_whats_included,
    rulesRestrictions: row.rental_rules_restrictions,
    availability: row.rental_availability,
  };
}

export function mapDetailRowToListingDetail(row: GetListingDetailRow): ListingDetail {
  return {
    id: row.listing_id,
    publicCode: row.public_code,
    title: row.title,
    description: row.description,
    knownFlaws: row.known_flaws,
    listingType: row.listing_type,
    condition: row.listing_type === "preloved" ? mapCondition(row.condition) : undefined,
    priceCents: row.price_cents,
    originalPriceCents: row.original_price_cents ?? undefined,
    isNegotiable: row.is_negotiable,
    status: row.status,
    availableQuantity: row.available_quantity,
    meetupNote: row.meetup_note,
    postedLabel: formatRelativeTime(row.published_at ?? row.created_at),
    categoryName: row.category_name,
    isInquiryOnly: row.is_inquiry_only,
    locationLabel: composeLocationLabel([row.barangay_name, row.city_name, row.province_name]),
    imageUrls: row.image_paths
      .map((path) => getListingImageUrl(path))
      .filter((url): url is string => Boolean(url)),
    fulfillmentMethods: row.fulfillment_methods,
    shop: {
      id: row.shop_id,
      slug: row.shop_slug,
      name: row.shop_name,
      logoUrl: getListingImageUrl(row.shop_logo_storage_path),
      messengerLink: row.shop_messenger_link,
      isTrustedSeller: row.shop_is_trusted_seller,
      memberSinceLabel: new Date(row.shop_member_since).toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric",
      }),
      locationLabel: composeLocationLabel([row.city_name, row.province_name]),
    },
    reviewCount: row.review_count,
    averageRating: row.average_rating,
    vehicleDetails: mapVehicleDetails(row),
    rentalDetails: mapRentalDetails(row),
  };
}

export type ListingDetailResult =
  | { status: "found"; listing: ListingDetail }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Client creation happens before any RPC-specific error handling begins,
 * mirroring the locked pattern in browse-listings.ts -- only the
 * get_listing_detail invocation itself is wrapped, and only to catch a
 * genuine transport-level failure. The RPC's own LISTING_NOT_FOUND signal
 * (raised identically for a nonexistent, draft, paused, or suspended-
 * seller listing -- the backend never distinguishes these) is read from
 * the Postgrest error's `details` field and mapped to "not_found"; any
 * other error is a genuine failure and must never collapse into the same
 * "not_found" outcome the page uses for Next's notFound().
 */
export async function getListingDetail(publicCode: string): Promise<ListingDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_listing_detail", { p_public_code: publicCode }));
  } catch (err) {
    console.error("get_listing_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "LISTING_NOT_FOUND") {
      return { status: "not_found" };
    }
    console.error("get_listing_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetListingDetailRow[];
  if (rows.length === 0) {
    return { status: "not_found" };
  }

  return { status: "found", listing: mapDetailRowToListingDetail(rows[0]) };
}
