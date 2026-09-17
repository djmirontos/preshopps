import { createClient } from "@/lib/supabase/client";
import type { ListingTypeFilter, FulfillmentMethod } from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";
import type { MyListingStatus, MyListingImage, MyListingVehicleDetails, MyListingRentalDetails } from "@/lib/seller/get-my-listing";

/**
 * Thin client wrappers around the two 0094 published-listing-edit RPCs --
 * get_published_listing_edit_state and update_published_listing -- following
 * the exact conventions already established by lib/seller/get-my-listing.ts
 * (read side: a `status`-discriminated result, collapsing
 * LISTING_NOT_FOUND/NOT_LISTING_OWNER into one privacy-preserving "not_found"
 * outcome) and lib/seller/listing-actions.ts (write side: identity is always
 * derived server-side from auth.uid(), never sent from the client; every
 * failure mode maps to a typed code + safe copy, never a raw Postgres error).
 *
 * Both RPCs `returns jsonb` (a single scalar object), unlike every other RPC
 * wrapped in listing-actions.ts (which `returns table(...)` and therefore
 * comes back as a one-row array in `data`). `data` here is the JSON object
 * itself -- never `((data ?? [])[0])`.
 *
 * Revision precision: listings.revision is bigint. This module never parses
 * it into a JS number anywhere -- get_published_listing_edit_state casts it
 * to text server-side (`v_listing.revision::text`) specifically so the wire
 * value is a decimal string, and update_published_listing's own
 * p_expected_revision parameter accepts that same string back (Postgres
 * parses the bigint from its text representation over the wire regardless of
 * whether the JS value started as a string or number -- the only actual risk
 * is this module coercing it through `Number()`/arithmetic first, which it
 * never does). `revision` is typed `string` throughout: RPC response ->
 * wrapper result -> later RPC input, unchanged.
 *
 * No side effects: these wrappers only ever call supabase.rpc(...) for
 * exactly these two functions. They never upload/delete Storage objects,
 * never call update_listing/replace_listing_images/publish_listing/
 * update_listing_status, never retry a stale save, and never navigate or
 * refresh -- all of that is UI-layer responsibility, deliberately out of
 * scope here (see this task's own "no side effects" instruction).
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// Shared listing shape (the get_my_listing projection embedded in both
// RPCs' jsonb response) plus the published-edit-only fields each adds.
// ============================================================

export type PublishedListingEditState = {
  listingId: string;
  publicCode: string;
  slug: string;
  status: MyListingStatus;
  title: string;
  description: string | null;
  categoryId: number | null;
  listingType: ListingTypeFilter | null;
  condition: (ListingCondition | "brand_new") | null;
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
  /** Decimal string, e.g. "42". Never parse this as a JS number -- pass it
   * straight back into updatePublishedListing's expectedRevision unchanged. */
  revision: string;
  availableQuantity: number;
  reservedQuantity: number;
  coverImageId: string | null;
  /** True only when reserved_quantity is 0 and no active reservation exists
   * for this listing -- the same condition update_published_listing itself
   * enforces before allowing available_quantity to change. Use this instead
   * of re-deriving the same rule client-side. */
  quantityEditable: boolean;
};

type PublishedListingEditStateRow = {
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
  images: { id: string; storage_path: string; position: number; is_reference_image: boolean }[] | null;
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
  revision: string;
  available_quantity: number;
  reserved_quantity: number;
  cover_image_id: string | null;
  quantity_editable: boolean;
};

function mapRow(row: PublishedListingEditStateRow): PublishedListingEditState {
  return {
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
    revision: row.revision,
    availableQuantity: row.available_quantity,
    reservedQuantity: row.reserved_quantity,
    coverImageId: row.cover_image_id,
    quantityEditable: row.quantity_editable,
  };
}

// ============================================================
// getPublishedListingEditState (get_published_listing_edit_state)
// ============================================================

