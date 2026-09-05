import { ActiveFilterChips } from "@/components/search/ActiveFilterChips";
import { FilterControls } from "@/components/search/FilterControls";
import { MobileFilterSheet } from "@/components/search/MobileFilterSheet";
import { ResultsHeader } from "@/components/search/ResultsHeader";
import { SearchResultsClient } from "@/components/search/SearchResultsClient";
import { SortSelect } from "@/components/search/SortSelect";
import {
  buildSearchHref,
  parseSearchFilters,
  type BrowseCursor,
  type RawSearchParams,
  type ResolvedSearchFilters,
  type SearchFilters,
} from "@/lib/marketplace/search-params";
import {
  getBarangaysForCity,
  getCategories,
  getCitiesForProvince,
  getProvinces,
  resolveLocationContext,
} from "@/lib/marketplace/reference-data";
import { searchListings } from "@/lib/marketplace/search-listings";

const RESULTS_LIMIT = 20;

const CLEAR_ALL_UPDATES = {
  category: null,
  type: null,
  condition: null,
  min_price: null,
  max_price: null,
  province: null,
  city: null,
  barangay: null,
  fulfillment: null,
} as const;

type SearchPageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const rawParams = await searchParams;
  const parsed = parseSearchFilters(rawParams);

  const [categories, provinces, resolvedLocation] = await Promise.all([
    getCategories(),
    getProvinces(),
    resolveLocationContext(parsed),
  ]);

  const category = parsed.categorySlug
    ? (categories.find((candidate) => candidate.slug === parsed.categorySlug) ?? null)
    : null;

  const [cities, barangays] = await Promise.all([
    resolvedLocation.provinceId ? getCitiesForProvince(resolvedLocation.provinceId) : Promise.resolve([]),
    resolvedLocation.cityId ? getBarangaysForCity(resolvedLocation.cityId) : Promise.resolve([]),
  ]);

  // Drives the actual RPC call (category resolved to its numeric id).
  const filters: ResolvedSearchFilters = {
    q: parsed.q,
    categoryId: category?.id ?? null,
    listingType: parsed.listingType,
    condition: parsed.condition,
    minPriceCents: parsed.minPriceCents,
    maxPriceCents: parsed.maxPriceCents,
    provinceId: resolvedLocation.provinceId,
    cityId: resolvedLocation.cityId,
    barangayId: resolvedLocation.barangayId,
    fulfillment: parsed.fulfillment,
    sort: parsed.sort,
  };

  // Drives every control/chip/href (keeps the category slug + the
  // resolved-but-still-slug-shaped location ids the URL actually needs).
  const displayFilters: SearchFilters = {
    ...parsed,
    provinceId: resolvedLocation.provinceId,
    cityId: resolvedLocation.cityId,
    barangayId: resolvedLocation.barangayId,
  };

  const result = await searchListings(filters, RESULTS_LIMIT);

  async function loadMoreAction(cursor: BrowseCursor) {
    "use server";
    return searchListings(filters, RESULTS_LIMIT, cursor);
  }

  const locationLabel = filters.barangayId
    ? (barangays.find((barangay) => barangay.id === filters.barangayId)?.name ?? null)
    : filters.cityId
      ? (cities.find((city) => city.id === filters.cityId)?.name ?? null)
      : filters.provinceId
        ? (provinces.find((province) => province.id === filters.provinceId)?.name ?? null)
        : null;

  const clearFiltersHref = buildSearchHref(displayFilters, CLEAR_ALL_UPDATES);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ResultsHeader q={filters.q} categoryName={category?.name ?? null} locationLabel={locationLabel} />
        <div className="hidden lg:block">
          <SortSelect filters={displayFilters} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 lg:hidden">
        <MobileFilterSheet
          filters={displayFilters}
          categories={categories}
          provinces={provinces}
          cities={cities}
          barangays={barangays}
        />
        <SortSelect filters={displayFilters} />
      </div>

      <div className="mt-4">
        <ActiveFilterChips
          filters={displayFilters}
          categoryName={category?.name ?? null}
          locationLabel={locationLabel}
        />
      </div>

      <div className="mt-6 lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
        <aside className="hidden lg:block">
          <FilterControls
            filters={displayFilters}
            categories={categories}
            provinces={provinces}
            cities={cities}
            barangays={barangays}
          />
        </aside>

        <div>
          <SearchResultsClient
            key={JSON.stringify(filters)}
            initialListings={result.listings}
            initialHadError={result.hadError}
            initialCursor={result.nextCursor}
            loadMore={loadMoreAction}
            query={filters.q}
            clearFiltersHref={clearFiltersHref}
          />
        </div>
      </div>
    </div>
  );
}
