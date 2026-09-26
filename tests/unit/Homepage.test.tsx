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

// The homepage now mounts SignedOutNotice (components/auth/SignedOutNotice.tsx)
// for the post-sign-out confirmation, which needs a router context Next's
// real navigation hooks don't have outside the actual app router. None of
// these tests exercise that marker, so the default "no signedOut param"
// case (see SignedOutNotice.test.tsx for its own dedicated coverage) is
// all that's needed here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => ({ get: () => null }),
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

  it("wires each section's View all link to /search with the right filter", async () => {
    mockData({
      freshFinds: { listings: [sampleListing], hadError: false },
      preLoved: { listings: [sampleListing], hadError: false },
      brandNew: { listings: [sampleListing], hadError: false },
    });
    render(await Home());

    // Fresh Finds, Pre-loved, Brand New -- in page order.
    const viewAllLinks = screen.getAllByRole("link", { name: /view all/i });
    expect(viewAllLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/search?sort=newest",
      "/search?type=preloved",
      "/search?type=brand_new",
    ]);
  });
});

function buildListings(count: number, titlePrefix: string): ListingCardData[] {
  return Array.from({ length: count }, (_, index) => ({
    ...sampleListing,
    id: `${titlePrefix}-${index}`,
    href: `/item/${titlePrefix}-${index}`,
    title: `${titlePrefix} ${index}`,
  }));
}

/** ListingGrid's actual outer grid element, found by walking up from a
 * card's own title text until an ancestor's className literally contains
 * "grid-cols-2" -- explicit about which of the several nested wrapper divs
 * (ListingCard's own root, ListingGrid's per-child `[&>div]:!w-full`
 * wrapper, then finally the grid itself) is actually being asserted on,
 * rather than a fixed, easy-to-miscount number of .parentElement hops. */
function findGridContainer(titleText: string): HTMLElement {
  let el: HTMLElement | null = screen.getByText(titleText);
  while (el && !el.className.includes("grid-cols-2")) {
    el = el.parentElement;
  }
  if (!el) throw new Error(`No ancestor of "${titleText}" has a grid-cols-2 class`);
  return el;
}

describe("Homepage -- mobile 2-column listing grid (no horizontal rail)", () => {
  it("wraps Fresh Finds in a plain 2-column CSS grid, not a horizontal scroll-snap rail", async () => {
    mockData({ freshFinds: { listings: buildListings(4, "Fresh"), hadError: false } });
    render(await Home());

    const gridWrapper = findGridContainer("Fresh 0");
    expect(gridWrapper.className).toContain("grid");
    expect(gridWrapper.className).toContain("grid-cols-2");
    // Never a horizontal-scroll rail: no overflow-x, no scroll-snap.
    expect(gridWrapper.className).not.toContain("overflow-x-auto");
    expect(gridWrapper.className).not.toContain("snap-x");
  });

  it("renders every listing returned for a section, not clipped to what fits one row -- proving vertical access via subsequent rows, not horizontal scroll", async () => {
    mockData({ freshFinds: { listings: buildListings(10, "Fresh"), hadError: false } });
    render(await Home());

    for (let i = 0; i < 10; i++) {
      expect(screen.getByText(`Fresh ${i}`)).toBeInTheDocument();
    }
  });

  it("renders every Pre-loved and Brand New listing too, using the same grid wrapper", async () => {
    mockData({
      freshFinds: { listings: [sampleListing], hadError: false },
      preLoved: { listings: buildListings(5, "Preloved"), hadError: false },
      brandNew: { listings: buildListings(5, "New"), hadError: false },
    });
    render(await Home());

    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`Preloved ${i}`)).toBeInTheDocument();
      expect(screen.getByText(`New ${i}`)).toBeInTheDocument();
    }

    const prelovedGrid = findGridContainer("Preloved 0");
    expect(prelovedGrid.className).toContain("grid-cols-2");
  });

  it("keeps the existing desktop grid breakpoints unchanged (lg:4 columns, xl:5 columns)", async () => {
    mockData({ freshFinds: { listings: buildListings(4, "Fresh"), hadError: false } });
    render(await Home());

    const gridWrapper = findGridContainer("Fresh 0");
    expect(gridWrapper.className).toContain("lg:grid-cols-4");
    expect(gridWrapper.className).toContain("xl:grid-cols-5");
  });
});
