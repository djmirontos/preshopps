"use client";

import { REGISTRATION_LABELS } from "@/lib/marketplace/vehicle-rental-labels";
import type { VehicleRegistrationStatus } from "@/lib/marketplace/listing-detail";
import {
  type VehicleFieldValues,
  EMPTY_VEHICLE_VALUES,
  vehicleFieldValuesFromServer,
} from "@/components/listings/listing-field-mappers";

/** Re-exported so existing importers (ListingForm, tests, etc.) keep
 * working unchanged -- the canonical definitions now live in
 * listing-field-mappers.ts so the Server Component at
 * app/sell/[listingId]/edit/page.tsx can call vehicleFieldValuesFromServer
 * without reaching into this "use client" module. */
export { type VehicleFieldValues, EMPTY_VEHICLE_VALUES, vehicleFieldValuesFromServer };

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60";
const SELECT_CLASS = INPUT_CLASS;

const REGISTRATION_OPTIONS = Object.keys(REGISTRATION_LABELS) as VehicleRegistrationStatus[];

/** PRD 13.1's own illustrative examples ("Documents available may include:
 * OR/CR, Deed of sale, Service records") -- the column itself is a plain
 * text[] with no CHECK constraint, but canon names exactly these three, so
 * a simple checkbox list against them (not a free-text tag input, and not
 * an invented longer list) is the smallest correct UX for this slice. */
const DOCUMENT_OPTIONS = ["OR/CR", "Deed of sale", "Service records"] as const;

export function isVehicleValuesEmpty(v: VehicleFieldValues): boolean {
  return (
    v.brand.trim() === "" &&
    v.model.trim() === "" &&
    v.year.trim() === "" &&
    v.mileageKm.trim() === "" &&
    v.transmission.trim() === "" &&
    v.fuelType.trim() === "" &&
    v.registrationStatus === "" &&
    v.documentsAvailable.length === 0
  );
}

export function vehicleValuesEqual(a: VehicleFieldValues, b: VehicleFieldValues): boolean {
  return (
    a.brand.trim() === b.brand.trim() &&
    a.model.trim() === b.model.trim() &&
    a.year.trim() === b.year.trim() &&
    a.mileageKm.trim() === b.mileageKm.trim() &&
    a.transmission.trim() === b.transmission.trim() &&
    a.fuelType.trim() === b.fuelType.trim() &&
    a.registrationStatus === b.registrationStatus &&
    a.documentsAvailable.length === b.documentsAvailable.length &&
    a.documentsAvailable.every((doc, index) => doc === b.documentsAvailable[index])
  );
}

export type VehicleFieldErrors = {
  year?: string;
  mileageKm?: string;
};

/** Gentle client-side validation only -- create_listing/update_listing
 * remain authoritative. Mirrors the RPCs' own >= 1900 / >= 0 checks so a
 * malformed value is caught before a round trip, never more strictly. */
export function validateVehicleValues(v: VehicleFieldValues): VehicleFieldErrors {
  const errors: VehicleFieldErrors = {};

  if (v.year.trim() !== "") {
    const year = Number(v.year.trim());
    if (!Number.isInteger(year) || year < 1900) {
      errors.year = "Please enter a valid year.";
    }
  }

  if (v.mileageKm.trim() !== "") {
    const mileage = Number(v.mileageKm.trim());
    if (!Number.isInteger(mileage) || mileage < 0) {
      errors.mileageKm = "Please enter a valid mileage.";
    }
  }

  return errors;
}

/** Builds the JSON object create_listing/update_listing expect for
 * p_vehicle_details / patch.vehicle_details. Unset fields are OMITTED
 * entirely, never sent as an explicit null -- the RPCs validate each
 * present sub-key's JSON type strictly (e.g. `year` must be a JSON
 * number when the key exists at all) and have no "sub-field null clears
 * it" concept; the full-replace-on-upsert behavior already resets every
 * omitted field to NULL server-side, which is exactly the desired result
 * for an unset field. Assumes validateVehicleValues(v) found no errors. */
export function buildVehicleDetailsJson(v: VehicleFieldValues): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  if (v.brand.trim() !== "") json.brand = v.brand.trim();
  if (v.model.trim() !== "") json.model = v.model.trim();
  if (v.year.trim() !== "") json.year = Number(v.year.trim());
  if (v.mileageKm.trim() !== "") json.mileage_km = Number(v.mileageKm.trim());
  if (v.transmission.trim() !== "") json.transmission = v.transmission.trim();
  if (v.fuelType.trim() !== "") json.fuel_type = v.fuelType.trim();
  if (v.registrationStatus !== "") json.registration_status = v.registrationStatus;
  if (v.documentsAvailable.length > 0) json.documents_available = v.documentsAvailable;
  return json;
}

