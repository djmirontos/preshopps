import { createClient } from "@/lib/supabase/client";
import type { ListingTypeFilter, FulfillmentMethod } from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";

/**
 * Thin client wrapper around create_listing (0054/0055/0056/0062), mirroring
 * lib/seller/shop-actions.ts's own established conventions exactly: RPC
 * identity is always derived server-side from auth.uid(), no owner/shop id
 * is ever sent from the client, and every failure mode maps to a typed
 * code + safe copy rather than a raw Postgres error ever reaching the UI.
 * Images remain out of scope here (p_image_paths stays null) -- vehicle/
 * rental JSON objects are built by ListingVehicleFields/ListingRentalFields
 * (components/seller/) and passed straight through unchanged.
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
  /** Built by buildVehicleDetailsJson (ListingVehicleFields) -- null when
   * empty or the category isn't vehicle-eligible. */
  vehicleDetails: Record<string, unknown> | null;
  /** Built by buildRentalDetailsJson (ListingRentalFields) -- null when
   * empty or the category isn't rental-eligible. */
  rentalDetails: Record<string, unknown> | null;
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
      p_vehicle_details: input.vehicleDetails,
      p_rental_details: input.rentalDetails,
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

// ============================================================
// updateListing (update_listing)
// ============================================================

/**
 * Mirrors update_listing's own JSONB patch contract (0061/0062) exactly:
 * a key absent from this object means "leave unchanged," a key present
 * with `null` means "clear this field," and a key present with a real
 * value means "set it." The caller (ListingForm) is responsible for only
 * including keys for fields that actually changed from the loaded
 * baseline -- this wrapper does not diff anything itself, it only ever
 * forwards whatever patch object it is given as p_patch, unchanged. title
 * and stock_quantity are typed as never-null here because update_listing
 * itself rejects a null for either (TITLE_REQUIRED / STOCK_QUANTITY_INVALID)
 * -- there is no valid patch shape that clears them.
 */
export type UpdateListingPatch = {
  title?: string;
  description?: string | null;
  category_id?: number | null;
  listing_type?: ListingTypeFilter | null;
  condition?: (ListingCondition | "brand_new") | null;
  price_cents?: number | null;
  original_price_cents?: number | null;
  is_negotiable?: boolean;
  brand?: string | null;
  known_flaws?: string | null;
  stock_quantity?: number;
  province_id?: number | null;
  city_id?: number | null;
  barangay_id?: number | null;
  meetup_note?: string | null;
  fulfillment_methods?: FulfillmentMethod[];
  /** Built by buildVehicleDetailsJson (ListingVehicleFields) when the
   * extension changed and now has values; `null` to explicitly delete the
   * row (the seller cleared every field, or the category changed away
   * from Cars/Motorcycles); omitted entirely to leave it untouched. */
  vehicle_details?: Record<string, unknown> | null;
  /** Same tri-state contract as vehicle_details, for
   * listing_rental_details / For Rent. */
  rental_details?: Record<string, unknown> | null;
};

export type UpdateListingErrorCode =
  | "NOT_AUTHENTICATED"
  | "SHOP_NOT_FOUND"
  | "INTERACTION_BLOCKED"
  | "LISTING_NOT_FOUND"
  | "NOT_LISTING_OWNER"
  | "LISTING_NOT_DRAFT"
  | "PATCH_INVALID"
  | "TITLE_REQUIRED"
  | "DESCRIPTION_INVALID"
  | "CATEGORY_INVALID"
  | "CATEGORY_NOT_FOUND"
  | "LISTING_TYPE_INVALID"
  | "CONDITION_INVALID"
  | "LISTING_TYPE_CONDITION_MISMATCH"
  | "KNOWN_FLAWS_INVALID"
  | "KNOWN_FLAWS_REQUIRED"
  | "PRICE_INVALID"
  | "ORIGINAL_PRICE_INVALID"
  | "IS_NEGOTIABLE_INVALID"
  | "STOCK_QUANTITY_INVALID"
  | "PROVINCE_INVALID"
  | "CITY_INVALID"
  | "BARANGAY_INVALID"
  | "CITY_REQUIRES_PROVINCE"
  | "BARANGAY_REQUIRES_CITY"
  | "INVALID_CITY_FOR_PROVINCE"
  | "INVALID_BARANGAY_FOR_CITY"
  | "BRAND_INVALID"
  | "MEETUP_NOTE_INVALID"
  | "FULFILLMENT_INVALID"
  | "VEHICLE_DETAILS_NOT_ALLOWED"
  | "VEHICLE_DETAILS_INVALID"
  | "RENTAL_DETAILS_NOT_ALLOWED"
  | "RENTAL_DETAILS_INVALID";

