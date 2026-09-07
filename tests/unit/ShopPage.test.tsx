import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import type { ShopDetail, ShopDetailResult } from "@/lib/marketplace/shop-detail";
import type { ShopListingsResult } from "@/lib/marketplace/shop-listings";
import type { GetShopReviewsResult } from "@/lib/reviews/get-shop-reviews";
import type { AuthUser } from "@/lib/auth/session";
import type { MyShop } from "@/lib/seller/get-my-shop";

const { getShopDetailMock, getShopListingsMock, getShopReviewsMock, notFoundMock, permanentRedirectMock, getAuthUserMock, getMyShopMock } = vi.hoisted(() => ({
  getShopDetailMock: vi.fn<(slug: string) => Promise<ShopDetailResult>>(),
  getShopListingsMock: vi.fn<() => Promise<ShopListingsResult>>(),
  getShopReviewsMock: vi.fn<() => Promise<GetShopReviewsResult>>(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyShopMock: vi.fn<() => Promise<MyShop | null>>(),
}));

vi.mock("@/lib/marketplace/shop-detail", () => ({
  getShopDetail: getShopDetailMock,
}));

vi.mock("@/lib/marketplace/shop-listings", () => ({
  getShopListings: getShopListingsMock,
}));

vi.mock("@/lib/reviews/get-shop-reviews", () => ({
  getShopReviews: getShopReviewsMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/seller/get-my-shop", () => ({
  getMyShop: getMyShopMock,
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  permanentRedirect: permanentRedirectMock,
  useRouter: () => ({ push: vi.fn() }),
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
    getAuthUserMock.mockResolvedValue(null);
    getMyShopMock.mockResolvedValue(null);
    getShopReviewsMock.mockResolvedValue({ reviews: [], hadError: false, nextCursor: null });
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

  it("does not repeat the featured listing a second time in the normal grid on the first page", async () => {
    const secondListing: ListingCardData = {
      id: "listing-2",
      href: "/item/PLS-XYZ789",
      title: "Second Item",
      priceCents: 75000,
      listingType: "preloved",
      condition: "very_good",
      locationLabel: "Tangub City",
      shopName: "Anne's Closet",
    };

    getShopDetailMock.mockResolvedValue({
      status: "found",
      shop: { ...sampleShop, featuredListingId: "listing-1" },
      isCurrentSlug: true,
    });
    getShopListingsMock.mockResolvedValue({
      listings: [sampleListing, secondListing],
      hadError: false,
      nextCursor: { createdAt: "2026-01-01T00:00:00Z", id: "listing-2" },
    });

    render(await ShopPage(makeParams("annes-closet")));

    // The featured listing's title appears exactly once (in Featured),
    // not a second time in the Listings grid directly below it.
    expect(screen.getAllByText("Sample Item")).toHaveLength(1);
    expect(screen.getByText("Second Item")).toBeInTheDocument();
    // Load More is still offered, driven by the real backend cursor --
    // proves the presentation-only filter didn't touch pagination.
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  it("requests the normal, unfiltered first page from the backend -- the exclusion never reaches the RPC call", async () => {
    getShopDetailMock.mockResolvedValue({
      status: "found",
      shop: { ...sampleShop, featuredListingId: "listing-1" },
      isCurrentSlug: true,
    });
    getShopListingsMock.mockResolvedValue({
      listings: [sampleListing],
      hadError: false,
      nextCursor: null,
    });

    render(await ShopPage(makeParams("annes-closet")));

    // getShopListings is called exactly as it always was (shop id + the
    // plain page limit) -- the featured-id exclusion is applied only to
    // the array handed to the grid afterward, never to the request.
    expect(getShopListingsMock).toHaveBeenCalledWith("shop-1", 20);
    // With only the featured listing on this page and no further cursor,
    // the grid has nothing left to show -- an honest empty message,
    // not a fabricated one.
    expect(screen.getByText("No listings available right now.")).toBeInTheDocument();
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

  it("shows a Message Seller action for a guest viewing the shop", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    render(await ShopPage(makeParams("annes-closet")));
    expect(screen.getByRole("button", { name: "Message Seller" })).toBeInTheDocument();
  });

  it("shows a Message Seller action for an authenticated non-owner", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });
    getAuthUserMock.mockResolvedValue({ id: "buyer-1", email: "buyer@example.com" });
    getMyShopMock.mockResolvedValue(null);

    render(await ShopPage(makeParams("annes-closet")));
    expect(screen.getByRole("button", { name: "Message Seller" })).toBeInTheDocument();
  });

  it("hides the Message Seller action for the shop's own owner", async () => {
    getShopDetailMock.mockResolvedValue({ status: "found", shop: sampleShop, isCurrentSlug: true });
    getShopListingsMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });
    getAuthUserMock.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });

    render(await ShopPage(makeParams("annes-closet")));
    expect(screen.queryByRole("button", { name: "Message Seller" })).not.toBeInTheDocument();
  });
});
