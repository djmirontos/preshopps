"use client";

import { parsePesosToCents, centsToPesosInput } from "@/lib/seller/price-cents";
import { RENTAL_PERIOD_OPTION_LABELS, RENTAL_AVAILABILITY_LABELS } from "@/lib/marketplace/vehicle-rental-labels";
import type { RentalAvailability, RentalPeriod } from "@/lib/marketplace/listing-detail";
import type { MyListingRentalDetails } from "@/lib/seller/get-my-listing";

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60";
const SELECT_CLASS = INPUT_CLASS;
const TEXTAREA_CLASS =
  "mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const PERIOD_OPTIONS = Object.keys(RENTAL_PERIOD_OPTION_LABELS) as RentalPeriod[];
const AVAILABILITY_OPTIONS = Object.keys(RENTAL_AVAILABILITY_LABELS) as RentalAvailability[];

/** All-string raw form state -- money fields parsed via parsePesosToCents
 * only at submit/build time, same convention as ListingForm's own price
 * field. `availability` defaults to "available" (the column's own NOT
 * NULL default, and what create_listing/update_listing already default to
 * when the sub-key is omitted from a supplied object) rather than an
 * empty/unset state, since the column structurally can never be null. */
export type RentalFieldValues = {
  priceInput: string;
  period: RentalPeriod | "";
  securityDepositInput: string;
  terms: string;
  minimumRentalPeriod: string;
  capacity: string;
  whatsIncluded: string;
  rulesRestrictions: string;
  availability: RentalAvailability;
};

export const EMPTY_RENTAL_VALUES: RentalFieldValues = {
  priceInput: "",
  period: "",
  securityDepositInput: "",
  terms: "",
  minimumRentalPeriod: "",
  capacity: "",
  whatsIncluded: "",
  rulesRestrictions: "",
  availability: "available",
};

/** Converts get_my_listing's rentalDetails row (or its absence) into this
 * form's raw-string field shape, for the edit page's own initial prefill. */
export function rentalFieldValuesFromServer(details: MyListingRentalDetails | null): RentalFieldValues {
  if (!details) return EMPTY_RENTAL_VALUES;
  return {
    priceInput: centsToPesosInput(details.rentalPriceCents),
    period: details.rentalPeriod ?? "",
    securityDepositInput: centsToPesosInput(details.securityDepositCents),
    terms: details.rentalTerms ?? "",
    minimumRentalPeriod: details.minimumRentalPeriod ?? "",
    capacity: details.capacity !== null ? String(details.capacity) : "",
    whatsIncluded: details.whatsIncluded ?? "",
    rulesRestrictions: details.rulesRestrictions ?? "",
    availability: details.availability ?? "available",
  };
}

export function isRentalValuesEmpty(v: RentalFieldValues): boolean {
  return (
    v.priceInput.trim() === "" &&
    v.period === "" &&
    v.securityDepositInput.trim() === "" &&
    v.terms.trim() === "" &&
    v.minimumRentalPeriod.trim() === "" &&
    v.capacity.trim() === "" &&
    v.whatsIncluded.trim() === "" &&
    v.rulesRestrictions.trim() === "" &&
    v.availability === "available"
  );
}

export function rentalValuesEqual(a: RentalFieldValues, b: RentalFieldValues): boolean {
  return (
    a.priceInput.trim() === b.priceInput.trim() &&
    a.period === b.period &&
    a.securityDepositInput.trim() === b.securityDepositInput.trim() &&
    a.terms.trim() === b.terms.trim() &&
    a.minimumRentalPeriod.trim() === b.minimumRentalPeriod.trim() &&
    a.capacity.trim() === b.capacity.trim() &&
    a.whatsIncluded.trim() === b.whatsIncluded.trim() &&
    a.rulesRestrictions.trim() === b.rulesRestrictions.trim() &&
    a.availability === b.availability
  );
}

export type RentalFieldErrors = {
  price?: string;
  securityDeposit?: string;
  capacity?: string;
};

/** Gentle client-side validation only -- create_listing/update_listing
 * remain authoritative. */
export function validateRentalValues(v: RentalFieldValues): RentalFieldErrors {
  const errors: RentalFieldErrors = {};

  if (!parsePesosToCents(v.priceInput).ok) {
    errors.price = "Please enter a valid rental price.";
  }

  if (!parsePesosToCents(v.securityDepositInput).ok) {
    errors.securityDeposit = "Please enter a valid security deposit.";
  }

  if (v.capacity.trim() !== "") {
    const capacity = Number(v.capacity.trim());
    if (!Number.isInteger(capacity) || capacity <= 0) {
      errors.capacity = "Please enter a valid capacity.";
    }
  }

  return errors;
}

/** Builds the JSON object create_listing/update_listing expect for
 * p_rental_details / patch.rental_details. Unset fields are OMITTED
 * entirely (same reasoning as ListingVehicleFields' own
 * buildVehicleDetailsJson) -- the RPCs' full-replace-on-upsert behavior
 * resets every omitted field to NULL (or, for `availability`, to its own
 * "available" default) server-side. Assumes validateRentalValues(v) found
 * no errors. */