const UPDATE_LISTING_ERROR_CODES: ReadonlySet<string> = new Set<UpdateListingErrorCode>([
  "NOT_AUTHENTICATED",
  "SHOP_NOT_FOUND",
  "INTERACTION_BLOCKED",
  "LISTING_NOT_FOUND",
  "NOT_LISTING_OWNER",
  "LISTING_NOT_DRAFT",
  "PATCH_INVALID",
  "TITLE_REQUIRED",
  "DESCRIPTION_INVALID",
  "CATEGORY_INVALID",
  "CATEGORY_NOT_FOUND",
  "LISTING_TYPE_INVALID",
  "CONDITION_INVALID",
  "LISTING_TYPE_CONDITION_MISMATCH",
  "KNOWN_FLAWS_INVALID",
  "KNOWN_FLAWS_REQUIRED",
  "PRICE_INVALID",
  "ORIGINAL_PRICE_INVALID",
  "IS_NEGOTIABLE_INVALID",
  "STOCK_QUANTITY_INVALID",
  "PROVINCE_INVALID",
  "CITY_INVALID",
  "BARANGAY_INVALID",
  "CITY_REQUIRES_PROVINCE",
  "BARANGAY_REQUIRES_CITY",
  "INVALID_CITY_FOR_PROVINCE",
  "INVALID_BARANGAY_FOR_CITY",
  "BRAND_INVALID",
  "MEETUP_NOTE_INVALID",
  "FULFILLMENT_INVALID",
  "VEHICLE_DETAILS_NOT_ALLOWED",
  "VEHICLE_DETAILS_INVALID",
  "RENTAL_DETAILS_NOT_ALLOWED",
  "RENTAL_DETAILS_INVALID",
]);

export const UPDATE_LISTING_ERROR_MESSAGES: ErrorMap<UpdateListingErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  SHOP_NOT_FOUND: "Please set up your shop first.",
  INTERACTION_BLOCKED: "You are not able to edit listings right now.",
  LISTING_NOT_FOUND: "We couldn't find this listing. Please refresh and try again.",
  NOT_LISTING_OWNER: "We couldn't find this listing. Please refresh and try again.",
  LISTING_NOT_DRAFT: "Only Draft listings can be edited right now.",
  PATCH_INVALID: "Something went wrong. Please try again.",
  TITLE_REQUIRED: "Please enter a title for your listing.",
  DESCRIPTION_INVALID: "Please review your description.",
  CATEGORY_INVALID: "Please choose a category again.",
  CATEGORY_NOT_FOUND: "That category no longer exists. Please choose again.",
  LISTING_TYPE_INVALID: "Please choose a listing type again.",
  CONDITION_INVALID: "Please choose a condition again.",
  LISTING_TYPE_CONDITION_MISMATCH: "That condition doesn't match the selected listing type.",
  KNOWN_FLAWS_INVALID: "Please review the known flaws text.",
  KNOWN_FLAWS_REQUIRED: "Please describe the known flaws for Fair condition.",
  PRICE_INVALID: "Please enter a valid price.",
  ORIGINAL_PRICE_INVALID: "Original price must not be lower than the current price.",
  IS_NEGOTIABLE_INVALID: "Please review the negotiable option.",
  STOCK_QUANTITY_INVALID: "Stock quantity must be at least 1.",
  PROVINCE_INVALID: "Please choose a province again.",
  CITY_INVALID: "Please choose a city or municipality again.",
  BARANGAY_INVALID: "Please choose a barangay again.",
  CITY_REQUIRES_PROVINCE: "Please choose a province first.",
  BARANGAY_REQUIRES_CITY: "Please choose a city or municipality first.",
  INVALID_CITY_FOR_PROVINCE: "That city doesn't belong to the selected province. Please choose again.",
  INVALID_BARANGAY_FOR_CITY: "That barangay doesn't belong to the selected city. Please choose again.",
  BRAND_INVALID: "Please review the brand text.",
  MEETUP_NOTE_INVALID: "Please review the meetup note.",
  FULFILLMENT_INVALID: "Please review your selected fulfillment methods.",
  VEHICLE_DETAILS_NOT_ALLOWED: "Vehicle details are only allowed for Cars/Motorcycles listings.",
  VEHICLE_DETAILS_INVALID: "There was a problem with the vehicle details provided.",
  RENTAL_DETAILS_NOT_ALLOWED: "Rental details are only allowed for For Rent listings.",
  RENTAL_DETAILS_INVALID: "There was a problem with the rental details provided.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type UpdateListingResult =
  | { ok: true; listingId: string; publicCode: string; slug: string; status: string; updatedAt: string }
  | { ok: false; code: UpdateListingErrorCode | "UNKNOWN" };

