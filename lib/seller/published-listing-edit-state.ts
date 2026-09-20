import type { ListingTypeFilter, FulfillmentMethod } from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";
import type { MyListingStatus, MyListingImage, MyListingVehicleDetails, MyListingRentalDetails } from "@/lib/seller/get-my-listing";
import type { InteractionBlockedPresentation } from "@/lib/moderation/select-interaction-blocked-presentation";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

/** Shared by both getPublishedListingEditState wrappers (server and
 * browser) and by updatePublishedListing's own INTERACTION_BLOCKED
 * interpretation -- account_suspended first, seller_suspended second.
 * Both get_published_listing_edit_state and update_published_listing
 * (0094_published_listing_editing.sql) check exactly these two
 * restriction types (`restriction_type in ('seller_suspended',
 * 'account_suspended')`) -- buyer_restricted is never checked by either,
 * so it is deliberately excluded here.
 *
 * Deliberately its own constant, not imported from lib/seller/listing-
 * actions.ts's own identically-valued LISTING_RELEVANT_RESTRICTIONS: that
 * module imports the browser Supabase client, and this module must stay
 * import-free of either Supabase client (see this file's own header and
 * published-listing-edit-state-boundary-architecture.test.ts) so the
 * server-safe loader can keep depending on it without ever pulling in
 * browser-client code. The two values must be kept in sync by hand if
 * either ever changes -- both are extremely unlikely to change (they
 * mirror what four other listing RPCs already check identically). */
export const PUBLISHED_LISTING_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "seller_suspended"];

/**
 * The get_published_listing_edit_state / update_published_listing response
 * shape, plus the pure (no Supabase client, no "use client"/"server-only"
 * boundary) mapping from a raw `{ data, error }` RPC outcome to this
 * module's typed result -- shared by BOTH the server-safe loader
 * (lib/seller/get-published-listing-edit-state.ts, used from Server
 * Components) and the browser wrapper
 * (lib/seller/published-listing-actions.ts, used from client components).
 *
 * Deliberately extracted here rather than left in either wrapper: the two
 * loaders must obtain their Supabase client differently (cookie-aware
 * server client vs browser client -- see this task's own "use an explicit
 * boundary" instruction), but must interpret get_published_listing_edit_state's
 * response identically. Duplicating that interpretation in two files would
 * risk them silently drifting apart; a shared pure function makes that
 * impossible. update_published_listing has no server-side caller today (see
 * published-listing-actions.ts's own header), so its result/error mapping
 * stays there rather than moving here -- only what both loaders actually
 * need is shared.
 */
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

export type PublishedListingEditStateRow = {
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

export function mapPublishedListingEditStateRow(row: PublishedListingEditStateRow): PublishedListingEditState {
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

/**
 * Read wrapper result, mirroring getMyListing's own established privacy
 * pattern exactly: LISTING_NOT_FOUND and NOT_LISTING_OWNER collapse to the
 * same "not_found" result -- a listing id belonging to another seller, or
 * one that doesn't exist, must never be distinguishable from the outside.
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
  | {
      status: "interaction_blocked";
      /** Populated only by each context-appropriate wrapper (server or
       * browser), after this pure mapper has already returned -- never
       * set here, since attaching it would require a restriction-lookup
       * RPC call this module must never make (see this file's own header:
       * no Supabase client, no side effects). Absent for an unrelated
       * deleted-account collision or a failed lookup; the generic
       * "Unable to load this listing right now." copy is the fallback in
       * both of those cases, same as every other INTERACTION_BLOCKED
       * surface in this codebase. */
      restriction?: InteractionBlockedPresentation;
    }
  | { status: "error" };

/**
 * Pure interpretation of get_published_listing_edit_state's `{ data, error }`
 * outcome -- everything both loaders need after they've each made their own
 * `supabase.rpc(...)` call. Never touches a Supabase client, never throws
 * (a thrown RPC call is each caller's own try/catch responsibility, exactly
 * like before this was extracted).
 */
export function mapGetPublishedListingEditStateResponse(
  data: unknown,
  error: { message: string; details?: string } | null,
): GetPublishedListingEditStateResult {
  if (error) {
    const detail = error.details;
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

  return { status: "found", listing: mapPublishedListingEditStateRow(data as PublishedListingEditStateRow) };
}
