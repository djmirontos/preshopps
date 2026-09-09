import { createClient } from "@/lib/supabase/client";
import type { ListingTypeFilter, FulfillmentMethod } from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";

/**
 * Thin client wrapper around create_listing (0054/0055/0056/0062), mirroring
 * lib/seller/shop-actions.ts's own established conventions exactly: RPC
 * identity is always derived server-side from auth.uid(), no owner/shop id
 * is ever sent from the client, and every failure mode maps to a typed
 * code + safe copy rather than a raw Postgres error ever reaching the UI.
 * This first frontend slice never supplies p_image_paths/p_vehicle_details/
 * p_rental_details -- those remain null, exactly like every other
 * not-yet-built field group.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export type CreateListingInput = {
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
  stockQuantity: number | null;
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
  meetupNote: string | null;
  fulfillmentMethods: FulfillmentMethod[];
};

export type CreateListingErrorCode =
  | "NOT_AUTHENTICATED"
  | "SHOP_NOT_FOUND"
  | "INTERACTION_BLOCKED"
  | "TITLE_REQUIRED"
  | "CATEGORY_NOT_FOUND"
  | "LISTING_TYPE_CONDITION_MISMATCH"
  | "KNOWN_FLAWS_REQUIRED"
  | "PRICE_INVALID"
  | "ORIGINAL_PRICE_INVALID"
  | "STOCK_QUANTITY_INVALID"
  | "CITY_REQUIRES_PROVINCE"
  | "BARANGAY_REQUIRES_CITY"
  | "INVALID_CITY_FOR_PROVINCE"
  | "INVALID_BARANGAY_FOR_CITY"
  | "FULFILLMENT_INVALID"
  | "TOO_MANY_LISTING_IMAGES"
  | "LISTING_IMAGE_PATH_INVALID"
  | "VEHICLE_DETAILS_NOT_ALLOWED"
  | "VEHICLE_DETAILS_INVALID"
  | "RENTAL_DETAILS_NOT_ALLOWED"
  | "RENTAL_DETAILS_INVALID";

const CREATE_LISTING_ERROR_CODES: ReadonlySet<string> = new Set<CreateListingErrorCode>([
  "NOT_AUTHENTICATED",
  "SHOP_NOT_FOUND",
  "INTERACTION_BLOCKED",
  "TITLE_REQUIRED",
  "CATEGORY_NOT_FOUND",
  "LISTING_TYPE_CONDITION_MISMATCH",
  "KNOWN_FLAWS_REQUIRED",
  "PRICE_INVALID",
  "ORIGINAL_PRICE_INVALID",
  "STOCK_QUANTITY_INVALID",
  "CITY_REQUIRES_PROVINCE",
  "BARANGAY_REQUIRES_CITY",
  "INVALID_CITY_FOR_PROVINCE",
  "INVALID_BARANGAY_FOR_CITY",
  "FULFILLMENT_INVALID",
  "TOO_MANY_LISTING_IMAGES",
  "LISTING_IMAGE_PATH_INVALID",
  "VEHICLE_DETAILS_NOT_ALLOWED",
  "VEHICLE_DETAILS_INVALID",
  "RENTAL_DETAILS_NOT_ALLOWED",
  "RENTAL_DETAILS_INVALID",
]);

export const CREATE_LISTING_ERROR_MESSAGES: ErrorMap<CreateListingErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  SHOP_NOT_FOUND: "Please set up your shop first.",
  INTERACTION_BLOCKED: "You are not able to create listings right now.",
  TITLE_REQUIRED: "Please enter a title for your listing.",
  CATEGORY_NOT_FOUND: "That category no longer exists. Please choose again.",
  LISTING_TYPE_CONDITION_MISMATCH: "That condition doesn't match the selected listing type.",
  KNOWN_FLAWS_REQUIRED: "Please describe the known flaws for Fair condition.",
  PRICE_INVALID: "Please enter a valid price.",
  ORIGINAL_PRICE_INVALID: "Original price must not be lower than the current price.",
  STOCK_QUANTITY_INVALID: "Stock quantity must be at least 1.",
  CITY_REQUIRES_PROVINCE: "Please choose a province first.",
  BARANGAY_REQUIRES_CITY: "Please choose a city or municipality first.",
  INVALID_CITY_FOR_PROVINCE: "That city doesn't belong to the selected province. Please choose again.",
  INVALID_BARANGAY_FOR_CITY: "That barangay doesn't belong to the selected city. Please choose again.",
  FULFILLMENT_INVALID: "Please review your selected fulfillment methods.",
  TOO_MANY_LISTING_IMAGES: "A listing may have at most 8 photos.",
  LISTING_IMAGE_PATH_INVALID: "There was a problem with one of your photos.",
  VEHICLE_DETAILS_NOT_ALLOWED: "Vehicle details are only allowed for Cars/Motorcycles listings.",
  VEHICLE_DETAILS_INVALID: "There was a problem with the vehicle details provided.",
  RENTAL_DETAILS_NOT_ALLOWED: "Rental details are only allowed for For Rent listings.",
  RENTAL_DETAILS_INVALID: "There was a problem with the rental details provided.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type CreateListingResult =
  | { ok: true; listingId: string; publicCode: string; slug: string; status: string; createdAt: string }
  | { ok: false; code: CreateListingErrorCode | "UNKNOWN" };

type CreateListingRpcRow = { listing_id: string; public_code: string; slug: string; status: string; created_at: string };

export async function createListing(input: CreateListingInput): Promise<CreateListingResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("create_listing", {
      p_title: input.title,
      p_description: input.description,
      p_category_id: input.categoryId,
      p_listing_type: input.listingType,
      p_condition: input.condition,
      p_price_cents: input.priceCents,
      p_original_price_cents: input.originalPriceCents,
      p_is_negotiable: input.isNegotiable,
      p_brand: input.brand,
      p_known_flaws: input.knownFlaws,
      p_stock_quantity: input.stockQuantity,
      p_province_id: input.provinceId,
      p_city_id: input.cityId,
      p_barangay_id: input.barangayId,
      p_meetup_note: input.meetupNote,
      p_fulfillment_methods: input.fulfillmentMethods,
      p_image_paths: null,
      p_vehicle_details: null,
      p_rental_details: null,
    });

    if (error) {
      console.error("create_listing RPC failed:", error.message);
      return { ok: false, code: toErrorCode<CreateListingErrorCode>((error as { details?: string }).details, CREATE_LISTING_ERROR_CODES) };
    }

    const row = ((data ?? []) as CreateListingRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, listingId: row.listing_id, publicCode: row.public_code, slug: row.slug, status: row.status, createdAt: row.created_at };
  } catch (err) {
    console.error("create_listing RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