/**
 * Read wrapper, mirroring getMyListing's own established privacy pattern
 * exactly: LISTING_NOT_FOUND and NOT_LISTING_OWNER collapse to the same
 * "not_found" result -- a listing id belonging to another seller, or one
 * that doesn't exist, must never be distinguishable from the outside.
 * LISTING_NOT_EDITABLE is kept as its own distinct result (not collapsed):
 * it is a real, expected, actionable state -- the listing exists and is the
 * caller's own, it is simply Reserved/Sold/Archived right now -- and a
 * caller needs to tell that apart from "this isn't your listing" to render
 * a read-only view instead of a 404-shaped state.
 */
export type GetPublishedListingEditStateResult =
  | { status: "found"; listing: PublishedListingEditState }
  | { status: "not_found" }
  | { status: "not_editable" }
  | { status: "not_authenticated" }
  | { status: "interaction_blocked" }
  | { status: "error" };

export async function getPublishedListingEditState(listingId: string): Promise<GetPublishedListingEditStateResult> {
  const supabase = createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_published_listing_edit_state", { p_listing_id: listingId }));
  } catch (err) {
    console.error("get_published_listing_edit_state RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    const detail = (error as { details?: string }).details;
    if (detail === "LISTING_NOT_FOUND" || detail === "NOT_LISTING_OWNER") {
      return { status: "not_found" };
    }
    if (detail === "LISTING_NOT_EDITABLE") {
      return { status: "not_editable" };
    }
    if (detail === "NOT_AUTHENTICATED") {
      return { status: "not_authenticated" };
    }
    if (detail === "INTERACTION_BLOCKED") {
      return { status: "interaction_blocked" };
    }
    console.error("get_published_listing_edit_state RPC failed:", error.message);
    return { status: "error" };
  }

  // Scalar jsonb return -- `data` is the object itself, never a row array.
  if (!data) {
    return { status: "error" };
  }

  return { status: "found", listing: mapRow(data as PublishedListingEditStateRow) };
}

// ============================================================
// updatePublishedListing (update_published_listing)
// ============================================================

/**
 * Editable patch keys, matching update_published_listing's own v_allowed
 * list exactly (0094). category_id/listing_type/condition/status/
 * stock_quantity/reserved_quantity/revision/shop_id/public_code/slug/
 * cover_image_id/created_at/updated_at/published_at/id are all in the RPC's
 * own v_protected list and are deliberately absent from this type -- there
 * is no key here a caller could accidentally set that the backend would
 * reject as PROTECTED_FIELD, because the type itself does not offer it.
 * `available_quantity` (not `stock_quantity`) is the one quantity key --
 * the RPC derives stock_quantity server-side from available + reserved.
 */
export type PublishedListingPatch = {
  title?: string;
  description?: string | null;
  price_cents?: number | null;
  original_price_cents?: number | null;
  is_negotiable?: boolean;
  brand?: string | null;
  known_flaws?: string | null;
  province_id?: number | null;
  city_id?: number | null;
  barangay_id?: number | null;
  fulfillment_methods?: FulfillmentMethod[];
  meetup_note?: string | null;
  /** Tri-state: omit to leave unchanged, `null` to clear the extension,
   * an object to set/replace it -- same contract as UpdateListingPatch's
   * identically-shaped field. */
  vehicle_details?: Record<string, unknown> | null;
  rental_details?: Record<string, unknown> | null;
  available_quantity?: number;
};

/**
 * Complete published gallery state -- exactly one of image_id (an existing
 * photo, identified by id) or storage_path (a newly uploaded, not-yet-saved
 * photo) per entry, per update_published_listing's own p_images contract.
 * Array order is the intended display order; exactly one entry must have
 * is_cover: true. Passing `null` (the default) to updatePublishedListing
 * means "gallery unchanged" -- never an empty array to mean the same thing.
 */
export type PublishedListingImageEntry =
  | { image_id: string; is_reference_image: boolean; is_cover: boolean }
  | { storage_path: string; is_reference_image: boolean; is_cover: boolean };

export type PublishedListingImages = PublishedListingImageEntry[];

