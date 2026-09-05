"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  buildSearchHref,
  CONDITION_LABELS,
  FULFILLMENT_LABELS,
  LISTING_TYPE_LABELS,
  SORT_LABELS,
  type SearchFilters,
  type SearchParamKey,
} from "@/lib/marketplace/search-params";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";
import { PriceRangeFields } from "@/components/search/PriceRangeFields";
import { cn } from "@/lib/cn";

type FilterControlsProps = {
  filters: SearchFilters;
  categories: CategoryRef[];
  provinces: LocationRef[];
  cities: LocationRef[];
  barangays: LocationRef[];
  showSort?: boolean;
};

const SELECT_CLASS =
  "h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function pillClass(isActive: boolean): string {
  return cn(
    "flex h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
    isActive
      ? "border-brand-hover bg-brand-hover text-white"
      : "border-border bg-surface text-ink-secondary hover:border-brand-hover hover:text-brand-hover",
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The full filter/sort control set, shared by the desktop sidebar and the
 * mobile sheet (showSort differs between the two -- mobile has its own
 * top-bar SortSelect, so the sheet copy omits it to avoid a duplicate
 * control). Every control reads its value from `filters` (parsed straight
 * from the URL) and applies changes via buildSearchHref + router.push --
 * there is no separate local filter state to drift from the address bar.
 */
export function FilterControls({
  filters,
  categories,
  provinces,
  cities,
  barangays,
  showSort = false,
}: FilterControlsProps) {
  const router = useRouter();

  function go(updates: Partial<Record<SearchParamKey, string | null>>) {
    router.push(buildSearchHref(filters, updates), { scroll: false });
  }

  return (
    <div className="space-y-6">
      {showSort && (
        <FilterField label="Sort by">
          <select
            aria-label="Sort by"
            value={filters.sort}
            onChange={(event) => go({ sort: event.target.value === "newest" ? null : event.target.value })}
            className={SELECT_CLASS}
          >
            {(Object.entries(SORT_LABELS) as Array<[keyof typeof SORT_LABELS, string]>).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </FilterField>
      )}

      <FilterField label="Category">
        <select
          aria-label="Category"
          value={filters.categorySlug ?? ""}
          onChange={(event) => go({ category: event.target.value || null })}
          className={SELECT_CLASS}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Type">
        <div role="radiogroup" aria-label="Listing type" className="flex flex-wrap gap-2">
          {(["all", "preloved", "brand_new"] as const).map((value) => {
            const isActive = (filters.listingType ?? "all") === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() =>
                  go(
                    value === "all"
                      ? { type: null }
                      : value === "brand_new"
                        ? { type: "brand_new", condition: null }
                        : { type: "preloved" },
                  )
                }
                className={pillClass(isActive)}
              >
                {value === "all" ? "All" : LISTING_TYPE_LABELS[value]}
              </button>
            );
          })}
        </div>
      </FilterField>

      {filters.listingType !== "brand_new" && (
        <FilterField label="Condition">
          <div role="radiogroup" aria-label="Condition" className="flex flex-wrap gap-2">
            {(Object.keys(CONDITION_LABELS) as Array<keyof typeof CONDITION_LABELS>).map((value) => {
              const isActive = filters.condition === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => go({ condition: isActive ? null : value })}
                  className={pillClass(isActive)}
                >
                  {CONDITION_LABELS[value]}
                </button>
              );
            })}
          </div>
          {filters.listingType === null && (
            <p className="mt-1.5 text-xs text-ink-muted">Applies to pre-loved items only.</p>
          )}
        </FilterField>
      )}

      <FilterField label="Price (₱)">
        <PriceRangeFields
          key={`${filters.minPriceCents ?? "none"}-${filters.maxPriceCents ?? "none"}`}
          filters={filters}
          onApply={(updates) => go(updates)}
        />
      </FilterField>

      <FilterField label="Location">
        <div className="space-y-2">
          <select
            aria-label="Province"
            value={filters.provinceId ?? ""}
            onChange={(event) => go({ province: event.target.value || null, city: null, barangay: null })}
            className={SELECT_CLASS}
          >
            <option value="">All Philippines</option>
            {provinces.map((province) => (
              <option key={province.id} value={province.id}>
                {province.name}
              </option>
            ))}
          </select>

          {filters.provinceId !== null && (
            <select
              aria-label="City or municipality"
              value={filters.cityId ?? ""}
              onChange={(event) => go({ city: event.target.value || null, barangay: null })}
              className={SELECT_CLASS}
            >
              <option value="">All cities/municipalities</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          )}

          {filters.cityId !== null && barangays.length > 0 && (
            <select
              aria-label="Barangay"
              value={filters.barangayId ?? ""}
              onChange={(event) => go({ barangay: event.target.value || null })}
              className={SELECT_CLASS}
            >
              <option value="">All barangays</option>
              {barangays.map((barangay) => (
                <option key={barangay.id} value={barangay.id}>
                  {barangay.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </FilterField>

      <FilterField label="Fulfillment">
        <select
          aria-label="Fulfillment method"
          value={filters.fulfillment ?? ""}
          onChange={(event) => go({ fulfillment: event.target.value || null })}
          className={SELECT_CLASS}
        >
          <option value="">Any</option>
          {(Object.entries(FULFILLMENT_LABELS) as Array<[keyof typeof FULFILLMENT_LABELS, string]>).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </FilterField>
    </div>
  );
}
