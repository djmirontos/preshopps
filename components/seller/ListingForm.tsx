"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ShopLocationFields, type ShopLocationValue } from "@/components/seller/ShopLocationFields";
import {
  createListing,
  updateListing,
  CREATE_LISTING_ERROR_MESSAGES,
  UPDATE_LISTING_ERROR_MESSAGES,
  type CreateListingInput,
  type UpdateListingPatch,
} from "@/lib/seller/listing-actions";
import { parsePesosToCents, centsToPesosInput } from "@/lib/seller/price-cents";
import {
  LISTING_TYPE_LABELS,
  CONDITION_LABELS,
  FULFILLMENT_LABELS,
  type ListingTypeFilter,
  type FulfillmentMethod,
} from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";
import {
  ListingVehicleFields,
  EMPTY_VEHICLE_VALUES,
  isVehicleValuesEmpty,
  vehicleValuesEqual,
  validateVehicleValues,
  buildVehicleDetailsJson,
  type VehicleFieldValues,
} from "@/components/seller/ListingVehicleFields";
import {
  ListingRentalFields,
  EMPTY_RENTAL_VALUES,
  isRentalValuesEmpty,
  rentalValuesEqual,
  validateRentalValues,
  buildRentalDetailsJson,
  type RentalFieldValues,
} from "@/components/seller/ListingRentalFields";

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60";
const SELECT_CLASS = INPUT_CLASS;
const TEXTAREA_CLASS =
  "mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const EMPTY_LOCATION: ShopLocationValue = { provinceId: null, cityId: null, barangayId: null };

const PRELOVED_CONDITIONS = Object.keys(CONDITION_LABELS) as ListingCondition[];
const FULFILLMENT_METHODS = Object.keys(FULFILLMENT_LABELS) as FulfillmentMethod[];

/** The non-location, non-extension field set shared by create and edit --
 * identical shape to CreateListingInput minus the location ids (tracked
 * separately via ShopLocationFields' own ShopLocationValue) and minus
 * vehicleDetails/rentalDetails (tracked separately as raw form state --
 * VehicleFieldValues/RentalFieldValues -- and only converted to the JSON
 * shape CreateListingInput/UpdateListingPatch expect at submit time,
 * mirroring how price fields already stay raw strings until submit).
 * Reused as both the create-mode submission shape (spread together with
 * location) and the edit-mode baseline/current values compared to build a
 * patch. */
export type ListingFieldValues = Omit<
  CreateListingInput,
  "provinceId" | "cityId" | "barangayId" | "vehicleDetails" | "rentalDetails"
>;

const CREATE_DEFAULTS: ListingFieldValues = {
  title: "",
  description: null,
  categoryId: null,
  listingType: null,
  condition: null,
  priceCents: null,
  originalPriceCents: null,
  isNegotiable: false,
  brand: null,
  knownFlaws: null,
  stockQuantity: 1,
  meetupNote: null,
  fulfillmentMethods: [],
};

type Props = {
  mode: "create" | "edit";
  /** Required when mode === "edit" -- the listing being edited. */
  listingId?: string;
  categories: CategoryRef[];
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
  initialLocation?: ShopLocationValue;
  /** Edit mode only: the listing's current saved values, used both to
   * prefill the form and as the diff baseline for Save Draft's patch.
   * Create mode ignores this and always starts from CREATE_DEFAULTS. */
  initialValues?: ListingFieldValues;
  /** Edit mode only: the listing's current vehicle/rental extension row
   * (if any), already converted to this form's raw-string field shape.
   * Create mode ignores these and always starts empty. */
  initialVehicleDetails?: VehicleFieldValues;
  initialRentalDetails?: RentalFieldValues;
};

type FieldErrors = {
  title?: string;
  price?: string;
  originalPrice?: string;
  stockQuantity?: string;
};

function fulfillmentSetsEqual(a: FulfillmentMethod[], b: FulfillmentMethod[]): boolean {
  return a.length === b.length && a.every((method) => b.includes(method));
}

