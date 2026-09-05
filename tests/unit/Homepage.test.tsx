import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import type { BrowseSection, HomepageMarketplaceData } from "@/lib/marketplace/browse-listings";
import type { CategoryRef } from "@/lib/marketplace/reference-data";

const { getHomepageMarketplaceDataMock, getCategoriesMock } = vi.hoisted(() => ({
  getHomepageMarketplaceDataMock: vi.fn<() => Promise<HomepageMarketplaceData>>(),
  getCategoriesMock: vi.fn<() => Promise<CategoryRef[]>>(),
}));

vi.mock("@/lib/marketplace/browse-listings", () => ({
  getHomepageMarketplaceData: getHomepageMarketplaceDataMock,
}));

vi.mock("@/lib/marketplace/reference-data", () => ({
  getCategories: getCategoriesMock,
}));

import Home from "@/app/page";

const sampleCategories: CategoryRef[] = [
  { id: 1, slug: "women", name: "Women" },
  { id: 10, slug: "cars", name: "Cars" },
];

const emptySection: BrowseSection = { listings: [], hadError: false };
const errorSection: BrowseSection = { listings: [], hadError: true };

const sampleListing: ListingCardData = {
  id: "l1",
  href: "/item/sample-preloved-jacket",
  title: "Sample Pre-loved Jacket",
  priceCents: 50000,
  listingType: "preloved",
  condition: "good",
  locationLabel: "Tangub City",
  postedLabel: "2 hours ago",
  shopName: "Sample Shop",
};

function mockData(overrides: Partial<HomepageMarketplaceData>) {
  getHomepageMarketplaceDataMock.mockResolvedValue({
    freshFinds: emptySection,
    preLoved: emptySection,
    brandNew: emptySection,
    ...overrides,
  });
  getCategoriesMock.mockResolvedValue(sampleCategories);
}

describe("Homepage (real data)", () => {
  it("renders the compact hero copy", async () => {
    mockData({});
    render(await Home());
    expect(
      screen.getByRole("heading", { level: 1, name: /find something worth loving again/i }),
    ).toBeInTheDocument();
  });

  it("renders populated Fresh Finds listings from the mocked RPC data", async () => {
    mockData({ freshFinds: { listings: [sampleListing], hadError: false } });
    render(await Home());
    expect(screen.getByText("Sample Pre-loved Jacket")).toBeInTheDocument();
  });

  it("shows a Fresh Finds empty state when there are genuinely zero listings", async () => {
    mockData({});
    render(await Home());
    expect(screen.getByText(/no listings yet\. be the first to sell something\./i)).toBeInTheDocument();
  });

  it("omits Pre-loved and Brand New sections entirely when they have zero rows and no error", async () => {
    mockData({ freshFinds: { listings: [sampleListing], hadError: false } });
    render(await Home());
    expect(screen.queryByRole("heading", { name: "Pre-loved" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brand New" })).not.toBeInTheDocument();
  });

  it("shows Pre-loved and Brand New sections when populated", async () => {
    mockData({
      freshFinds: { listings: [sampleListing], hadError: false },
      preLoved: { listings: [sampleListing], hadError: false },
      brandNew: { listings: [sampleListing], hadError: false },
    });
    render(await Home());
    expect(screen.getByRole("heading", { name: "Pre-loved" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brand New" })).toBeInTheDocument();
  });

  it("shows an error fallback for Fresh Finds without crashing the rest of the page", async () => {
    mockData({ freshFinds: errorSection });
    render(await Home());
    expect(screen.getByText(/unable to load listings right now\./i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("still shows Pre-loved/Brand New with an error message rather than silently omitting them", async () => {
    mockData({ preLoved: errorSection, brandNew: errorSection });
    render(await Home());
    expect(screen.getByRole("heading", { name: "Pre-loved" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brand New" })).toBeInTheDocument();
    expect(screen.getAllByText(/unable to load listings right now\./i)).toHaveLength(2);
  });

  it("does not render a Popular Shops section", async () => {
    mockData({});
    render(await Home());
    expect(screen.queryByText(/popular shops/i)).not.toBeInTheDocument();
  });

  it("renders the category strip regardless of listing data", async () => {
    mockData({});
    render(await Home());
    expect(screen.getByRole("link", { name: "Women" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cars" })).toBeInTheDocument();
  });

  it("renders the trust strip signals", async () => {
    mockData({});
    render(await Home());
    expect(screen.getByText("Meet safely")).toBeInTheDocument();
    expect(screen.getByText("Trusted sellers")).toBeInTheDocument();
    expect(screen.getByText("Verified reviews")).toBeInTheDocument();
  });

  it("wires the Hero and each section's View all link to /search with the right filter", async () => {
    mockData({
      freshFinds: { listings: [sampleListing], hadError: false },
      preLoved: { listings: [sampleListing], hadError: false },
      brandNew: { listings: [sampleListing], hadError: false },
    });
    render(await Home());

    expect(screen.getByRole("link", { name: "Browse Items" })).toHaveAttribute("href", "/search");

    // Fresh Finds, Pre-loved, Brand New -- in page order.
    const viewAllLinks = screen.getAllByRole("link", { name: /view all/i });
    expect(viewAllLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/search?sort=newest",
      "/search?type=preloved",
      "/search?type=brand_new",
    ]);
  });
});
