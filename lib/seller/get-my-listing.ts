import { createClient } from "@/lib/supabase/server";
import type { ListingTypeFilter, FulfillmentMethod } from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";

export type MyListingStatus = "draft" | "available" | "reserved" | "paused" | "sold" | "archived";

export type MyListingImage = {
  id: string;
  storagePath: string;
  position: number;
  isReferenceImage: boolean;
};

export type MyListingVehicleDetails = {
  brand: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  transmission: string | null;
  fuelType: string | null;
  registrationStatus: "registered" | "expired_registration" | "for_renewal" | null;
  documentsAvailable: string[] | null;
};

export type MyListingRentalDetails = {
  rentalPriceCents: number | null;
  rentalPeriod: "daily" | "weekly" | "monthly" | "other" | null;
  securityDepositCents: number | null;
  rentalTerms: string | null;
  minimumRentalPeriod: string | null;
  capacity: number | null;
  whatsIncluded: string | null;
  rulesRestrictions: string | null;
  availability: "available" | "unavailable" | "paused" | null;
};

export type MyListing = {
  listingId: string;
  publicCode: string;
  slug: string;
  status: MyListingStatus;
  title: string;
  description: string | null;
  categoryId: number | null;
  listingType: ListingTypeFilter | null;
  condition: ListingCondition | "brand_new" | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  isNegotiable: boolean;
  brand: string | null;
  knownFlaws: string | null;
  stockQuantity: number;
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
  meetupNote: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  fulfillmentMethods: FulfillmentMethod[];
  images: MyListingImage[];
  vehicleDetails: MyListingVehicleDetails | null;
  rentalDetails: MyListingRentalDetails | null;
};

export type GetMyListingResult = { status: "found"; listing: MyListing } | { status: "not_found" } | { status: "error" };

type GetMyListingRpcRow = {
  listing_id: string;
  public_code: string;
  slug: string;
  status: MyListingStatus;
  title: string;
  description: string | null;
  category_id: number | null;
  listing_type: ListingTypeFilter | null;
  condition: (ListingCondition | "brand_new") | null;
  price_cents: number | null;
  original_price_cents: number | null;
  is_negotiable: boolean;
  brand: string | null;
  known_flaws: string | null;
  stock_quantity: number;
  province_id: number | null;
  city_id: number | null;
  barangay_id: number | null;
  meetup_note: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  fulfillment_methods: FulfillmentMethod[] | null;
  images:
    | { id: string; storage_path: string; position: number; is_reference_image: boolean }[]
    | null;
  vehicle_details: {
    brand: string | null;
    model: string | null;
    year: number | null;
    mileage_km: number | null;
    transmission: string | null;
    fuel_type: string | null;
    registration_status: "registered" | "expired_registration" | "for_renewal" | null;
    documents_available: string[] | null;
  } | null;
  rental_details: {
    rental_price_cents: number | null;
    rental_period: "daily" | "weekly" | "monthly" | "other" | null;
    security_deposit_cents: number | null;
    rental_terms: string | null;
    minimum_rental_period: string | null;
    capacity: number | null;
    whats_included: string | null;
    rules_restrictions: string | null;
    availability: "available" | "unavailable" | "paused" | null;
  } | null;
};

/**
 * Thin server-side read wrapper around get_my_listing (0063), following
 * lib/seller/get-my-shop-order-detail.ts's own established privacy
 * pattern exactly: LISTING_NOT_FOUND, NOT_LISTING_OWNER, and SHOP_NOT_FOUND
 * (the caller has no shop at all) all collapse to the same "not_found"
 * result -- a listing id belonging to another seller, or one that doesn't
 * exist, or a caller who never even set up a shop, must never be
 * distinguishable from the outside. get_my_listing (unlike
 * get_my_shop_order_detail) raises rather than silently returning zero
 * rows for these cases, so the raised `detail` code is what drives the
 * mapping here.
 */
export async function getMyListing(listingId: string): Promise<GetMyListingResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_listing", { p_listing_id: listingId }));
  } catch (err) {
    console.error("get_my_listing RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    const detail = (error as { details?: string }).details;
    if (detail === "LISTING_NOT_FOUND" || detail === "NOT_LISTING_OWNER" || detail === "SHOP_NOT_FOUND") {
      return { status: "not_found" };
    }
    console.error("get_my_listing RPC failed:", error.message);
    return { status: "error" };
  }

  const row = ((data ?? []) as GetMyListingRpcRow[])[0];
  if (!row) {
    return { status: "not_found" };
  }

  return {
    status: "found",
    listing: {
      listingId: row.listing_id,
      publicCode: row.public_code,
      slug: row.slug,
      status: row.status,
      title: row.title,
      description: row.description,
      categoryId: row.category_id,
      listingType: row.listing_type,
      condition: row.condition,
      priceCents: row.price_cents,
      originalPriceCents: row.original_price_cents,
      isNegotiable: row.is_negotiable,
      brand: row.brand,
      knownFlaws: row.known_flaws,
      stockQuantity: row.stock_quantity,
      provinceId: row.province_id,
      cityId: row.city_id,
      barangayId: row.barangay_id,
      meetupNote: row.meetup_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
      fulfillmentMethods: row.fulfillment_methods ?? [],
      images: (row.images ?? []).map((image) => ({
        id: image.id,
        storagePath: image.storage_path,
        position: image.position,
        isReferenceImage: image.is_reference_image,
      })),
      vehicleDetails: row.vehicle_details
        ? {
            brand: row.vehicle_details.brand,
            model: row.vehicle_details.model,
            year: row.vehicle_details.year,
            mileageKm: row.vehicle_details.mileage_km,
            transmission: row.vehicle_details.transmission,
            fuelType: row.vehicle_details.fuel_type,
            registrationStatus: row.vehicle_details.registration_status,
            documentsAvailable: row.vehicle_details.documents_available,
          }
        : null,
      rentalDetails: row.rental_details
        ? {
            rentalPriceCents: row.rental_details.rental_price_cents,
            rentalPeriod: row.rental_details.rental_period,
            securityDepositCents: row.rental_details.security_deposit_cents,
            rentalTerms: row.rental_details.rental_terms,
            minimumRentalPeriod: row.rental_details.minimum_rental_period,
            capacity: row.rental_details.capacity,
            whatsIncluded: row.rental_details.whats_included,
            rulesRestrictions: row.rental_details.rules_restrictions,
            availability: row.rental_details.availability,
          }
        : null,
    },
  };
}
