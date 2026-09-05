import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import type { CategoryRef, LocationContext, LocationRef } from "@/lib/marketplace/reference-data";
import type { SearchListingsResult } from "@/lib/marketplace/search-listings";
import type { BrowseCursor, ResolvedSearchFilters } from "@/lib/marketplace/search-params";

const {
  getCategoriesMock,
  getProvincesMock,
  getCitiesForProvinceMock,
  getBarangaysForCityMock,
  resolveLocationContextMock,
  searchListingsMock,
} = vi.hoisted(() => ({
  getCategoriesMock: vi.fn<() => Promise<CategoryRef[]>>(),
  getProvincesMock: vi.fn<() => Promise<LocationRef[]>>(),
  getCitiesForProvinceMock: vi.fn<() => Promise<LocationRef[]>>(),
  getBarangaysForCityMock: vi.fn<() => Promise<LocationRef[]>>(),
  resolveLocationContextMock: vi.fn<(f: LocationContext) => Promise<LocationContext>>(),
  searchListingsMock: vi.fn<
    (filters: ResolvedSearchFilters, limit: number, cursor?: BrowseCursor) => Promise<SearchListingsResult>
  >(),
}));

vi.mock("@/lib/marketplace/reference-data", () => ({
  getCategories: getCategoriesMock,
  getProvinces: getProvincesMock,
  getCitiesForProvince: getCitiesForProvinceMock,
  getBarangaysForCity: getBarangaysForCityMock,
  resolveLocationContext: resolveLocationContextMock,
}));

vi.mock("@/lib/marketplace/search-listings", () => ({
  searchListings: searchListingsMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import SearchPage from "@/app/search/page";

const sampleCategories: CategoryRef[] = [
  { id: 1, slug: "women", name: "Women" },
  { id: 10, slug: "cars", name: "Cars" },
];

const sampleProvinces: LocationRef[] = [{ id: 3, name: "Misamis Occidental" }];

const sampleListing: ListingCardData = {
  id: "l1",
  href: "/item/sample-item",
  title: "Sample Item",
  priceCents: 50000,
  listingType: "preloved",
  condition: "good",
  locationLabel: "Tangub City",
  shopName: "Sample Shop",
};

function mockReferenceData() {
  getCategoriesMock.mockResolvedValue(sampleCategories);
  getProvincesMock.mockResolvedValue(sampleProvinces);
  getCitiesForProvinceMock.mockResolvedValue([]);
  getBarangaysForCityMock.mockResolvedValue([]);
  resolveLocationContextMock.mockImplementation(async (f: LocationContext) => f);
}

async function renderSearchPage(rawParams: Record<string, string | string[] | undefined>) {
  const ui = await SearchPage({ searchParams: Promise.resolve(rawParams) });
  return render(ui);
}

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders populated results from browse_listings", async () => {
    mockReferenceData();
    searchListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    await renderSearchPage({});
    expect(screen.getByText("Sample Item")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Marketplace" })).toBeInTheDocument();
  });

  it("shows the empty state when there are zero results and no error", async () => {
    mockReferenceData();
    searchListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    await renderSearchPage({ q: "nonexistent" });
    expect(screen.getByText("No listings match your filters.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /search results for "nonexistent"/i })).toBeInTheDocument();
  });

  it("shows the RPC error fallback rather than a fake empty/success state", async () => {
    mockReferenceData();
    searchListingsMock.mockResolvedValue({ listings: [], hadError: true, nextCursor: null });

    await renderSearchPage({});
    expect(screen.getByText("Unable to load listings right now.")).toBeInTheDocument();
    expect(screen.queryByText("No listings match your filters.")).not.toBeInTheDocument();
  });

  it("renders active filter chips reflecting the URL and lets each be individually removed", async () => {
    mockReferenceData();
    searchListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    await renderSearchPage({ category: "women", type: "preloved", min_price: "500", max_price: "2000" });

    expect(screen.getByRole("link", { name: "Women" })).toHaveAttribute(
      "href",
      "/search?type=preloved&min_price=500&max_price=2000",
    );
    expect(screen.getByRole("link", { name: "Pre-loved" })).toHaveAttribute(
      "href",
      "/search?category=women&min_price=500&max_price=2000",
    );
    expect(screen.getByRole("link", { name: "₱500–₱2,000" })).toHaveAttribute(
      "href",
      "/search?category=women&type=preloved",
    );
    expect(screen.getByRole("link", { name: /clear all/i })).toBeInTheDocument();
  });

  it("clear all removes every filter but keeps the search query", async () => {
    mockReferenceData();
    searchListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    await renderSearchPage({ q: "shoes", category: "women", type: "preloved" });

    const clearAllLinks = screen.getAllByRole("link", { name: /clear all/i });
    for (const link of clearAllLinks) {
      expect(link).toHaveAttribute("href", "/search?q=shoes");
    }
  });

  it("never renders a fabricated result count", async () => {
    mockReferenceData();
    searchListingsMock.mockResolvedValue({
      listings: [sampleListing, { ...sampleListing, id: "l2" }],
      hadError: false,
      nextCursor: null,
    });

    await renderSearchPage({});
    expect(screen.queryByText(/\d+\s+results?/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^results$/i)).not.toBeInTheDocument();
  });

  it("only ever calls browse_listings through searchListings -- never a raw table query", async () => {
    mockReferenceData();
    searchListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    await renderSearchPage({ category: "women" });
    expect(searchListingsMock).toHaveBeenCalledTimes(1);
    const [filtersArg] = searchListingsMock.mock.calls[0];
    expect(filtersArg).toMatchObject({ categoryId: 1 });
  });
});
