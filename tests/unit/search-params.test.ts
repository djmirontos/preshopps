import { describe, expect, it } from "vitest";
import {
  buildSearchHref,
  parseSearchFilters,
  toBrowseListingsArgs,
  type ResolvedSearchFilters,
} from "@/lib/marketplace/search-params";

describe("parseSearchFilters", () => {
  it("parses a fully valid query into every filter dimension", () => {
    const filters = parseSearchFilters({
      q: "nike shoes",
      category: "shoes",
      type: "preloved",
      condition: "good",
      min_price: "500",
      max_price: "2000",
      province: "3",
      city: "12",
      barangay: "45",
      fulfillment: "meetup",
      sort: "price_low",
    });

    expect(filters).toEqual({
      q: "nike shoes",
      categorySlug: "shoes",
      listingType: "preloved",
      condition: "good",
      minPriceCents: 50000,
      maxPriceCents: 200000,
      provinceId: 3,
      cityId: 12,
      barangayId: 45,
      fulfillment: "meetup",
      sort: "price_low",
    });
  });

  it("ignores an invalid enum value rather than crashing", () => {
    const filters = parseSearchFilters({ type: "used", condition: "mint", fulfillment: "drone" });
    expect(filters.listingType).toBeNull();
    expect(filters.condition).toBeNull();
    expect(filters.fulfillment).toBeNull();
  });

  it("ignores invalid numeric ids (non-numeric, zero, negative, decimal)", () => {
    expect(parseSearchFilters({ province: "abc" }).provinceId).toBeNull();
    expect(parseSearchFilters({ province: "0" }).provinceId).toBeNull();
    expect(parseSearchFilters({ province: "-3" }).provinceId).toBeNull();
    expect(parseSearchFilters({ province: "3.5" }).provinceId).toBeNull();
    expect(parseSearchFilters({ province: "12" }).provinceId).toBe(12);
  });

  it("ignores a negative price rather than passing it through", () => {
    expect(parseSearchFilters({ min_price: "-100" }).minPriceCents).toBeNull();
    expect(parseSearchFilters({ max_price: "-1" }).maxPriceCents).toBeNull();
  });

  it("drops the whole price filter when min exceeds max, instead of guessing intent", () => {
    const filters = parseSearchFilters({ min_price: "2000", max_price: "500" });
    expect(filters.minPriceCents).toBeNull();
    expect(filters.maxPriceCents).toBeNull();
  });

  it("normalizes brand_new + condition safely (condition never applies to Brand New)", () => {
    const filters = parseSearchFilters({ type: "brand_new", condition: "good" });
    expect(filters.listingType).toBe("brand_new");
    expect(filters.condition).toBeNull();
  });

  it("defaults to newest when no sort param is present", () => {
    expect(parseSearchFilters({}).sort).toBe("newest");
  });

  it("resets an invalid sort value to newest", () => {
    expect(parseSearchFilters({ sort: "most_popular" }).sort).toBe("newest");
  });

  it("treats a too-long search query as absent rather than sending it to the RPC", () => {
    const filters = parseSearchFilters({ q: "a".repeat(101) });
    expect(filters.q).toBeNull();
  });

  it("trims whitespace and treats a blank query as absent", () => {
    expect(parseSearchFilters({ q: "  shoes  " }).q).toBe("shoes");
    expect(parseSearchFilters({ q: "   " }).q).toBeNull();
  });
});

describe("toBrowseListingsArgs", () => {
  const baseFilters: ResolvedSearchFilters = {
    q: "shoes",
    categoryId: 4,
    listingType: "preloved",
    condition: "good",
    minPriceCents: 50000,
    maxPriceCents: 200000,
    provinceId: 3,
    cityId: 12,
    barangayId: 45,
    fulfillment: "meetup",
    sort: "newest",
  };

  it("maps q to p_search", () => {
    expect(toBrowseListingsArgs(baseFilters, 20).p_search).toBe("shoes");
  });

  it("maps category to p_category_id", () => {
    expect(toBrowseListingsArgs(baseFilters, 20).p_category_id).toBe(4);
  });

  it("maps listing type to p_listing_type", () => {
    expect(toBrowseListingsArgs(baseFilters, 20).p_listing_type).toBe("preloved");
  });

  it("maps condition to p_condition", () => {
    expect(toBrowseListingsArgs(baseFilters, 20).p_condition).toBe("good");
  });

  it("maps min/max price to p_min_price_cents/p_max_price_cents in cents", () => {
    const args = toBrowseListingsArgs(baseFilters, 20);
    expect(args.p_min_price_cents).toBe(50000);
    expect(args.p_max_price_cents).toBe(200000);
  });

  it("maps province/city/barangay to their p_*_id equivalents", () => {
    const args = toBrowseListingsArgs(baseFilters, 20);
    expect(args.p_province_id).toBe(3);
    expect(args.p_city_id).toBe(12);
    expect(args.p_barangay_id).toBe(45);
  });

  it("maps fulfillment to p_fulfillment_method", () => {
    expect(toBrowseListingsArgs(baseFilters, 20).p_fulfillment_method).toBe("meetup");
  });

  it("maps sort to p_sort", () => {
    expect(toBrowseListingsArgs({ ...baseFilters, sort: "price_high" }, 20).p_sort).toBe("price_high");
  });

  it("passes the given limit through as p_limit", () => {
    expect(toBrowseListingsArgs(baseFilters, 20).p_limit).toBe(20);
  });

  it("sends only the cursor pair relevant to the active sort mode", () => {
    const newestArgs = toBrowseListingsArgs(
      { ...baseFilters, sort: "newest" },
      20,
      { createdAt: "2026-01-01T00:00:00Z", priceCents: 999, id: "abc" },
    );
    expect(newestArgs.p_before_created_at).toBe("2026-01-01T00:00:00Z");
    expect(newestArgs.p_before_price_cents).toBeNull();
    expect(newestArgs.p_before_id).toBe("abc");

    const priceArgs = toBrowseListingsArgs(
      { ...baseFilters, sort: "price_low" },
      20,
      { createdAt: "2026-01-01T00:00:00Z", priceCents: 999, id: "abc" },
    );
    expect(priceArgs.p_before_created_at).toBeNull();
    expect(priceArgs.p_before_price_cents).toBe(999);
    expect(priceArgs.p_before_id).toBe("abc");
  });

  it("sends null cursor fields when no cursor is given (first page)", () => {
    const args = toBrowseListingsArgs(baseFilters, 20);
    expect(args.p_before_created_at).toBeNull();
    expect(args.p_before_price_cents).toBeNull();
    expect(args.p_before_id).toBeNull();
  });
});

describe("buildSearchHref", () => {
  const filters = parseSearchFilters({ category: "shoes", type: "preloved", sort: "price_low" });

  it("applies an update on top of the current filters", () => {
    expect(buildSearchHref(filters, { condition: "good" })).toBe(
      "/search?category=shoes&type=preloved&condition=good&sort=price_low",
    );
  });

  it("deletes a param when the update value is null", () => {
    expect(buildSearchHref(filters, { type: null })).toBe("/search?category=shoes&sort=price_low");
  });

  it("returns the bare /search path when no params remain", () => {
    expect(buildSearchHref(filters, { category: null, type: null, sort: null })).toBe("/search");
  });

  it("clears city and barangay when province changes", () => {
    const withLocation = parseSearchFilters({ province: "1", city: "2", barangay: "3" });
    const href = buildSearchHref(withLocation, { province: "9", city: null, barangay: null });
    expect(href).toBe("/search?province=9");
  });
});
