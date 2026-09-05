import type { ListingCondition } from "@/components/marketplace/ListingCard";

export type ListingTypeFilter = "preloved" | "brand_new";
export type FulfillmentMethod = "meetup" | "pickup" | "local_delivery" | "shipping";
export type SortMode = "newest" | "price_low" | "price_high";

const LISTING_TYPES: ReadonlySet<string> = new Set<ListingTypeFilter>(["preloved", "brand_new"]);
const CONDITIONS: ReadonlySet<string> = new Set<ListingCondition>([
  "like_new",
  "very_good",
  "good",
  "fair",
]);
const FULFILLMENT_METHODS: ReadonlySet<string> = new Set<FulfillmentMethod>([
  "meetup",
  "pickup",
  "local_delivery",
  "shipping",
]);
const SORT_MODES: ReadonlySet<string> = new Set<SortMode>(["newest", "price_low", "price_high"]);

export const LISTING_TYPE_LABELS: Record<ListingTypeFilter, string> = {
  preloved: "Pre-loved",
  brand_new: "Brand New",
};

export const CONDITION_LABELS: Record<ListingCondition, string> = {
  like_new: "Like New",
  very_good: "Very Good",
  good: "Good",
  fair: "Fair",
};

export const FULFILLMENT_LABELS: Record<FulfillmentMethod, string> = {
  meetup: "Meetup",
  pickup: "Pickup",
  local_delivery: "Local Delivery",
  shipping: "Shipping",
};

export const SORT_LABELS: Record<SortMode, string> = {
  newest: "Newest",
  price_low: "Price: Low to High",
  price_high: "Price: High to Low",
};

const MAX_QUERY_LENGTH = 100;
// Mirrors the categories.slug check constraint (0005_categories.sql).
const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Parsed + validated URL filter state -- the single source of truth for
 * /search. Location fields are exactly as given in the URL (not yet
 * cross-resolved against each other or against live reference data --
 * that happens in reference-data.ts's resolveLocationContext, which needs
 * DB access this pure parser deliberately does not have).
 */
export type SearchFilters = {
  q: string | null;
  categorySlug: string | null;
  listingType: ListingTypeFilter | null;
  condition: ListingCondition | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
  fulfillment: FulfillmentMethod | null;
  sort: SortMode;
};

/** Same shape, but categorySlug has been resolved to the numeric id
 * browse_listings actually accepts. Used only where the RPC is called. */