export type UpdatePublishedListingErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_LISTING_OWNER"
  | "LISTING_NOT_FOUND"
  | "LISTING_NOT_EDITABLE"
  | "INTERACTION_BLOCKED"
  | "PROTECTED_FIELD"
  | "UNKNOWN_FIELD"
  | "LISTING_HAS_ACTIVE_RESERVATION"
  | "INVALID_PUBLISHED_LISTING"
  | "INVALID_IMAGE_STATE";

const UPDATE_PUBLISHED_LISTING_ERROR_CODES: ReadonlySet<string> = new Set<UpdatePublishedListingErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_LISTING_OWNER",
  "LISTING_NOT_FOUND",
  "LISTING_NOT_EDITABLE",
  "INTERACTION_BLOCKED",
  "PROTECTED_FIELD",
  "UNKNOWN_FIELD",
  "LISTING_HAS_ACTIVE_RESERVATION",
  "INVALID_PUBLISHED_LISTING",
  "INVALID_IMAGE_STATE",
]);

export const UPDATE_PUBLISHED_LISTING_ERROR_MESSAGES: ErrorMap<UpdatePublishedListingErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_LISTING_OWNER: "We couldn't find this listing. Please refresh and try again.",
  LISTING_NOT_FOUND: "We couldn't find this listing. Please refresh and try again.",
  LISTING_NOT_EDITABLE: "This listing can't be edited right now.",
  INTERACTION_BLOCKED: "You are not able to edit listings right now.",
  PROTECTED_FIELD: "That field can't be changed here.",
  UNKNOWN_FIELD: "Something went wrong. Please try again.",
  LISTING_HAS_ACTIVE_RESERVATION: "Quantity can't change while stock is reserved.",
  INVALID_PUBLISHED_LISTING: "Please check the listing information.",
  INVALID_IMAGE_STATE: "Please check your listing photos.",
  UNKNOWN: "Something went wrong. Please try again.",
};

/**
 * `outcome` (not `ok`) is the discriminant here, deliberately three-way
 * rather than the usual two-way ok/code shape every other wrapper in this
 * file and in listing-actions.ts uses. This is intentional: a stale-revision
 * conflict is not a generic save failure -- it means the save never ran at
 * all because the seller's local copy is out of date, and callers must
 * react to it differently (offer a reload, never a retry with the same
 * revision). Folding it into `{ ok: false; code: "STALE_LISTING_REVISION" }`
 * would make it just another string to compare inside the generic failure
 * branch; a distinct `outcome` value makes that impossible to overlook.
 */
export type UpdatePublishedListingResult =
  | { outcome: "saved"; listing: PublishedListingEditState; changed: boolean }
  | { outcome: "stale_revision" }
  | { outcome: "failed"; code: UpdatePublishedListingErrorCode | "UNKNOWN" };

type UpdatePublishedListingRpcRow = PublishedListingEditStateRow & { changed: boolean };

export async function updatePublishedListing(
  listingId: string,
  expectedRevision: string,
  patch: PublishedListingPatch,
  images: PublishedListingImages | null = null,
): Promise<UpdatePublishedListingResult> {
  const supabase = createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("update_published_listing", {
      p_listing_id: listingId,
      p_expected_revision: expectedRevision,
      p_patch: patch,
      p_images: images,
    }));
  } catch (err) {
    console.error("update_published_listing RPC threw:", err instanceof Error ? err.message : err);
    return { outcome: "failed", code: "UNKNOWN" };
  }

  if (error) {
    const detail = (error as { details?: string }).details;

    if (detail === "STALE_LISTING_REVISION") {
      return { outcome: "stale_revision" };
    }

    console.error("update_published_listing RPC failed:", error.message);
    return {
      outcome: "failed",
      code: toErrorCode<UpdatePublishedListingErrorCode>(detail, UPDATE_PUBLISHED_LISTING_ERROR_CODES),
    };
  }

  // Scalar jsonb return -- `data` is the object itself, never a row array.
  if (!data) {
    return { outcome: "failed", code: "UNKNOWN" };
  }

  const row = data as UpdatePublishedListingRpcRow;
  return { outcome: "saved", listing: mapRow(row), changed: row.changed };
}