type UpdateListingRpcRow = { listing_id: string; public_code: string; slug: string; status: string; updated_at: string };

export async function updateListing(listingId: string, patch: UpdateListingPatch): Promise<UpdateListingResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("update_listing", {
      p_listing_id: listingId,
      p_patch: patch,
    });

    if (error) {
      console.error("update_listing RPC failed:", error.message);
      return { ok: false, code: toErrorCode<UpdateListingErrorCode>((error as { details?: string }).details, UPDATE_LISTING_ERROR_CODES) };
    }

    const row = ((data ?? []) as UpdateListingRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, listingId: row.listing_id, publicCode: row.public_code, slug: row.slug, status: row.status, updatedAt: row.updated_at };
  } catch (err) {
    console.error("update_listing RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// replaceListingImages (replace_listing_images)
// ============================================================

/**
 * Thin wrapper around replace_listing_images (0060), same conventions as
 * every other RPC wrapper here. Always sends the COMPLETE desired ordered
 * image set -- position is the array index (position 0 is the cover by
 * construction) and `referenceFlags` is a parallel array of equal length,
 * exactly matching the RPC's own contract. The caller (ListingImagesPicker)
 * is responsible for only ever including ready/uploaded paths -- this
 * wrapper does not filter or reorder anything itself.
 */
export type ReplaceListingImagesErrorCode =
  | "NOT_AUTHENTICATED"
  | "SHOP_NOT_FOUND"
  | "INTERACTION_BLOCKED"
  | "LISTING_NOT_FOUND"
  | "NOT_LISTING_OWNER"
  | "LISTING_NOT_DRAFT"
  | "TOO_MANY_LISTING_IMAGES"
  | "IMAGE_ARRAYS_LENGTH_MISMATCH"
  | "LISTING_IMAGE_PATH_INVALID"
  | "DUPLICATE_LISTING_IMAGE_PATH";

const REPLACE_LISTING_IMAGES_ERROR_CODES: ReadonlySet<string> = new Set<ReplaceListingImagesErrorCode>([
  "NOT_AUTHENTICATED",
  "SHOP_NOT_FOUND",
  "INTERACTION_BLOCKED",
  "LISTING_NOT_FOUND",
  "NOT_LISTING_OWNER",
  "LISTING_NOT_DRAFT",
  "TOO_MANY_LISTING_IMAGES",
  "IMAGE_ARRAYS_LENGTH_MISMATCH",
  "LISTING_IMAGE_PATH_INVALID",
  "DUPLICATE_LISTING_IMAGE_PATH",
]);

export const REPLACE_LISTING_IMAGES_ERROR_MESSAGES: ErrorMap<ReplaceListingImagesErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  SHOP_NOT_FOUND: "Please set up your shop first.",
  INTERACTION_BLOCKED: "You are not able to edit listings right now.",
  LISTING_NOT_FOUND: "We couldn't find this listing. Please refresh and try again.",
  NOT_LISTING_OWNER: "We couldn't find this listing. Please refresh and try again.",
  LISTING_NOT_DRAFT: "Only Draft listings can be edited right now.",
  TOO_MANY_LISTING_IMAGES: "A listing may have at most 8 photos.",
  IMAGE_ARRAYS_LENGTH_MISMATCH: "Something went wrong with your photos. Please try again.",
  LISTING_IMAGE_PATH_INVALID: "There was a problem with one of your photos. Please try again.",
  DUPLICATE_LISTING_IMAGE_PATH: "The same photo was added more than once.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type ReplaceListingImagesResult =
  | { ok: true; listingId: string; imageCount: number; coverImageId: string | null }
  | { ok: false; code: ReplaceListingImagesErrorCode | "UNKNOWN" };

type ReplaceListingImagesRpcRow = { listing_id: string; image_count: number; cover_image_id: string | null };

export async function replaceListingImages(
  listingId: string,
  imagePaths: string[],
  referenceFlags: boolean[],
): Promise<ReplaceListingImagesResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("replace_listing_images", {
      p_listing_id: listingId,
      p_image_paths: imagePaths,
      p_reference_flags: referenceFlags,
    });

    if (error) {
      console.error("replace_listing_images RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<ReplaceListingImagesErrorCode>((error as { details?: string }).details, REPLACE_LISTING_IMAGES_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as ReplaceListingImagesRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, listingId: row.listing_id, imageCount: row.image_count, coverImageId: row.cover_image_id };
  } catch (err) {
    console.error("replace_listing_images RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// publishListing (publish_listing)
// ============================================================

/**
 * Thin wrapper around publish_listing (0057/0058) -- same conventions as
 * every other RPC wrapper here. The only parameter is the listing id;
 * ownership, draft-only status, seller-policy acceptance, and every
 * completeness rule are all re-derived/validated server-side, never
 * trusted from the client. SELLER_POLICIES_NOT_ACCEPTED is a real,
 * expected outcome (not an edge case) -- the caller is responsible for
 * reacting to it by showing the consent flow and retrying, exactly like
 * every other typed error code here; this wrapper does no special-casing.
 */
export type PublishListingErrorCode =
  | "NOT_AUTHENTICATED"
  | "SHOP_NOT_FOUND"
  | "INTERACTION_BLOCKED"
  | "LISTING_NOT_FOUND"
  | "NOT_LISTING_OWNER"
  | "LISTING_NOT_DRAFT"
  | "SELLER_POLICIES_NOT_ACCEPTED"
  | "TITLE_REQUIRED"
  | "DESCRIPTION_REQUIRED"
  | "CATEGORY_REQUIRED"
  | "LISTING_TYPE_REQUIRED"
  | "CONDITION_REQUIRED"
  | "LISTING_TYPE_CONDITION_MISMATCH"
  | "KNOWN_FLAWS_REQUIRED"
  | "PRICE_REQUIRED"
  | "STOCK_QUANTITY_INVALID"
  | "PROVINCE_REQUIRED"
  | "CITY_REQUIRED"
  | "FULFILLMENT_REQUIRED"
  | "IMAGE_REQUIRED"
  | "TOO_MANY_LISTING_IMAGES"
  | "REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED"
  | "BRAND_NEW_REQUIRES_ACTUAL_IMAGE";

const PUBLISH_LISTING_ERROR_CODES: ReadonlySet<string> = new Set<PublishListingErrorCode>([
  "NOT_AUTHENTICATED",
  "SHOP_NOT_FOUND",
  "INTERACTION_BLOCKED",
  "LISTING_NOT_FOUND",
  "NOT_LISTING_OWNER",
  "LISTING_NOT_DRAFT",
  "SELLER_POLICIES_NOT_ACCEPTED",
  "TITLE_REQUIRED",
  "DESCRIPTION_REQUIRED",
  "CATEGORY_REQUIRED",
  "LISTING_TYPE_REQUIRED",
  "CONDITION_REQUIRED",
  "LISTING_TYPE_CONDITION_MISMATCH",
  "KNOWN_FLAWS_REQUIRED",
  "PRICE_REQUIRED",
  "STOCK_QUANTITY_INVALID",
  "PROVINCE_REQUIRED",
  "CITY_REQUIRED",
  "FULFILLMENT_REQUIRED",
  "IMAGE_REQUIRED",
  "TOO_MANY_LISTING_IMAGES",
  "REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED",
  "BRAND_NEW_REQUIRES_ACTUAL_IMAGE",
]);

export const PUBLISH_LISTING_ERROR_MESSAGES: ErrorMap<PublishListingErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  SHOP_NOT_FOUND: "Please set up your shop first.",
  INTERACTION_BLOCKED: "You are not able to publish listings right now.",
  LISTING_NOT_FOUND: "We couldn't find this listing. Please refresh and try again.",
  NOT_LISTING_OWNER: "We couldn't find this listing. Please refresh and try again.",
  LISTING_NOT_DRAFT: "Only Draft listings can be published.",
  SELLER_POLICIES_NOT_ACCEPTED: "You must accept the Marketplace Rules and Prohibited Items Policy before publishing.",
  TITLE_REQUIRED: "Please enter a title for your listing.",
  DESCRIPTION_REQUIRED: "Please add a description before publishing.",
  CATEGORY_REQUIRED: "Please choose a category before publishing.",
  LISTING_TYPE_REQUIRED: "Please choose a listing type before publishing.",
  CONDITION_REQUIRED: "Please choose a condition before publishing.",
  LISTING_TYPE_CONDITION_MISMATCH: "That condition doesn't match the selected listing type.",
  KNOWN_FLAWS_REQUIRED: "Please describe the known flaws for Fair condition.",
  PRICE_REQUIRED: "Please enter a price before publishing.",
  STOCK_QUANTITY_INVALID: "Stock quantity must be at least 1.",
  PROVINCE_REQUIRED: "Please choose a province before publishing.",
  CITY_REQUIRED: "Please choose a city or municipality before publishing.",
  FULFILLMENT_REQUIRED: "Please select at least one fulfillment method before publishing.",
  IMAGE_REQUIRED: "Please add at least one photo before publishing.",
  TOO_MANY_LISTING_IMAGES: "A listing may have at most 8 photos.",
  REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED:
    "Pre-loved listings may only include actual-item photos. Remove or replace the reference/catalog photos in the Photos section, or switch to Brand New.",
  BRAND_NEW_REQUIRES_ACTUAL_IMAGE: "Brand New listings need at least one actual-item photo. Mark a photo as Actual in the Photos section.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type PublishListingResult =
  | { ok: true; listingId: string; publicCode: string; slug: string; status: string; publishedAt: string }
  | { ok: false; code: PublishListingErrorCode | "UNKNOWN" };

type PublishListingRpcRow = { listing_id: string; public_code: string; slug: string; status: string; published_at: string };

export async function publishListing(listingId: string): Promise<PublishListingResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("publish_listing", {
      p_listing_id: listingId,
    });

    if (error) {
      console.error("publish_listing RPC failed:", error.message);
      return { ok: false, code: toErrorCode<PublishListingErrorCode>((error as { details?: string }).details, PUBLISH_LISTING_ERROR_CODES) };
    }

    const row = ((data ?? []) as PublishListingRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, listingId: row.listing_id, publicCode: row.public_code, slug: row.slug, status: row.status, publishedAt: row.published_at };
  } catch (err) {
    console.error("publish_listing RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// acceptSellerPolicies (accept_seller_policies)
// ============================================================

/**
 * Thin wrapper around accept_seller_policies (0058). No parameters -- the
 * caller's identity comes exclusively from auth.uid() server-side, and the
 * RPC is idempotent (accepting twice is a safe no-op that returns the
 * original acceptance timestamp), so this wrapper never pre-reads or
 * caches acceptance state; it is only ever called reactively, in direct
 * response to publish_listing returning SELLER_POLICIES_NOT_ACCEPTED.
 */
export type AcceptSellerPoliciesErrorCode = "NOT_AUTHENTICATED" | "PROFILE_NOT_FOUND";

const ACCEPT_SELLER_POLICIES_ERROR_CODES: ReadonlySet<string> = new Set<AcceptSellerPoliciesErrorCode>([
  "NOT_AUTHENTICATED",
  "PROFILE_NOT_FOUND",
]);

export const ACCEPT_SELLER_POLICIES_ERROR_MESSAGES: ErrorMap<AcceptSellerPoliciesErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  PROFILE_NOT_FOUND: "We couldn't find your profile. Please refresh and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type AcceptSellerPoliciesResult =
  | { ok: true; acceptedAt: string }
  | { ok: false; code: AcceptSellerPoliciesErrorCode | "UNKNOWN" };

type AcceptSellerPoliciesRpcRow = { accepted_at: string };

export async function acceptSellerPolicies(): Promise<AcceptSellerPoliciesResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("accept_seller_policies");

    if (error) {
      console.error("accept_seller_policies RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<AcceptSellerPoliciesErrorCode>((error as { details?: string }).details, ACCEPT_SELLER_POLICIES_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as AcceptSellerPoliciesRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, acceptedAt: row.accepted_at };
  } catch (err) {
    console.error("accept_seller_policies RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