/**
 * Shared Create/Edit listing form. Draft rule mirrors create_listing/
 * update_listing's own canon exactly: TITLE is the only required field to
 * Save Draft -- every other field, including known_flaws and condition,
 * may remain incomplete, and this form must never block Save Draft on any
 * of them. The only client-side guard kept for Save Draft is avoiding a
 * combination the RPCs reject unconditionally (not just at publish): their
 * cross-validation fires whenever BOTH listing_type and condition are
 * supplied and mismatched (LISTING_TYPE_CONDITION_MISMATCH), so switching
 * listing type clears a condition that would now conflict -- it never
 * forces a condition value into place. Confirmed live in both
 * create_listing and update_listing (0062): the check is skipped entirely
 * whenever either side is null, and the table's own
 * listings_type_condition_check CHECK constraint (0008) evaluates to NULL
 * (satisfied) under the same three-valued logic when condition is null.
 *
 * Edit mode's Save Draft sends a JSONB patch matching update_listing's own
 * omitted/set/clear contract exactly (0061/0062): a field left unchanged
 * from the loaded baseline is omitted from the patch entirely; a field
 * changed to a new non-null value is sent as that value; a nullable field
 * the seller cleared back to empty is sent as an explicit `null`. This is
 * implemented as a plain structural diff against the baseline captured at
 * load time (or reset after a successful save) -- no sentinel values are
 * invented anywhere; "unchanged" and "explicitly cleared" are distinguished
 * purely by whether the current value differs from the baseline, which is
 * exactly what update_listing itself needs to see.
 */
