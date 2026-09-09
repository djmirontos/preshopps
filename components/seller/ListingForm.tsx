"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ShopLocationFields, type ShopLocationValue } from "@/components/seller/ShopLocationFields";
import { createListing, CREATE_LISTING_ERROR_MESSAGES, type CreateListingInput } from "@/lib/seller/listing-actions";
import { parsePesosToCents } from "@/lib/seller/price-cents";
import {
  LISTING_TYPE_LABELS,
  CONDITION_LABELS,
  FULFILLMENT_LABELS,
  type ListingTypeFilter,
  type FulfillmentMethod,
} from "@/lib/marketplace/search-params";
import type { ListingCondition } from "@/components/marketplace/ListingCard";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60";
const SELECT_CLASS = INPUT_CLASS;
const TEXTAREA_CLASS =
  "mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const EMPTY_LOCATION: ShopLocationValue = { provinceId: null, cityId: null, barangayId: null };

const PRELOVED_CONDITIONS = Object.keys(CONDITION_LABELS) as ListingCondition[];
const FULFILLMENT_METHODS = Object.keys(FULFILLMENT_LABELS) as FulfillmentMethod[];

type Props = {
  mode: "create";
  categories: CategoryRef[];
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
  initialLocation?: ShopLocationValue;
};

type FieldErrors = {
  title?: string;
  price?: string;
  originalPrice?: string;
  stockQuantity?: string;
};

/**
 * Shared Create/Edit listing form -- this first slice only implements
 * CREATE (mode is currently typed as the literal "create"; edit behavior
 * is a later slice, not stubbed in here half-built). Draft rule mirrors
 * create_listing's own canon exactly: TITLE is the only required field to
 * Save Draft -- every other field, including known_flaws and condition,
 * may remain incomplete, and this form must never block Save Draft on any
 * of them. The only client-side guard kept for Save Draft is avoiding a
 * combination create_listing itself rejects unconditionally (not just at
 * publish): its cross-validation fires whenever BOTH listing_type and
 * condition are supplied and mismatched (LISTING_TYPE_CONDITION_MISMATCH),
 * so switching listing type away from a condition that would now conflict
 * clears that condition rather than leaving a doomed combination in state
 * -- it never forces a condition value into place. Confirmed live in
 * create_listing (0062): `if p_listing_type is not null and p_condition is
 * not null then ... end if` -- the check is skipped entirely whenever
 * either side is null, and the table's own listings_type_condition_check
 * CHECK constraint (0008) evaluates to NULL (satisfied) under the same
 * three-valued logic when condition is null, regardless of listing_type.
 * There is no DB/RPC constraint requiring listing_type='brand_new' to be
 * paired with a non-null condition at Draft time.
 */
export function ListingForm({
  categories,
  provinces,
  initialCities,
  initialBarangays,
  loadCities,
  loadBarangays,
  initialLocation = EMPTY_LOCATION,
}: Props) {
  const router = useRouter();
  const titleErrorId = useId();
  const priceErrorId = useId();
  const originalPriceErrorId = useId();
  const stockErrorId = useId();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [listingType, setListingType] = useState<ListingTypeFilter | null>(null);
  const [condition, setCondition] = useState<ListingCondition | "brand_new" | null>(null);
  const [knownFlaws, setKnownFlaws] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [originalPriceInput, setOriginalPriceInput] = useState("");
  const [isNegotiable, setIsNegotiable] = useState(false);
  const [stockQuantity, setStockQuantity] = useState("1");
  const [location, setLocation] = useState<ShopLocationValue>(initialLocation);
  const [fulfillmentMethods, setFulfillmentMethods] = useState<FulfillmentMethod[]>([]);
  const [meetupNote, setMeetupNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleListingTypeChange(rawValue: string) {
    const next = rawValue === "" ? null : (rawValue as ListingTypeFilter);
    setListingType(next);
    // Never auto-fill a condition -- only clear one that would now conflict
    // with the new type (create_listing rejects a mismatched pair outright
    // whenever both are supplied, Draft included; a null condition never
    // triggers that check, so leaving it null is always safe here). A
    // preloved condition value can never coexist with "brand_new" in state
    // by construction (the preloved select never offers "brand_new" as an
    // option), so only this one direction needs guarding.
    if (next === "brand_new" && condition !== null) {
      setCondition(null);
    }
  }

  function toggleFulfillmentMethod(method: FulfillmentMethod) {
    setFulfillmentMethods((prev) => (prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

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

    const trimmedStock = stockQuantity.trim();
    const stockValue = trimmedStock === "" ? null : Number(trimmedStock);
    if (stockValue !== null && (!Number.isInteger(stockValue) || stockValue < 1)) {
      errors.stockQuantity = "Stock quantity must be at least 1.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    const input: CreateListingInput = {
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
      provinceId: location.provinceId,
      cityId: location.cityId,
      barangayId: location.barangayId,
      meetupNote: fulfillmentMethods.includes("meetup") && meetupNote.trim().length > 0 ? meetupNote.trim() : null,
      fulfillmentMethods,
    };

    const result = await createListing(input);
    setIsSubmitting(false);

    if (!result.ok) {
      setSubmitError(CREATE_LISTING_ERROR_MESSAGES[result.code]);
      return;
    }

    router.push(`/sell/${result.listingId}/edit`);
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
              onChange={(event) => setCategoryId(event.target.value === "" ? null : Number(event.target.value))}
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
                value={condition ?? ""}
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
        <p className="mt-1 text-xs text-ink-muted">Defaults to your shop&rsquo;s location -- change it if this item is elsewhere.</p>
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
