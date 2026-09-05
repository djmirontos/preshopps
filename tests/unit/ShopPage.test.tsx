import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import type { ShopDetail, ShopDetailResult } from "@/lib/marketplace/shop-detail";
import type { ShopListingsResult } from "@/lib/marketplace/shop-listings";

const { getShopDetailMock, getShopListingsMock, notFoundMock, permanentRedirectMock } = vi.hoisted(() => ({
  getShopDetailMock: vi.fn<(slug: string) => Promise<ShopDetailResult>>(),
  getShopListingsMock: vi.fn<() => Promise<ShopListingsResult>>(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/marketplace/shop-detail", () => ({
  getShopDetail: getShopDetailMock,
}));

vi.mock("@/lib/marketplace/shop-listings", () => ({
  getShopListings: getShopListingsMock,
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  permanentRedirect: permanentRedirectMock,
}));

import ShopPage, { generateMetadata } from "@/app/shop/[slug]/page";

const sampleShop: ShopDetail = {
  id: "shop-1",
  slug: "annes-closet",
  name: "Anne's Closet",
  description: "Quality pre-loved finds.",
  logoUrl: undefined,
  messengerLink: null,
  status: "active",
  isTrustedSeller: true,
  memberSinceLabel: "January 2025",
  locationLabel: "Tangub City, Misamis Occidental",
  reviewCount: 12,
  averageRating: 4.7,
  completedOrderCount: 27,
  activeListingCount: 8,
  featuredListingId: null,
};

const sampleListing: ListingCardData = {
  id: "listing-1",
  href: "/item/PLS-ABC123",
  title: "Sample Item",
  priceCents: 50000,
  listingType: "preloved",
  condition: "good",
  locationLabel: "Tangub City",
  shopName: "Anne's Closet",
};

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("ShopPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the shop when found, with populated listings", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    render(await ShopPage(makeParams("annes-closet")));

    expect(screen.getByRole("heading", { level: 1, name: "Anne's Closet" })).toBeInTheDocument();
    expect(screen.getByText("Sample Item")).toBeInTheDocument();
    expect(getShopListingsMock).toHaveBeenCalledWith("shop-1", 20);
  });

  it("shows the empty state without 404-ing a valid shop with zero listings", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await ShopPage(makeParams("annes-closet")));

    expect(screen.getByRole("heading", { level: 1, name: "Anne's Closet" })).toBeInTheDocument();
    expect(screen.getByText("No listings available right now.")).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a nonexistent/hidden shop, indistinguishable from any other hidden case", async () => {
    getShopDetailMock.mockResolvedValue({ status: "not_found" });
    await expect(ShopPage(makeParams("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders a safe error state (not a false 404) when the RPC genuinely fails", async () => {
    getShopDetailMock.mockResolvedValue({ status: "error" });
    render(await ShopPage(makeParams("annes-closet")));
    expect(screen.getByText("Unable to load this shop right now.")).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("permanently redirects an old slug to the canonical current slug, without fetching listings", async () => {
    getShopDetailMock.mockResolvedValue({
      status: "found",
      shop: sampleShop,
      isCurrentSlug: false,
    });

    await expect(ShopPage(makeParams("old-shop-name"))).rejects.toThrow("NEXT_REDIRECT:/shop/annes-closet");
    expect(permanentRedirectMock).toHaveBeenCalledWith("/shop/annes-closet");
    expect(getShopListingsMock).not.toHaveBeenCalled();
  });

  it("does not redirect when the requested slug is already canonical", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    render(await ShopPage(makeParams("annes-closet")));
    expect(permanentRedirectMock).not.toHaveBeenCalled();
  });

  it("shows the Featured section when the featured listing is found on the fetched page", async () => {
    getShopDetailMock.mockResolvedValue({
      status: "found",
      shop: { ...sampleShop, featuredListingId: "listing-1" },
      isCurrentSlug: true,
    });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    render(await ShopPage(makeParams("annes-closet")));
    expect(screen.getByText("Featured")).toBeInTheDocument();
  });

  it("omits the Featured section when no featured id is set", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    render(await ShopPage(makeParams("annes-closet")));
    expect(screen.queryByText("Featured")).not.toBeInTheDocument();
  });

  it("omits the Featured section when the featured listing isn't on the fetched page (never fakes one)", async () => {
    getShopDetailMock.mockResolvedValue({
      status: "found",
      shop: { ...sampleShop, featuredListingId: "some-other-listing-id" },
      isCurrentSlug: true,
    });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    render(await ShopPage(makeParams("annes-closet")));
    expect(screen.queryByText("Featured")).not.toBeInTheDocument();
  });

  it("produces a dynamic <title> from the shop name", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    const metadata = await generateMetadata(makeParams("annes-closet"));
    expect(metadata.title).toBe("Anne's Closet | Preshopps");
  });

  it("falls back to generic metadata without leaking anything when not found", async () => {
    getShopDetailMock.mockResolvedValue({ status: "not_found" });
    const metadata = await generateMetadata(makeParams("missing"));
    expect(metadata.title).toBe("Shop | Preshopps");
  });

  it("never renders private fields such as a raw owner id", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    const { container } = render(await ShopPage(makeParams("annes-closet")));
    expect(container.innerHTML).not.toMatch(/owner_id/i);
  });
});
