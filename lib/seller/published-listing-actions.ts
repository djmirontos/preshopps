import { createClient } from "@/lib/supabase/client";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";
import { interpretInteractionBlocked, type InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";
import {
  mapPublishedListingEditStateRow,
  mapGetPublishedListingEditStateResponse,
  PUBLISHED_LISTING_RELEVANT_RESTRICTIONS,
  type PublishedListingEditState,
  type PublishedListingEditStateRow,
  type GetPublishedListingEditStateResult,
} from "@/lib/seller/published-listing-edit-state";

/**
 * Browser-side wrappers around the two 0094 published-listing-edit RPCs --
 * get_published_listing_edit_state and update_published_listing.
 *
 * BOUNDARY: this module always uses the browser Supabase client
 * (@/lib/supabase/client), so every export here is for client-component
 * callers only -- PublishedListingEditor's own "Reload latest" action
 * (getPublishedListingEditState) and its Save action (updatePublishedListing).
 * The Server Component route (app/sell/[listingId]/edit/page.tsx) does NOT
 * import getPublishedListingEditState from here -- a browser client
 * constructed during SSR has no cookies to read, silently carries no
 * session, and every RPC call it makes executes as `anon` (which correctly
 * gets rejected: anon has no EXECUTE grant on either function). That
 * Server Component instead uses the cookie-aware server-safe loader at
 * lib/seller/get-published-listing-edit-state.ts, which shares this
 * module's exact result/error mapping (see published-listing-edit-state.ts)
 * without sharing this module's client. There is deliberately no server
 * equivalent of updatePublishedListing -- every save happens from
 * PublishedListingEditor in the browser, where a real session exists.
 *
 * get_published_listing_edit_state and update_published_listing both
 * `returns jsonb` (a single scalar object), unlike every other RPC wrapped
 * in listing-actions.ts (which `returns table(...)` and therefore comes back
 * as a one-row array in `data`). `data` here is the JSON object itself --
 * never `((data ?? [])[0])`.
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

// Re-exported so every existing importer of this module (PublishedListingEditor,
// tests) keeps working unchanged -- the canonical definitions now live in
// published-listing-edit-state.ts so the server-safe loader can share them
// without importing this (browser-client) module at all.
export type { PublishedListingEditState, GetPublishedListingEditStateResult };

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// getPublishedListingEditState (get_published_listing_edit_state)
// ============================================================

/**
 * Browser-side read wrapper -- for PublishedListingEditor's own "Reload
 * latest" action only. The Server Component route uses the separate
 * server-safe loader at lib/seller/get-published-listing-edit-state.ts
 * instead (see this module's own header). Both share the exact same
 * result/error mapping via mapGetPublishedListingEditStateResponse
 * (published-listing-edit-state.ts) -- only the Supabase client differs.
 */
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

  const result = mapGetPublishedListingEditStateResponse(data, error);
  if (result.status !== "interaction_blocked") return result;

  const restriction = await interpretInteractionBlocked("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT_RESTRICTIONS);
  return restriction ? { status: "interaction_blocked", restriction } : result;
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
  | {
      outcome: "failed";
      code: UpdatePublishedListingErrorCode | "UNKNOWN";
      /** Same contract as every other listing action's own `restriction`
       * field -- populated only when code is INTERACTION_BLOCKED and an
       * edit-relevant restriction (account_suspended/seller_suspended) is
       * confirmed. */
      restriction?: InteractionBlockedPresentation;
    };

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
    const code = toErrorCode<UpdatePublishedListingErrorCode>(detail, UPDATE_PUBLISHED_LISTING_ERROR_CODES);
    const restriction = await interpretInteractionBlocked(code, PUBLISHED_LISTING_RELEVANT_RESTRICTIONS);
    return restriction ? { outcome: "failed", code, restriction } : { outcome: "failed", code };
  }

  // Scalar jsonb return -- `data` is the object itself, never a row array.
  if (!data) {
    return { outcome: "failed", code: "UNKNOWN" };
  }

  const row = data as UpdatePublishedListingRpcRow;
  return { outcome: "saved", listing: mapPublishedListingEditStateRow(row), changed: row.changed };
}