export type ResolvedSearchFilters = Omit<SearchFilters, "categorySlug"> & {
  categoryId: number | null;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Whole-peso price from the URL (e.g. `min_price=500` -> 50000 cents).
 * Negative, non-numeric, or fractional values are ignored rather than
 * rejected -- URL params are untrusted input, never a crash surface. */
function parsePriceCents(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const pesos = Number(value);
  return Number.isSafeInteger(pesos) && pesos >= 0 ? pesos * 100 : null;
}

export function parseSearchFilters(raw: RawSearchParams): SearchFilters {
  const q = (() => {
    const value = firstValue(raw.q)?.trim();
    if (!value) return null;
    return value.length > MAX_QUERY_LENGTH ? null : value;
  })();

  const categorySlug = (() => {
    const value = firstValue(raw.category)?.trim().toLowerCase();
    return value && CATEGORY_SLUG_PATTERN.test(value) ? value : null;
  })();

  const rawType = firstValue(raw.type);
  const listingType = rawType && LISTING_TYPES.has(rawType) ? (rawType as ListingTypeFilter) : null;

  const rawCondition = firstValue(raw.condition);
  const parsedCondition =
    rawCondition && CONDITIONS.has(rawCondition) ? (rawCondition as ListingCondition) : null;
  // Brand New has no condition dimension -- a stray ?condition= must never
  // silently narrow a brand_new-scoped search.
  const condition = listingType === "brand_new" ? null : parsedCondition;

  let minPriceCents = parsePriceCents(firstValue(raw.min_price));
  let maxPriceCents = parsePriceCents(firstValue(raw.max_price));
  if (minPriceCents !== null && maxPriceCents !== null && minPriceCents > maxPriceCents) {
    // Ambiguous user intent -- drop the whole price filter rather than
    // guess (silently swapping min/max could return results the shared
    // URL never implied).
    minPriceCents = null;
    maxPriceCents = null;
  }

  const rawFulfillment = firstValue(raw.fulfillment);
  const fulfillment =
    rawFulfillment && FULFILLMENT_METHODS.has(rawFulfillment) ? (rawFulfillment as FulfillmentMethod) : null;

  const rawSort = firstValue(raw.sort);
  const sort = rawSort && SORT_MODES.has(rawSort) ? (rawSort as SortMode) : "newest";

  return {
    q,
    categorySlug,
    listingType,
    condition,
    minPriceCents,
    maxPriceCents,
    provinceId: parsePositiveInt(firstValue(raw.province)),
    cityId: parsePositiveInt(firstValue(raw.city)),
    barangayId: parsePositiveInt(firstValue(raw.barangay)),
    fulfillment,
    sort,
  };
}

export function countActiveFilters(filters: SearchFilters): number {
  let count = 0;
  if (filters.categorySlug) count++;
  if (filters.listingType) count++;
  if (filters.condition) count++;
  if (filters.minPriceCents !== null || filters.maxPriceCents !== null) count++;
  if (filters.provinceId !== null) count++;
  if (filters.fulfillment) count++;
  return count;
}

export type SearchParamKey =
  | "q"
  | "category"
  | "type"
  | "condition"
  | "min_price"
  | "max_price"
  | "province"
  | "city"
  | "barangay"
  | "fulfillment"
  | "sort";

const PARAM_ORDER: SearchParamKey[] = [
  "q",
  "category",
  "type",
  "condition",
  "min_price",
  "max_price",
  "province",
  "city",
  "barangay",
  "fulfillment",
  "sort",
];

/** Serializes filters back into URL param strings (inverse of
 * parseSearchFilters), omitting anything at its default/absent value so
 * URLs stay minimal (e.g. sort=newest is never written explicitly). */
function filtersToSearchParams(filters: SearchFilters): Partial<Record<SearchParamKey, string>> {
  const params: Partial<Record<SearchParamKey, string>> = {};
  if (filters.q) params.q = filters.q;
  if (filters.categorySlug) params.category = filters.categorySlug;
  if (filters.listingType) params.type = filters.listingType;
  if (filters.condition) params.condition = filters.condition;
  if (filters.minPriceCents !== null) params.min_price = String(Math.round(filters.minPriceCents / 100));
  if (filters.maxPriceCents !== null) params.max_price = String(Math.round(filters.maxPriceCents / 100));
  if (filters.provinceId !== null) params.province = String(filters.provinceId);
  if (filters.cityId !== null) params.city = String(filters.cityId);
  if (filters.barangayId !== null) params.barangay = String(filters.barangayId);
  if (filters.fulfillment) params.fulfillment = filters.fulfillment;
  if (filters.sort !== "newest") params.sort = filters.sort;
  return params;
}

/**
 * Builds a `/search?...` href by applying `updates` on top of the filters
 * currently reflected in the URL. A value of `null` in `updates` deletes
 * that param. This is the ONLY place that constructs a filter URL --
 * every control and chip goes through it, so the address bar always stays
 * the single source of truth (no separate client filter state to drift).
 */
export function buildSearchHref(
  filters: SearchFilters,
  updates: Partial<Record<SearchParamKey, string | null>>,
): string {
  const next: Partial<Record<SearchParamKey, string>> = { ...filtersToSearchParams(filters) };

  for (const [key, value] of Object.entries(updates) as [SearchParamKey, string | null][]) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  const search = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    const value = next[key];
    if (value !== undefined) search.set(key, value);
  }

  const qs = search.toString();
  return qs ? `/search?${qs}` : "/search";
}

export type BrowseCursor = {
  createdAt?: string;
  priceCents?: number;
  id: string;
};

export type BrowseListingsRpcArgs = {
  p_search: string | null;
  p_category_id: number | null;
  p_listing_type: ListingTypeFilter | null;
  p_condition: ListingCondition | null;
  p_min_price_cents: number | null;
  p_max_price_cents: number | null;
  p_province_id: number | null;
  p_city_id: number | null;
  p_barangay_id: number | null;
  p_fulfillment_method: FulfillmentMethod | null;
  p_sort: SortMode;
  p_limit: number;
  p_before_created_at: string | null;
  p_before_price_cents: number | null;
  p_before_id: string | null;
};

/** Maps validated filters + a keyset cursor to the exact browse_listings
 * parameter names, sending only the cursor pair relevant to the active
 * sort mode (the RPC itself only ever reads that pair). */
export function toBrowseListingsArgs(
  filters: ResolvedSearchFilters,
  limit: number,
  cursor?: BrowseCursor,
): BrowseListingsRpcArgs {
  return {
    p_search: filters.q,
    p_category_id: filters.categoryId,
    p_listing_type: filters.listingType,
    p_condition: filters.condition,
    p_min_price_cents: filters.minPriceCents,
    p_max_price_cents: filters.maxPriceCents,
    p_province_id: filters.provinceId,
    p_city_id: filters.cityId,
    p_barangay_id: filters.barangayId,
    p_fulfillment_method: filters.fulfillment,
    p_sort: filters.sort,
    p_limit: limit,
    p_before_created_at: filters.sort === "newest" ? (cursor?.createdAt ?? null) : null,
    p_before_price_cents: filters.sort !== "newest" ? (cursor?.priceCents ?? null) : null,
    p_before_id: cursor?.id ?? null,
  };
}