export function buildRentalDetailsJson(v: RentalFieldValues): Record<string, unknown> {
  const json: Record<string, unknown> = {};

  const price = parsePesosToCents(v.priceInput);
  if (price.ok && price.cents !== null) json.rental_price_cents = price.cents;

  if (v.period !== "") json.rental_period = v.period;

  const deposit = parsePesosToCents(v.securityDepositInput);
  if (deposit.ok && deposit.cents !== null) json.security_deposit_cents = deposit.cents;

  if (v.terms.trim() !== "") json.rental_terms = v.terms.trim();
  if (v.minimumRentalPeriod.trim() !== "") json.minimum_rental_period = v.minimumRentalPeriod.trim();
  if (v.capacity.trim() !== "") json.capacity = Number(v.capacity.trim());
  if (v.whatsIncluded.trim() !== "") json.whats_included = v.whatsIncluded.trim();
  if (v.rulesRestrictions.trim() !== "") json.rules_restrictions = v.rulesRestrictions.trim();
  // "available" is already the backend's own default when this key is
  // omitted from a supplied object, so only a genuine departure from it
  // needs to be sent explicitly.
  if (v.availability !== "available") json.availability = v.availability;

  return json;
}

type Props = {
  value: RentalFieldValues;
  onChange: (value: RentalFieldValues) => void;
  errors?: RentalFieldErrors;
};

/**
 * Optional rental fields for For Rent listings (PRD 13.2) -- every field
 * is optional, matching canon and the underlying listing_rental_details
 * schema exactly. Fully controlled (value + onChange), so ListingForm can
 * reset it to EMPTY_RENTAL_VALUES the instant the seller picks a
 * non-rental category.
 */
export function ListingRentalFields({ value, onChange, errors = {} }: Props) {
  function set<K extends keyof RentalFieldValues>(key: K, next: RentalFieldValues[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="rental-price" className="text-sm font-medium text-ink">
            Rental price <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
            <span className="text-sm text-ink-muted">₱</span>
            <input
              id="rental-price"
              type="text"
              inputMode="decimal"
              value={value.priceInput}
              onChange={(event) => set("priceInput", event.target.value)}
              aria-invalid={Boolean(errors.price)}
              className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
              placeholder="0.00"
            />
          </div>
          {errors.price && <p className="mt-1 text-xs text-danger">{errors.price}</p>}
        </div>

        <div>
          <label htmlFor="rental-period" className="text-sm font-medium text-ink">
            Rental period <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <select
            id="rental-period"
            value={value.period}
            onChange={(event) => set("period", event.target.value as RentalPeriod | "")}
            className={SELECT_CLASS}
          >
            <option value="">Not chosen yet</option>
            {PERIOD_OPTIONS.map((period) => (
              <option key={period} value={period}>
                {RENTAL_PERIOD_OPTION_LABELS[period]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="rental-security-deposit" className="text-sm font-medium text-ink">
          Security deposit <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
          <span className="text-sm text-ink-muted">₱</span>
          <input
            id="rental-security-deposit"
            type="text"
            inputMode="decimal"
            value={value.securityDepositInput}
            onChange={(event) => set("securityDepositInput", event.target.value)}
            aria-invalid={Boolean(errors.securityDeposit)}
            className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
            placeholder="0.00"
          />
        </div>
        {errors.securityDeposit && <p className="mt-1 text-xs text-danger">{errors.securityDeposit}</p>}
      </div>

      <div>
        <label htmlFor="rental-terms" className="text-sm font-medium text-ink">
          Rental terms <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="rental-terms"
          value={value.terms}
          onChange={(event) => set("terms", event.target.value)}
          rows={2}
          className={TEXTAREA_CLASS}
          placeholder="Short summary of terms"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="rental-minimum-period" className="text-sm font-medium text-ink">
            Minimum rental period <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="rental-minimum-period"
            type="text"
            value={value.minimumRentalPeriod}
            onChange={(event) => set("minimumRentalPeriod", event.target.value)}
            className={INPUT_CLASS}
            placeholder="1 day"
          />
        </div>

        <div>
          <label htmlFor="rental-capacity" className="text-sm font-medium text-ink">
            Capacity <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="rental-capacity"
            type="text"
            inputMode="numeric"
            value={value.capacity}
            onChange={(event) => set("capacity", event.target.value)}
            aria-invalid={Boolean(errors.capacity)}
            className={INPUT_CLASS}
            placeholder="4"
          />
          {errors.capacity && <p className="mt-1 text-xs text-danger">{errors.capacity}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="rental-whats-included" className="text-sm font-medium text-ink">
          What&rsquo;s included <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="rental-whats-included"
          value={value.whatsIncluded}
          onChange={(event) => set("whatsIncluded", event.target.value)}
          rows={2}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div>
        <label htmlFor="rental-rules-restrictions" className="text-sm font-medium text-ink">
          Rules &amp; restrictions <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="rental-rules-restrictions"
          value={value.rulesRestrictions}
          onChange={(event) => set("rulesRestrictions", event.target.value)}
          rows={2}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div>
        <label htmlFor="rental-availability" className="text-sm font-medium text-ink">
          Availability
        </label>
        <select
          id="rental-availability"
          value={value.availability}
          onChange={(event) => set("availability", event.target.value as RentalAvailability)}
          className={SELECT_CLASS}
        >
          {AVAILABILITY_OPTIONS.map((availability) => (
            <option key={availability} value={availability}>
              {RENTAL_AVAILABILITY_LABELS[availability]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
