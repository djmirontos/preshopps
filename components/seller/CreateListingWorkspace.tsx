"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ListingForm, CREATE_DEFAULTS, type ListingFormHandle } from "@/components/seller/ListingForm";
import { ListingImagesPicker } from "@/components/seller/ListingImagesPicker";
import { CreateListingPublishButton } from "@/components/seller/CreateListingPublishButton";
import { createListing, CREATE_LISTING_ERROR_MESSAGES, type CreateListingInput } from "@/lib/seller/listing-actions";
import type { InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";
import type { ShopLocationValue } from "@/components/seller/ShopLocationFields";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";
import type { ListingTypeFilter } from "@/lib/marketplace/search-params";

type Props = {
  ownerUserId: string;
  categories: CategoryRef[];
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
  initialLocation: ShopLocationValue;
};

type Draft = { listingId: string; publicCode: string; slug: string };
type DraftError = { message: string; restriction?: InteractionBlockedPresentation };

/** Used only when the seller adds a photo (or clicks Save Draft) before
 * ever typing a title -- overwritten the instant they type a real one and
 * save, exactly like any other Draft field. Never shown in the title input
 * itself; it exists purely to satisfy create_listing's one deliberate,
 * unchanged requirement (a non-blank title) invisibly. */
const UNTITLED_DRAFT_TITLE = "Untitled listing";

/**
 * Integrates photo upload directly into the initial Create Listing page
 * (P1 seller-flow improvement) by composing the exact same two components
 * the edit-listing page already uses -- ListingImagesPicker and
 * ListingForm -- rather than building a second, parallel upload/creation
 * path. The only new thing this component owns is `ensureDraft`: a single,
 * de-duplicated function shared by both children that silently creates a
 * minimal draft (title + the seller's prefilled shop location, nothing
 * else) the first time either of them needs a real listing id, via the
 * existing create_listing RPC -- unchanged, still requiring only a
 * non-blank title, per this task's own explicit instruction not to weaken
 * that validation. Whichever happens first -- adding a photo, or clicking
 * Save Draft with no photo yet -- is the only thing that ever calls
 * create_listing; the other reuses the same resulting id. A single
 * in-flight promise (inFlightRef) makes this safe even if both were
 * somehow triggered in the same tick.
 *
 * Once a draft exists, ListingForm's own Save Draft switches from
 * create_listing to update_listing against that same id (its own
 * `existingDraftId`/`ensureListingId` props), so a second, later Save
 * Draft (or the very next one) always updates rather than creating another
 * listing. Publish only ever appears once a draft exists, since nothing
 * can be published before it exists.
 *
 * Deliberately does NOT navigate anywhere when the draft is created in the
 * background (no router.push to /sell/{id}/edit) -- the seller stays on
 * this exact page/experience throughout, per this task's own "no
 * surprising page jumps" instruction. Reported trade-off: because the URL
 * never changes to include the new listing id, a hard browser refresh
 * before any explicit Save Draft does NOT restore the in-progress form
 * text the seller had typed (the same as today's create page before this
 * task, which also loses unsaved text on a refresh) -- but the draft
 * itself is never lost; it already exists server-side (with whatever
 * title/photos were saved so far) and is fully resumable from My Listings
 * via the existing edit page. This is the accepted consequence of
 * satisfying "never navigate to a separate edit page" over "survive a
 * hard refresh," not an oversight.
 */
export function CreateListingWorkspace({
  ownerUserId,
  categories,
  provinces,
  initialCities,
  initialBarangays,
  loadCities,
  loadBarangays,
  initialLocation,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<DraftError | null>(null);
  const [listingType, setListingType] = useState<ListingTypeFilter | null>(null);
  const [isFormPublishReady, setIsFormPublishReady] = useState(false);
  const [isPhotosReady, setIsPhotosReady] = useState(false);
  const titleRef = useRef("");
  const inFlightRef = useRef<Promise<string | null> | null>(null);
  const listingFormRef = useRef<ListingFormHandle>(null);

  async function ensureDraft(): Promise<string | null> {
    if (draft) return draft.listingId;
    if (inFlightRef.current) return inFlightRef.current;

    const attempt = (async () => {
      setDraftError(null);

      const titleHint = titleRef.current.trim();
      const input: CreateListingInput = {
        ...CREATE_DEFAULTS,
        title: titleHint.length > 0 ? titleHint : UNTITLED_DRAFT_TITLE,
        provinceId: initialLocation.provinceId,
        cityId: initialLocation.cityId,
        barangayId: initialLocation.barangayId,
        vehicleDetails: null,
        rentalDetails: null,
      };

      const result = await createListing(input);
      if (!result.ok) {
        setDraftError({ message: CREATE_LISTING_ERROR_MESSAGES[result.code], restriction: result.restriction });
        return null;
      }

      setDraft({ listingId: result.listingId, publicCode: result.publicCode, slug: result.slug });
      return result.listingId;
    })();

    inFlightRef.current = attempt;
    const resolved = await attempt;
    inFlightRef.current = null;
    return resolved;
  }

  /** Passed to CreateListingPublishButton as its own ensureAndPersist prop
   * -- does exactly what Save Draft does (ensure a draft id exists, then
   * persist every current unsaved field to it, including the seller's real
   * title in place of any "Untitled listing" placeholder) without
   * requiring the seller to click Save Draft first. Reuses ListingForm's
   * own persistCurrentState via the imperative ref handle, so this never
   * duplicates or diverges from Save Draft's own validation/patch logic;
   * `ensureDraft` itself is not called directly here because
   * persistCurrentState already calls it (via the same `ensureListingId`
   * prop passed to ListingForm below) whenever no draft id is known yet. */
  async function ensureAndPersist(): Promise<string | null> {
    const result = await listingFormRef.current?.persistCurrentState();
    if (!result || !result.ok) return null;
    return result.listingId;
  }

  const canPublish = isFormPublishReady && isPhotosReady;

  return (
    <div className="space-y-8">
      <div>
        {draftError && (
          <div role="alert" className="mt-2">
            <p className="text-xs text-danger">{draftError.message}</p>
            {draftError.restriction && (
              <p className="mt-1 text-xs text-danger">
                {draftError.restriction.message}{" "}
                <Link href={draftError.restriction.href} className="font-semibold underline underline-offset-2 hover:no-underline">
                  {draftError.restriction.ctaLabel}
                </Link>
              </p>
            )}
          </div>
        )}
        <ListingImagesPicker
          listingId={draft?.listingId ?? null}
          ensureListingId={ensureDraft}
          ownerUserId={ownerUserId}
          listingType={listingType}
          initialImages={[]}
          onPhotosReadyChange={setIsPhotosReady}
        />
      </div>

      <ListingForm
        ref={listingFormRef}
        mode="create"
        categories={categories}
        provinces={provinces}
        initialCities={initialCities}
        initialBarangays={initialBarangays}
        loadCities={loadCities}
        loadBarangays={loadBarangays}
        initialLocation={initialLocation}
        existingDraftId={draft?.listingId ?? null}
        ensureListingId={ensureDraft}
        onTitleChange={(title) => {
          titleRef.current = title;
        }}
        onListingTypeChange={setListingType}
        onPublishReadyChange={setIsFormPublishReady}
      />

      <CreateListingPublishButton canPublish={canPublish} ensureAndPersist={ensureAndPersist} />
    </div>
  );
}