type Props = {
  value: VehicleFieldValues;
  onChange: (value: VehicleFieldValues) => void;
  errors?: VehicleFieldErrors;
};

/**
 * Optional vehicle fields for Cars/Motorcycles (PRD 13.1) -- every field is
 * optional, matching canon and the underlying listing_vehicle_details
 * schema exactly (brand, model, year, mileage_km, transmission, fuel_type,
 * registration_status, documents_available). Deliberately excludes plate
 * number and VIN, which canon explicitly says never to expose. Fully
 * controlled (value + onChange) rather than internally stateful, so
 * ListingForm can reset it to EMPTY_VEHICLE_VALUES the instant the seller
 * picks a non-vehicle category -- see ListingForm's own header comment for
 * why that clearing must happen in the parent, not here.
 */
export function ListingVehicleFields({ value, onChange, errors = {} }: Props) {
  function set<K extends keyof VehicleFieldValues>(key: K, next: VehicleFieldValues[K]) {
    onChange({ ...value, [key]: next });
  }

  function toggleDocument(doc: string) {
    const next = value.documentsAvailable.includes(doc)
      ? value.documentsAvailable.filter((d) => d !== doc)
      : [...value.documentsAvailable, doc];
    set("documentsAvailable", next);
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="vehicle-brand" className="text-sm font-medium text-ink">
          Brand <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id="vehicle-brand"
          type="text"
          value={value.brand}
          onChange={(event) => set("brand", event.target.value)}
          className={INPUT_CLASS}
          placeholder="Toyota"
        />
      </div>

      <div>
        <label htmlFor="vehicle-model" className="text-sm font-medium text-ink">
          Model <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id="vehicle-model"
          type="text"
          value={value.model}
          onChange={(event) => set("model", event.target.value)}
          className={INPUT_CLASS}
          placeholder="Vios"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="vehicle-year" className="text-sm font-medium text-ink">
            Year <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="vehicle-year"
            type="text"
            inputMode="numeric"
            value={value.year}
            onChange={(event) => set("year", event.target.value)}
            aria-invalid={Boolean(errors.year)}
            className={INPUT_CLASS}
            placeholder="2020"
          />
          {errors.year && <p className="mt-1 text-xs text-danger">{errors.year}</p>}
        </div>

        <div>
          <label htmlFor="vehicle-mileage" className="text-sm font-medium text-ink">
            Mileage (km) <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="vehicle-mileage"
            type="text"
            inputMode="numeric"
            value={value.mileageKm}
            onChange={(event) => set("mileageKm", event.target.value)}
            aria-invalid={Boolean(errors.mileageKm)}
            className={INPUT_CLASS}
            placeholder="50000"
          />
          {errors.mileageKm && <p className="mt-1 text-xs text-danger">{errors.mileageKm}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="vehicle-transmission" className="text-sm font-medium text-ink">
            Transmission <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="vehicle-transmission"
            type="text"
            value={value.transmission}
            onChange={(event) => set("transmission", event.target.value)}
            className={INPUT_CLASS}
            placeholder="Automatic"
          />
        </div>

        <div>
          <label htmlFor="vehicle-fuel-type" className="text-sm font-medium text-ink">
            Fuel type <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id="vehicle-fuel-type"
            type="text"
            value={value.fuelType}
            onChange={(event) => set("fuelType", event.target.value)}
            className={INPUT_CLASS}
            placeholder="Gasoline"
          />
        </div>
      </div>

      <div>
        <label htmlFor="vehicle-registration-status" className="text-sm font-medium text-ink">
          Registration status <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <select
          id="vehicle-registration-status"
          value={value.registrationStatus}
          onChange={(event) => set("registrationStatus", event.target.value as VehicleRegistrationStatus | "")}
          className={SELECT_CLASS}
        >
          <option value="">Not chosen yet</option>
          {REGISTRATION_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {REGISTRATION_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-sm font-medium text-ink">
          Documents available <span className="font-normal text-ink-muted">(optional)</span>
        </p>
        <div className="mt-1.5 space-y-2">
          {DOCUMENT_OPTIONS.map((doc) => (
            <label key={doc} className="flex h-9 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={value.documentsAvailable.includes(doc)}
                onChange={() => toggleDocument(doc)}
                className="h-4 w-4 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              {doc}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
