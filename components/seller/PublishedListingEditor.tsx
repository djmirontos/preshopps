"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ShopLocationFields, type ShopLocationValue } from "@/components/seller/ShopLocationFields";
import {
  getPublishedListingEditState,
  updatePublishedListing,
  UPDATE_PUBLISHED_LISTING_ERROR_MESSAGES,
  type PublishedListingEditState,
  type PublishedListingPatch,
} from "@/lib/seller/published-listing-actions";
import { parsePesosToCents, centsToPesosInput } from "@/lib/seller/price-cents";
import { LISTING_TYPE_LABELS, CONDITION_LABELS, FULFILLMENT_LABELS, type FulfillmentMethod } from "@/lib/marketplace/search-params";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import {
  ListingVehicleFields,
  isVehicleValuesEmpty,
  vehicleValuesEqual,
  validateVehicleValues,
  buildVehicleDetailsJson,
  vehicleFieldValuesFromServer,
  type VehicleFieldValues,
} from "@/components/seller/ListingVehicleFields";
import {
  ListingRentalFields,
  isRentalValuesEmpty,
  rentalValuesEqual,
  validateRentalValues,
  buildRentalDetailsJson,
  rentalFieldValuesFromServer,
  type RentalFieldValues,
} from "@/components/seller/ListingRentalFields";

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60";
const TEXTAREA_CLASS =
  "mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const FULFILLMENT_METHODS = Object.keys(FULFILLMENT_LABELS) as FulfillmentMethod[];

type FieldErrors = {
  title?: string;
  price?: string;
  originalPrice?: string;
  quantity?: string;
};

function fulfillmentSetsEqual(a: FulfillmentMethod[], b: FulfillmentMethod[]): boolean {
  return a.length === b.length && a.every((method) => b.includes(method));
}

/** Raw, form-shaped values derived from a fresh server state -- the single
 * place both this component's initial mount and every later
 * "replace the form with the server's truth" moment (a successful save,
 * or an explicit Reload latest) go through, so those two moments can never
 * drift into different prefill logic. */
function fieldValuesFromServerState(state: PublishedListingEditState) {
  return {
    title: state.title,
    description: state.description ?? "",
    brand: state.brand ?? "",
    knownFlaws: state.knownFlaws ?? "",
    priceInput: centsToPesosInput(state.priceCents),
    originalPriceInput: centsToPesosInput(state.originalPriceCents),
    isNegotiable: state.isNegotiable,
    quantityInput: String(state.availableQuantity),
    location: { provinceId: state.provinceId, cityId: state.cityId, barangayId: state.barangayId } as ShopLocationValue,
    fulfillmentMethods: state.fulfillmentMethods,
    meetupNote: state.meetupNote ?? "",
    vehicleValues: vehicleFieldValuesFromServer(state.vehicleDetails),
    rentalValues: rentalFieldValuesFromServer(state.rentalDetails),
  };
}

type Props = {
  listingId: string;
  initialState: PublishedListingEditState;
  categories: CategoryRef[];
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
};

/**
 * Real editor for a published (Available/Paused) listing's non-image
 * fields, seeded from getPublishedListingEditState (0094) and saved through
 * updatePublishedListing -- the temporary PublishedListingEditPlaceholder
 * this replaces on app/sell/[listingId]/edit/page.tsx. Deliberately a
 * separate component from ListingForm rather than a published-mode branch
 * inside it: the two forms diff against a different baseline shape
 * (PublishedListingEditState vs get_my_listing's MyListing/ListingFieldValues),
 * save through different RPCs with different patch contracts and a
 * revision precondition, and share no save/Publish button at all -- forcing
 * them into one component would mean threading that divergence through
 * every field instead of keeping it contained here.
 *
 * category_id/listing_type/condition are immutable once published (0094's
 * own v_protected list) and are rendered as a plain read-only summary, never
 * a disabled control. images is always sent as `null` to
 * updatePublishedListing -- this slice proves text/details/quantity saving
 * independently of gallery editing, which is a later, separate step.
 *
 * `serverState` is this component's only source of truth for "what the
 * server currently has" (including `revision`, never parsed as a number --
 * see published-listing-actions.ts's own header comment). Every editable
 * field also has a live, controlled value; a Save diffs live values against
 * serverState to build the smallest patch, exactly like ListingForm's own
 * baseline-diff convention. A successful save and an explicit Reload latest
 * both funnel through applyServerState, which replaces serverState AND every
 * live field from the fresh response/read in one step -- there is no path
 * that updates one without the other, which is what keeps a resolved stale
 * conflict from ever silently rebasing old local edits onto a new revision.
 */
