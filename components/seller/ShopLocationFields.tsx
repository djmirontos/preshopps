"use client";

import { useId, useState, useTransition } from "react";
import type { LocationRef } from "@/lib/marketplace/reference-data";

const SELECT_CLASS =
  "h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60";

export type ShopLocationValue = {
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
};

type Props = {
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  initialValue: ShopLocationValue;
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
  onChange: (value: ShopLocationValue) => void;
  provinceErrorId?: string;
  cityErrorId?: string;
};

/**
 * Province -> City/Municipality -> Barangay, IDs only (never free-text
 * location names, matching this task's own explicit requirement). Uses
 * the existing getCitiesForProvince/getBarangaysForCity Server Actions
 * (passed in from the page, exactly like shop/[slug]/page.tsx's own
 * loadMoreAction pattern) for the two dependent loads -- this is a
 * stateful form, not a URL-driven filter like FilterControls, so it can't
 * reuse that component's router.push-based pattern; it needs real local
 * state instead. Choosing a province resets an invalid city/barangay;
 * choosing a city resets an invalid barangay -- selection is never left
 * pointing at a child that no longer matches its parent.
 *
 * Degrades gracefully when the live reference tables are empty (currently
 * true for all three): an empty `provinces` array renders a clear
 * "Location options are not available yet" message instead of a dead,
 * empty dropdown, and never fabricates placeholder location rows.
 */
export function ShopLocationFields({
  provinces,
  initialCities,
  initialBarangays,
  initialValue,
  loadCities,
  loadBarangays,
  onChange,
  provinceErrorId,
  cityErrorId,
}: Props) {
  const cityFieldId = useId();
  const barangayFieldId = useId();

  const [value, setValue] = useState(initialValue);
  const [cities, setCities] = useState(initialCities);
  const [barangays, setBarangays] = useState(initialBarangays);
  const [isPending, startTransition] = useTransition();

  function emit(next: ShopLocationValue) {
    setValue(next);
    onChange(next);
  }

  function handleProvinceChange(rawValue: string) {
    const provinceId = rawValue ? Number(rawValue) : null;
    setCities([]);
    setBarangays([]);
    emit({ provinceId, cityId: null, barangayId: null });

    if (provinceId === null) return;
    startTransition(async () => {
      const nextCities = (await loadCities(provinceId)) ?? [];
      setCities(nextCities);
    });
  }

  function handleCityChange(rawValue: string) {
    const cityId = rawValue ? Number(rawValue) : null;
    setBarangays([]);
    emit({ ...value, cityId, barangayId: null });

    if (cityId === null) return;
    startTransition(async () => {
      const nextBarangays = (await loadBarangays(cityId)) ?? [];
      setBarangays(nextBarangays);
    });
  }

  function handleBarangayChange(rawValue: string) {
    emit({ ...value, barangayId: rawValue ? Number(rawValue) : null });
  }

  if (provinces.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-border bg-canvas p-3">
        <p className="text-sm text-ink-secondary">Location options are not available yet.</p>
        <p className="mt-1 text-xs text-ink-muted">Please check back later -- shop location setup requires data that hasn&rsquo;t been added yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={cityFieldId + "-province"} className="text-sm font-medium text-ink">
          Province
        </label>
        <select
          id={cityFieldId + "-province"}
          value={value.provinceId ?? ""}
          onChange={(event) => handleProvinceChange(event.target.value)}
          aria-describedby={provinceErrorId}
          className={`${SELECT_CLASS} mt-1.5`}
        >
          <option value="">Select a province</option>
          {provinces.map((province) => (
            <option key={province.id} value={province.id}>
              {province.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={cityFieldId} className="text-sm font-medium text-ink">
          City / Municipality
        </label>
        {value.provinceId === null ? (
          <p className="mt-1.5 text-xs text-ink-muted">Choose a province first.</p>
        ) : cities.length === 0 && !isPending ? (
          <p className="mt-1.5 text-xs text-ink-muted">No cities/municipalities available for this province yet.</p>
        ) : (
          <select
            id={cityFieldId}
            value={value.cityId ?? ""}
            onChange={(event) => handleCityChange(event.target.value)}
            disabled={isPending}
            aria-describedby={cityErrorId}
            className={`${SELECT_CLASS} mt-1.5`}
          >
            <option value="">{isPending ? "Loading…" : "Select a city or municipality"}</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label htmlFor={barangayFieldId} className="text-sm font-medium text-ink">
          Barangay <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        {value.cityId === null ? (
          <p className="mt-1.5 text-xs text-ink-muted">Choose a city or municipality first.</p>
        ) : barangays.length === 0 && !isPending ? (
          <p className="mt-1.5 text-xs text-ink-muted">No barangays available for this city yet.</p>
        ) : (
          <select
            id={barangayFieldId}
            value={value.barangayId ?? ""}
            onChange={(event) => handleBarangayChange(event.target.value)}
            disabled={isPending}
            className={`${SELECT_CLASS} mt-1.5`}
          >
            <option value="">{isPending ? "Loading…" : "No specific barangay"}</option>
            {barangays.map((barangay) => (
              <option key={barangay.id} value={barangay.id}>
                {barangay.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