export function ListingForm({
  mode,
  listingId,
  categories,
  provinces,
  initialCities,
  initialBarangays,
  loadCities,
  loadBarangays,
  initialLocation = EMPTY_LOCATION,
  initialValues,
  initialVehicleDetails,
  initialRentalDetails,
}: Props) {
  const router = useRouter();
  const titleErrorId = useId();
  const priceErrorId = useId();
  const originalPriceErrorId = useId();
  const stockErrorId = useId();

  const baselineValues = initialValues ?? CREATE_DEFAULTS;

  const [baseline, setBaseline] = useState<ListingFieldValues>(baselineValues);
  const [baselineLocation, setBaselineLocation] = useState<ShopLocationValue>(initialLocation);

  const [title, setTitle] = useState(baselineValues.title);
  const [description, setDescription] = useState(baselineValues.description ?? "");
  const [brand, setBrand] = useState(baselineValues.brand ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(baselineValues.categoryId);
  const [listingType, setListingType] = useState<ListingTypeFilter | null>(baselineValues.listingType);
  const [condition, setCondition] = useState<ListingCondition | "brand_new" | null>(baselineValues.condition);
  const [knownFlaws, setKnownFlaws] = useState(baselineValues.knownFlaws ?? "");
  const [priceInput, setPriceInput] = useState(centsToPesosInput(baselineValues.priceCents));
  const [originalPriceInput, setOriginalPriceInput] = useState(centsToPesosInput(baselineValues.originalPriceCents));
  const [isNegotiable, setIsNegotiable] = useState(baselineValues.isNegotiable);
  const [stockQuantity, setStockQuantity] = useState(
    baselineValues.stockQuantity !== null ? String(baselineValues.stockQuantity) : "1",
  );
  const [location, setLocation] = useState<ShopLocationValue>(initialLocation);
  const [fulfillmentMethods, setFulfillmentMethods] = useState<FulfillmentMethod[]>(baselineValues.fulfillmentMethods);
  const [meetupNote, setMeetupNote] = useState(baselineValues.meetupNote ?? "");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "no_changes">("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [vehicleBaseline, setVehicleBaseline] = useState<VehicleFieldValues>(initialVehicleDetails ?? EMPTY_VEHICLE_VALUES);
  const [vehicleValues, setVehicleValues] = useState<VehicleFieldValues>(initialVehicleDetails ?? EMPTY_VEHICLE_VALUES);
  const [vehicleErrors, setVehicleErrors] = useState<ReturnType<typeof validateVehicleValues>>({});
  const [rentalBaseline, setRentalBaseline] = useState<RentalFieldValues>(initialRentalDetails ?? EMPTY_RENTAL_VALUES);
  const [rentalValues, setRentalValues] = useState<RentalFieldValues>(initialRentalDetails ?? EMPTY_RENTAL_VALUES);
  const [rentalErrors, setRentalErrors] = useState<ReturnType<typeof validateRentalValues>>({});

  // Resolved fresh every render from live client state (categoryId +
  // the categories prop already passed into this form) -- never a
  // one-time prop snapshot, so changing the category select immediately
  // shows/hides the right extension fields in the same render pass. This
  // is deliberately unlike ListingImagesPicker's own `listingType` prop,
  // which is a sibling Server Component's one-time read and needs a
  // router.refresh() round trip to update (see this form's own
  // handleSubmit for that fix) -- there is no such gap here because
  // category/type/condition and vehicle/rental all live in this same
  // component's client state already.
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const categorySlug = selectedCategory?.slug ?? null;
  const isVehicleCategory = categorySlug === "cars" || categorySlug === "motorcycles";
  const isRentalCategory = categorySlug === "for-rent";

  function handleCategoryChange(rawValue: string) {
    const nextId = rawValue === "" ? null : Number(rawValue);
    setCategoryId(nextId);

    // Clear the hidden extension state the instant the category leaves its
    // eligible group -- canon requires this (no stale hidden data), and it
    // is what lets the final-state comparison in handleSubmit correctly
    // decide to send an explicit clear for edit mode below.
    const nextCategory = categories.find((category) => category.id === nextId);
    const nextSlug = nextCategory?.slug ?? null;
    const nextIsVehicle = nextSlug === "cars" || nextSlug === "motorcycles";
    const nextIsRental = nextSlug === "for-rent";

    if (!nextIsVehicle) setVehicleValues(EMPTY_VEHICLE_VALUES);
    if (!nextIsRental) setRentalValues(EMPTY_RENTAL_VALUES);
  }

  function handleListingTypeChange(rawValue: string) {
    const next = rawValue === "" ? null : (rawValue as ListingTypeFilter);
    setListingType(next);
    // Never auto-fill a condition -- only clear one that would now conflict
    // with the new type (both RPCs reject a mismatched pair outright
    // whenever both are supplied, Draft included; a null condition never
    // triggers that check, so leaving it null is always safe here). Edit
    // mode can load a listing whose saved condition is already "brand_new"
    // (a fully valid prior state), so both directions need guarding here,
    // unlike a fresh create-mode form where "brand_new" can never appear
    // in state except via this same guard.
    if (next === "brand_new" && condition !== null && condition !== "brand_new") {
      setCondition(null);
    } else if (next !== "brand_new" && condition === "brand_new") {
      setCondition(null);
    }
  }

  function toggleFulfillmentMethod(method: FulfillmentMethod) {
    setFulfillmentMethods((prev) => (prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
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

    // Stock quantity can never be cleared once a listing exists: create_listing
    // is happy to default a blank value to 1, but update_listing's patch
    // contract rejects an explicit null for it outright (STOCK_QUANTITY_INVALID)
    // -- so in edit mode a blank stock field is invalid, not "leave unchanged."
    const trimmedStock = stockQuantity.trim();
    const stockValue = trimmedStock === "" ? null : Number(trimmedStock);
    if (stockValue === null) {
      if (mode === "edit") {
        errors.stockQuantity = "Stock quantity must be at least 1.";
      }
    } else if (!Number.isInteger(stockValue) || stockValue < 1) {
      errors.stockQuantity = "Stock quantity must be at least 1.";
    }

    const nextVehicleErrors = validateVehicleValues(vehicleValues);
    const nextRentalErrors = validateRentalValues(rentalValues);
    setVehicleErrors(nextVehicleErrors);
    setRentalErrors(nextRentalErrors);

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || Object.keys(nextVehicleErrors).length > 0 || Object.keys(nextRentalErrors).length > 0) {
      return;
    }

    const currentValues: ListingFieldValues = {
      title: title.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
      categoryId,
      listingType,
      condition,
      priceCents: priceResult.ok ? priceResult.cents : null,
      originalPriceCents: originalPriceResult.ok ? originalPriceResult.cents : null,
      isNegotiable,
      brand: brand.trim().length > 0 ? brand.trim() : null,
      knownFlaws: knownFlaws.trim().length > 0 ? knownFlaws.trim() : null,
      stockQuantity: stockValue,
      meetupNote: fulfillmentMethods.includes("meetup") && meetupNote.trim().length > 0 ? meetupNote.trim() : null,
      fulfillmentMethods,
    };

    if (mode === "create") {
      setIsSubmitting(true);
      const input: CreateListingInput = {
        ...currentValues,
        provinceId: location.provinceId,
        cityId: location.cityId,
        barangayId: location.barangayId,
        // Category eligibility already guarantees these are empty whenever
        // the category isn't vehicle/rental-eligible (handleCategoryChange
        // clears them the instant the category leaves that group), so no
        // extra category gate is needed here -- "omit/null when nothing is
        // filled in" and "never send for the wrong category" collapse into
        // the same isXValuesEmpty check.
        vehicleDetails: isVehicleValuesEmpty(vehicleValues) ? null : buildVehicleDetailsJson(vehicleValues),
        rentalDetails: isRentalValuesEmpty(rentalValues) ? null : buildRentalDetailsJson(rentalValues),
      };
      const result = await createListing(input);
      setIsSubmitting(false);

      if (!result.ok) {
        setSubmitError(CREATE_LISTING_ERROR_MESSAGES[result.code]);
        return;
      }

      router.push(`/sell/${result.listingId}/edit`);
      return;
    }

    // ===== edit mode: build a patch containing only what actually changed =====
    const patch: UpdateListingPatch = {};

    if (currentValues.title !== baseline.title) patch.title = currentValues.title;
    if (currentValues.description !== baseline.description) patch.description = currentValues.description;
    if (currentValues.categoryId !== baseline.categoryId) patch.category_id = currentValues.categoryId;
    if (currentValues.listingType !== baseline.listingType) patch.listing_type = currentValues.listingType;
    if (currentValues.condition !== baseline.condition) patch.condition = currentValues.condition;
    if (currentValues.priceCents !== baseline.priceCents) patch.price_cents = currentValues.priceCents;
    if (currentValues.originalPriceCents !== baseline.originalPriceCents) {
      patch.original_price_cents = currentValues.originalPriceCents;
    }
    if (currentValues.isNegotiable !== baseline.isNegotiable) patch.is_negotiable = currentValues.isNegotiable;
    if (currentValues.brand !== baseline.brand) patch.brand = currentValues.brand;
    if (currentValues.knownFlaws !== baseline.knownFlaws) patch.known_flaws = currentValues.knownFlaws;
    // Guarded above: stockValue is never null when mode === "edit" reaches here.
    if (currentValues.stockQuantity !== baseline.stockQuantity) patch.stock_quantity = currentValues.stockQuantity!;
    if (currentValues.meetupNote !== baseline.meetupNote) patch.meetup_note = currentValues.meetupNote;

    if (location.provinceId !== baselineLocation.provinceId) patch.province_id = location.provinceId;
    if (location.cityId !== baselineLocation.cityId) patch.city_id = location.cityId;
    if (location.barangayId !== baselineLocation.barangayId) patch.barangay_id = location.barangayId;

    if (!fulfillmentSetsEqual(currentValues.fulfillmentMethods, baseline.fulfillmentMethods)) {
      patch.fulfillment_methods = currentValues.fulfillmentMethods;
    }

    // Vehicle/rental extensions: the top-level key follows the usual
    // omit/set/clear contract, but once "set" the RPC treats the object as
    // a full replacement of the row's sub-fields (any sub-field absent
    // from the object is reset to NULL server-side) -- so whenever
    // anything changed, the COMPLETE current object is sent, never a
    // partial diff of just the touched sub-fields.
    const vehicleEmpty = isVehicleValuesEmpty(vehicleValues);
    const baselineVehicleEmpty = isVehicleValuesEmpty(vehicleBaseline);
    if (vehicleEmpty && !baselineVehicleEmpty) {
      patch.vehicle_details = null;
    } else if (!vehicleEmpty && (baselineVehicleEmpty || !vehicleValuesEqual(vehicleValues, vehicleBaseline))) {
      patch.vehicle_details = buildVehicleDetailsJson(vehicleValues);
    }

    const rentalEmpty = isRentalValuesEmpty(rentalValues);
    const baselineRentalEmpty = isRentalValuesEmpty(rentalBaseline);
    if (rentalEmpty && !baselineRentalEmpty) {
      patch.rental_details = null;
    } else if (!rentalEmpty && (baselineRentalEmpty || !rentalValuesEqual(rentalValues, rentalBaseline))) {
      patch.rental_details = buildRentalDetailsJson(rentalValues);
    }

    if (Object.keys(patch).length === 0) {
      setSaveStatus("no_changes");
      return;
    }

    setIsSubmitting(true);
    const result = await updateListing(listingId!, patch);
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(UPDATE_LISTING_ERROR_MESSAGES[result.code]);
      return;
    }

    // Reset the baseline to what was just saved, so an immediate second
    // Save Draft with no further edits correctly detects no changes.
    setBaseline(currentValues);
    setBaselineLocation(location);
    setVehicleBaseline(vehicleValues);
    setRentalBaseline(rentalValues);
    setSaveStatus("saved");

    // Re-fetch the page's own server data (get_my_listing) so sibling
    // Server Components on this same route -- specifically
    // ListingImagesPicker's `listingType` prop -- pick up whatever the
    // seller just changed here (e.g. Pre-loved -> Brand New) without a
    // manual reload. router.refresh() only re-runs the Server Component
    // tree for the current route; it does not re-submit this form, call
    // update_listing again, or navigate anywhere, and only ever runs after
    // a confirmed successful save (the no-change and failure paths above
    // both return before reaching this point). ListingForm's own fields
    // are unaffected -- its state is seeded from props once at mount, not
    // resubscribed to prop changes, so the fresh props this triggers never
    // overwrite what the seller is looking at (which already matches the
    // just-saved server truth regardless).
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <section>
        <h2 className="text-sm font-semibold text-ink">Listing details</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="listing-title" className="text-sm font-medium text-ink">
              Title
            </label>
            <input
              id="listing-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-describedby={titleErrorId}
              aria-invalid={Boolean(fieldErrors.title)}
              className={INPUT_CLASS}
              placeholder="Nike Air Max 270"
            />
            {fieldErrors.title && (
              <p id={titleErrorId} className="mt-1 text-xs text-danger">
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="listing-description" className="text-sm font-medium text-ink">
              Description <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="listing-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className={TEXTAREA_CLASS}
              placeholder="Describe your item -- condition, size, what's included..."
            />
          </div>

          <div>
            <label htmlFor="listing-brand" className="text-sm font-medium text-ink">
              Brand <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id="listing-brand"
              type="text"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Nike"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Category &amp; condition</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="listing-category" className="text-sm font-medium text-ink">
              Category <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <select
              id="listing-category"
              value={categoryId ?? ""}
              onChange={(event) => handleCategoryChange(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">No category yet</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="listing-type" className="text-sm font-medium text-ink">
              Listing type <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <select
              id="listing-type"
              value={listingType ?? ""}
              onChange={(event) => handleListingTypeChange(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Not chosen yet</option>
              {(Object.keys(LISTING_TYPE_LABELS) as ListingTypeFilter[]).map((type) => (
                <option key={type} value={type}>
                  {LISTING_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="listing-condition" className="text-sm font-medium text-ink">
              Condition <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            {listingType === "brand_new" ? (
              <p className="mt-1.5 text-sm text-ink-secondary">
                Brand New listings use Brand New condition -- this is set automatically when you publish, no need to choose it now.
              </p>
            ) : (
              <select
                id="listing-condition"
                value={condition === "brand_new" ? "" : (condition ?? "")}
                onChange={(event) => setCondition(event.target.value === "" ? null : (event.target.value as ListingCondition))}
                disabled={listingType === null}
                className={SELECT_CLASS}
              >
                <option value="">{listingType === null ? "Choose a listing type first" : "Not chosen yet"}</option>
                {PRELOVED_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {CONDITION_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
          </div>

          {condition === "fair" && (
            <div>
              <label htmlFor="listing-known-flaws" className="text-sm font-medium text-ink">
                Known flaws <span className="font-normal text-ink-muted">(optional for now)</span>
              </label>
              <textarea
                id="listing-known-flaws"
                value={knownFlaws}
                onChange={(event) => setKnownFlaws(event.target.value)}
                rows={3}
                className={TEXTAREA_CLASS}
                placeholder="Describe any flaws, damage, or wear."
              />
              <p className="mt-1 text-xs text-ink-muted">You can leave this for now -- it will be required before publishing.</p>
            </div>
          )}
        </div>
      </section>

      {isVehicleCategory && (
        <section>
          <h2 className="text-sm font-semibold text-ink">Vehicle details</h2>
          <p className="mt-1 text-xs text-ink-muted">Optional while Draft.</p>
          <div className="mt-3">
            <ListingVehicleFields value={vehicleValues} onChange={setVehicleValues} errors={vehicleErrors} />
          </div>
        </section>
      )}

      {isRentalCategory && (
        <section>
          <h2 className="text-sm font-semibold text-ink">Rental details</h2>
          <p className="mt-1 text-xs text-ink-muted">Optional while Draft.</p>
          <div className="mt-3">
            <ListingRentalFields value={rentalValues} onChange={setRentalValues} errors={rentalErrors} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-ink">Price &amp; stock</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="listing-price" className="text-sm font-medium text-ink">
              Price <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
              <span className="text-sm text-ink-muted">₱</span>
              <input
                id="listing-price"
                type="text"
                inputMode="decimal"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                aria-describedby={priceErrorId}
                aria-invalid={Boolean(fieldErrors.price)}
                className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
                placeholder="0.00"
              />
            </div>
            {fieldErrors.price && (
              <p id={priceErrorId} className="mt-1 text-xs text-danger">
                {fieldErrors.price}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="listing-original-price" className="text-sm font-medium text-ink">
              Original price <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
              <span className="text-sm text-ink-muted">₱</span>
              <input
                id="listing-original-price"
                type="text"
                inputMode="decimal"
                value={originalPriceInput}
                onChange={(event) => setOriginalPriceInput(event.target.value)}
                aria-describedby={originalPriceErrorId}
                aria-invalid={Boolean(fieldErrors.originalPrice)}
                className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
                placeholder="0.00"
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
            <label htmlFor="listing-stock" className="text-sm font-medium text-ink">
              Stock quantity
            </label>
            <input
              id="listing-stock"
              type="text"
              inputMode="numeric"
              value={stockQuantity}
              onChange={(event) => setStockQuantity(event.target.value)}
              aria-describedby={stockErrorId}
              aria-invalid={Boolean(fieldErrors.stockQuantity)}
              className={INPUT_CLASS}
            />
            {fieldErrors.stockQuantity && (
              <p id={stockErrorId} className="mt-1 text-xs text-danger">
                {fieldErrors.stockQuantity}
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink">Location</h2>
        <p className="mt-1 text-xs text-ink-muted">
          {mode === "create" ? "Defaults to your shop’s location -- change it if this item is elsewhere." : "Change any level, or clear it back to unset."}
        </p>
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
        <p className="mt-1 text-xs text-ink-muted">Optional while Draft.</p>
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
            <label htmlFor="listing-meetup-note" className="text-sm font-medium text-ink">
              Meetup note <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="listing-meetup-note"
              value={meetupNote}
              onChange={(event) => setMeetupNote(event.target.value)}
              rows={2}
              className={TEXTAREA_CLASS}
              placeholder="Preferred meetup spots or times"
            />
          </div>
        )}
      </section>

      {submitError && <p className="text-sm text-danger">{submitError}</p>}
      {saveStatus === "saved" && <p className="text-sm text-success">Draft saved</p>}
      {saveStatus === "no_changes" && <p className="text-sm text-ink-muted">No changes to save</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-11 w-full rounded-[10px] bg-brand-action px-5 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting ? "Saving…" : "Save Draft"}
        </button>
      </div>
    </form>
  );
}