export function PublishedListingEditor({
  listingId,
  initialState,
  categories,
  provinces,
  initialCities,
  initialBarangays,
  loadCities,
  loadBarangays,
}: Props) {
  const router = useRouter();
  const titleErrorId = useId();
  const priceErrorId = useId();
  const originalPriceErrorId = useId();
  const quantityHintId = useId();

  const [serverState, setServerState] = useState<PublishedListingEditState>(initialState);

  const initialValues = fieldValuesFromServerState(initialState);
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const [brand, setBrand] = useState(initialValues.brand);
  const [knownFlaws, setKnownFlaws] = useState(initialValues.knownFlaws);
  const [priceInput, setPriceInput] = useState(initialValues.priceInput);
  const [originalPriceInput, setOriginalPriceInput] = useState(initialValues.originalPriceInput);
  const [isNegotiable, setIsNegotiable] = useState(initialValues.isNegotiable);
  const [quantityInput, setQuantityInput] = useState(initialValues.quantityInput);
  const [location, setLocation] = useState<ShopLocationValue>(initialValues.location);
  const [fulfillmentMethods, setFulfillmentMethods] = useState<FulfillmentMethod[]>(initialValues.fulfillmentMethods);
  const [meetupNote, setMeetupNote] = useState(initialValues.meetupNote);
  const [vehicleValues, setVehicleValues] = useState<VehicleFieldValues>(initialValues.vehicleValues);
  const [rentalValues, setRentalValues] = useState<RentalFieldValues>(initialValues.rentalValues);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [vehicleErrors, setVehicleErrors] = useState<ReturnType<typeof validateVehicleValues>>({});
  const [rentalErrors, setRentalErrors] = useState<ReturnType<typeof validateRentalValues>>({});

  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "no_changes">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorCode, setSaveErrorCode] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const selectedCategory = categories.find((category) => category.id === serverState.categoryId);
  const categorySlug = selectedCategory?.slug ?? null;
  const isVehicleCategory = categorySlug === "cars" || categorySlug === "motorcycles";
  const isRentalCategory = categorySlug === "for-rent";

  const minQuantity = serverState.status === "available" ? 1 : 0;

  const listingTypeLabel = serverState.listingType ? LISTING_TYPE_LABELS[serverState.listingType] : "Not set";
  const conditionLabel =
    serverState.listingType === "brand_new"
      ? "Brand New"
      : serverState.condition && serverState.condition !== "brand_new"
        ? CONDITION_LABELS[serverState.condition]
        : "Not set";

  /** Single funnel for "replace everything with the server's current truth"
   * -- used after a successful save and after an explicit Reload latest.
   * See this component's own header comment for why both must go through
   * exactly this function. */
  function applyServerState(next: PublishedListingEditState) {
    setServerState(next);
    const values = fieldValuesFromServerState(next);
    setTitle(values.title);
    setDescription(values.description);
    setBrand(values.brand);
    setKnownFlaws(values.knownFlaws);
    setPriceInput(values.priceInput);
    setOriginalPriceInput(values.originalPriceInput);
    setIsNegotiable(values.isNegotiable);
    setQuantityInput(values.quantityInput);
    setLocation(values.location);
    setFulfillmentMethods(values.fulfillmentMethods);
    setMeetupNote(values.meetupNote);
    setVehicleValues(values.vehicleValues);
    setRentalValues(values.rentalValues);
    setFieldErrors({});
    setVehicleErrors({});
    setRentalErrors({});
  }

  function toggleFulfillmentMethod(method: FulfillmentMethod) {
    setFulfillmentMethods((prev) => (prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]));
  }

  function buildPatch(): PublishedListingPatch {
    const patch: PublishedListingPatch = {};

    const trimmedTitle = title.trim();
    if (trimmedTitle !== serverState.title) patch.title = trimmedTitle;

    const trimmedDescription = description.trim().length > 0 ? description.trim() : null;
    if (trimmedDescription !== serverState.description) patch.description = trimmedDescription;

    const trimmedBrand = brand.trim().length > 0 ? brand.trim() : null;
    if (trimmedBrand !== serverState.brand) patch.brand = trimmedBrand;

    const trimmedKnownFlaws = knownFlaws.trim().length > 0 ? knownFlaws.trim() : null;
    if (trimmedKnownFlaws !== serverState.knownFlaws) patch.known_flaws = trimmedKnownFlaws;

    const priceResult = parsePesosToCents(priceInput);
    if (priceResult.ok && priceResult.cents !== serverState.priceCents) patch.price_cents = priceResult.cents;

    const originalPriceResult = parsePesosToCents(originalPriceInput);
    if (originalPriceResult.ok && originalPriceResult.cents !== serverState.originalPriceCents) {
      patch.original_price_cents = originalPriceResult.cents;
    }

    if (isNegotiable !== serverState.isNegotiable) patch.is_negotiable = isNegotiable;

    if (location.provinceId !== serverState.provinceId) patch.province_id = location.provinceId;
    if (location.cityId !== serverState.cityId) patch.city_id = location.cityId;
    if (location.barangayId !== serverState.barangayId) patch.barangay_id = location.barangayId;

    if (!fulfillmentSetsEqual(fulfillmentMethods, serverState.fulfillmentMethods)) {
      patch.fulfillment_methods = fulfillmentMethods;
    }

    const trimmedMeetupNote = fulfillmentMethods.includes("meetup") && meetupNote.trim().length > 0 ? meetupNote.trim() : null;
    if (trimmedMeetupNote !== serverState.meetupNote) patch.meetup_note = trimmedMeetupNote;

    if (isVehicleCategory) {
      const vehicleEmpty = isVehicleValuesEmpty(vehicleValues);
      const serverVehicleBaseline = vehicleFieldValuesFromServer(serverState.vehicleDetails);
      const serverVehicleEmpty = serverState.vehicleDetails === null;
      if (vehicleEmpty && !serverVehicleEmpty) {
        patch.vehicle_details = null;
      } else if (!vehicleEmpty && (serverVehicleEmpty || !vehicleValuesEqual(vehicleValues, serverVehicleBaseline))) {
        patch.vehicle_details = buildVehicleDetailsJson(vehicleValues);
      }
    }

    if (isRentalCategory) {
      const rentalEmpty = isRentalValuesEmpty(rentalValues);
      const serverRentalBaseline = rentalFieldValuesFromServer(serverState.rentalDetails);
      const serverRentalEmpty = serverState.rentalDetails === null;
      if (rentalEmpty && !serverRentalEmpty) {
        patch.rental_details = null;
      } else if (!rentalEmpty && (serverRentalEmpty || !rentalValuesEqual(rentalValues, serverRentalBaseline))) {
        patch.rental_details = buildRentalDetailsJson(rentalValues);
      }
    }

    if (serverState.quantityEditable) {
      const trimmedQuantity = quantityInput.trim();
      const quantityValue = trimmedQuantity === "" ? null : Number(trimmedQuantity);
      if (quantityValue !== null && Number.isInteger(quantityValue) && quantityValue !== serverState.availableQuantity) {
        patch.available_quantity = quantityValue;
      }
    }

    return patch;
  }

  async function handleSave() {
    setSaveError(null);
    setSaveErrorCode(null);
    setSaveStatus("idle");

    const errors: FieldErrors = {};
    if (title.trim().length === 0) {
      errors.title = "Please enter a title for your listing.";
    }

    const priceResult = parsePesosToCents(priceInput);
    if (!priceResult.ok) {
      errors.price = "Please enter a valid price.";
    }

    const originalPriceResult = parsePesosToCents(originalPriceInput);
    if (!originalPriceResult.ok) {
      errors.originalPrice = "Please enter a valid original price.";
    }

    if (
      priceResult.ok &&
      originalPriceResult.ok &&
      priceResult.cents !== null &&
      originalPriceResult.cents !== null &&
      originalPriceResult.cents < priceResult.cents
    ) {
      errors.originalPrice = "Original price must not be lower than the current price.";
    }

    if (serverState.quantityEditable) {
      const trimmedQuantity = quantityInput.trim();
      const quantityValue = trimmedQuantity === "" ? null : Number(trimmedQuantity);
      if (quantityValue === null || !Number.isInteger(quantityValue) || quantityValue < minQuantity) {
        errors.quantity = `Available quantity must be at least ${minQuantity}.`;
      }
    }

    const nextVehicleErrors = isVehicleCategory ? validateVehicleValues(vehicleValues) : {};
    const nextRentalErrors = isRentalCategory ? validateRentalValues(rentalValues) : {};
    setVehicleErrors(nextVehicleErrors);
    setRentalErrors(nextRentalErrors);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0 || Object.keys(nextVehicleErrors).length > 0 || Object.keys(nextRentalErrors).length > 0) {
      return;
    }

    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setSaveStatus("no_changes");
      return;
    }

    setIsSaving(true);
    const result = await updatePublishedListing(listingId, serverState.revision, patch, null);
    setIsSaving(false);

    if (result.outcome === "stale_revision") {
      setStaleConflict(true);
      return;
    }

    if (result.outcome === "failed") {
      setSaveErrorCode(result.code);
      setSaveError(UPDATE_PUBLISHED_LISTING_ERROR_MESSAGES[result.code]);
      return;
    }

    applyServerState(result.listing);
    setSaveStatus(result.changed ? "saved" : "no_changes");
  }

  async function handleReloadLatest() {
    setIsReloading(true);
    const result = await getPublishedListingEditState(listingId);
    setIsReloading(false);

    if (result.status === "found") {
      applyServerState(result.listing);
      setStaleConflict(false);
      setSaveError(null);
      setSaveErrorCode(null);
      setSaveStatus("idle");
      return;
    }

    // The listing moved to a state this editor no longer covers (e.g. it
    // became Reserved/Sold/Archived, or is no longer the caller's own) --
    // never guessed at here; a full route refresh lets the Server Component
    // route re-derive and render whichever state is now actually correct.
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Edit Listing</h1>
      <p className="mt-1 text-sm text-ink-secondary">Status: {serverState.status === "available" ? "Available" : "Paused"}</p>

      {staleConflict && (
        <div role="alert" className="mt-6 rounded-[14px] border border-danger/40 bg-danger/5 p-4">
          <p className="text-sm font-medium text-ink">This listing changed elsewhere. Reload the latest version before saving.</p>
          <p className="mt-1 text-xs text-ink-secondary">Reloading will discard your unsaved changes here.</p>
          <button
            type="button"
            onClick={() => void handleReloadLatest()}
            disabled={isReloading}
            className="mt-3 h-9 rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-60"
          >
            {isReloading ? "Reloading…" : "Reload latest"}
          </button>
        </div>
      )}

      <div className="mt-6 space-y-8">
        <section>
          <div className="space-y-3">
            <div>
              <label htmlFor="published-title" className="text-sm font-medium text-ink">
                Title
              </label>
              <input
                id="published-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-describedby={titleErrorId}
                aria-invalid={Boolean(fieldErrors.title)}
                className={INPUT_CLASS}
              />
              {fieldErrors.title && (
                <p id={titleErrorId} className="mt-1 text-xs text-danger">
                  {fieldErrors.title}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="published-description" className="text-sm font-medium text-ink">
                Description
              </label>
              <textarea
                id="published-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className={TEXTAREA_CLASS}
              />
            </div>

            <div>
              <label htmlFor="published-brand" className="text-sm font-medium text-ink">
                Brand <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input
                id="published-brand"
                type="text"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Category &amp; type</h2>
          <p className="mt-1 text-xs text-ink-muted">These can&rsquo;t be changed after publishing.</p>
          <dl className="mt-3 grid grid-cols-1 gap-3 rounded-[10px] border border-border bg-canvas p-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-muted">Category</dt>
              <dd className="font-medium text-ink">{selectedCategory?.name ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Listing type</dt>
              <dd className="font-medium text-ink">{listingTypeLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Condition</dt>
              <dd className="font-medium text-ink">{conditionLabel}</dd>
            </div>
          </dl>

          {serverState.condition === "fair" && (
            <div className="mt-3">
              <label htmlFor="published-known-flaws" className="text-sm font-medium text-ink">
                Known flaws
              </label>
              <textarea
                id="published-known-flaws"
                value={knownFlaws}
                onChange={(event) => setKnownFlaws(event.target.value)}
                rows={3}
                className={TEXTAREA_CLASS}
              />
            </div>
          )}
        </section>

        {isVehicleCategory && (
          <section>
            <h2 className="text-sm font-semibold text-ink">Vehicle details</h2>
            <div className="mt-3">
              <ListingVehicleFields value={vehicleValues} onChange={setVehicleValues} errors={vehicleErrors} />
            </div>
          </section>
        )}

        {isRentalCategory && (
          <section>
            <h2 className="text-sm font-semibold text-ink">Rental details</h2>
            <div className="mt-3">
              <ListingRentalFields value={rentalValues} onChange={setRentalValues} errors={rentalErrors} />
            </div>
          </section>
        )}

        <section>
          <div className="space-y-3">
            <div>
              <label htmlFor="published-price" className="text-sm font-medium text-ink">
                Price
              </label>
              <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
                <span className="text-sm text-ink-muted">₱</span>
                <input
                  id="published-price"
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(event) => setPriceInput(event.target.value)}
                  aria-describedby={priceErrorId}
                  aria-invalid={Boolean(fieldErrors.price)}
                  className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
                />
              </div>
              {fieldErrors.price && (
                <p id={priceErrorId} className="mt-1 text-xs text-danger">
                  {fieldErrors.price}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="published-original-price" className="text-sm font-medium text-ink">
                Original price <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
                <span className="text-sm text-ink-muted">₱</span>
                <input
                  id="published-original-price"
                  type="text"
                  inputMode="decimal"
                  value={originalPriceInput}
                  onChange={(event) => setOriginalPriceInput(event.target.value)}
                  aria-describedby={originalPriceErrorId}
                  aria-invalid={Boolean(fieldErrors.originalPrice)}
                  className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
                />
              </div>
              {fieldErrors.originalPrice && (
                <p id={originalPriceErrorId} className="mt-1 text-xs text-danger">
                  {fieldErrors.originalPrice}
                </p>
              )}
            </div>

            <label className="flex h-11 items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={isNegotiable}
                onChange={(event) => setIsNegotiable(event.target.checked)}
                className="h-4 w-4 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              Price is negotiable
            </label>

            <div>
              <label htmlFor="published-quantity" className="text-sm font-medium text-ink">
                Available quantity
              </label>
              <input
                id="published-quantity"
                type="text"
                inputMode="numeric"
                value={quantityInput}
                onChange={(event) => setQuantityInput(event.target.value)}
                disabled={!serverState.quantityEditable}
                aria-describedby={quantityHintId}
                aria-invalid={Boolean(fieldErrors.quantity)}
                className={INPUT_CLASS}
              />
              <p id={quantityHintId} className="mt-1 text-xs text-ink-muted">
                {serverState.quantityEditable
                  ? `Minimum ${minQuantity} while ${serverState.status === "available" ? "Available" : "Paused"}.`
                  : "This can't be changed right now -- stock is currently reserved by an order."}
              </p>
              {fieldErrors.quantity && <p className="mt-1 text-xs text-danger">{fieldErrors.quantity}</p>}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Location</h2>
          <div className="mt-3">
            <ShopLocationFields
              provinces={provinces}
              initialCities={initialCities}
              initialBarangays={initialBarangays}
              initialValue={location}
              loadCities={loadCities}
              loadBarangays={loadBarangays}
              onChange={setLocation}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Fulfillment</h2>
          <div className="mt-3 space-y-2">
            {FULFILLMENT_METHODS.map((method) => (
              <label key={method} className="flex h-11 items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={fulfillmentMethods.includes(method)}
                  onChange={() => toggleFulfillmentMethod(method)}
                  className="h-4 w-4 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                {FULFILLMENT_LABELS[method]}
              </label>
            ))}
          </div>

          {fulfillmentMethods.includes("meetup") && (
            <div className="mt-3">
              <label htmlFor="published-meetup-note" className="text-sm font-medium text-ink">
                Meetup note <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <textarea
                id="published-meetup-note"
                value={meetupNote}
                onChange={(event) => setMeetupNote(event.target.value)}
                rows={2}
                className={TEXTAREA_CLASS}
              />
            </div>
          )}
        </section>

        {serverState.images.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-ink">Photos</h2>
            <p className="mt-1 text-xs text-ink-muted">Photo editing is coming soon -- these are read-only for now.</p>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {serverState.images.map((image) => {
                const url = getListingImageUrl(image.storagePath);
                return (
                  <div key={image.id} className="relative aspect-square overflow-hidden rounded-[10px] border border-border bg-canvas">
                    {url && <Image src={url} alt="" fill sizes="80px" className="object-cover" />}
                    {image.id === serverState.coverImageId && (
                      <span className="absolute left-1 top-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {saveErrorCode === "LISTING_NOT_EDITABLE" ? (
          <div>
            <p className="text-sm text-danger">{saveError}</p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-2 h-9 rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas"
            >
              Reload page
            </button>
          </div>
        ) : (
          saveError && <p className="text-sm text-danger">{saveError}</p>
        )}
        {saveStatus === "saved" && <p className="text-sm text-success">Saved</p>}
        {saveStatus === "no_changes" && <p className="text-sm text-ink-muted">No changes to save</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || staleConflict}
            className="h-11 w-full rounded-[10px] bg-brand-action px-5 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
