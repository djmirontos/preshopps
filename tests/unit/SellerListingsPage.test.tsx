import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { MyShop } from "@/lib/seller/get-my-shop";
import type { MyShopListingSummary, GetMyShopListingsResult } from "@/lib/seller/get-my-shop-listings";
import type { CategoryRef } from "@/lib/marketplace/reference-data";

const { getAuthUserMock, getMyShopMock, getMyShopListingsMock, getCategoriesMock, redirectMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyShopMock: vi.fn<() => Promise<MyShop | null>>(),
  getMyShopListingsMock: vi.fn<() => Promise<GetMyShopListingsResult>>(),
  getCategoriesMock: vi.fn<() => Promise<CategoryRef[]>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/seller/get-my-shop", () => ({
  getMyShop: getMyShopMock,
}));

vi.mock("@/lib/seller/get-my-shop-listings", () => ({
  getMyShopListings: getMyShopListingsMock,
}));

vi.mock("@/lib/marketplace/reference-data", () => ({
  getCategories: getCategoriesMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn() }),
}));

import SellerListingsPage from "@/app/seller/listings/page";

function makeListing(overrides: Partial<MyShopListingSummary> = {}): MyShopListingSummary {
  return {
    listingId: "listing-1",
    publicCode: "PSL-ABC123",
    slug: "nike-air-max-270",
    title: "Nike Air Max 270",
    status: "available",
    priceCents: 199900,
    stockQuantity: 3,
    reservedQuantity: 0,
    availableQuantity: 3,
    coverImagePath: null,
    categoryId: null,
    listingType: "preloved",
    condition: "good",
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    publishedAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

function params(searchParams: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(searchParams) };
}

describe("SellerListingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCategoriesMock.mockResolvedValue([]);
  });

  it("redirects a guest to sign-in with next=/seller/listings before checking for a shop or fetching listings", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(SellerListingsPage(params())).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fseller%2Flistings");
    expect(getMyShopMock).not.toHaveBeenCalled();
    expect(getMyShopListingsMock).not.toHaveBeenCalled();
  });

  it("shows a simple explanatory state (not an error) for an authenticated user with no shop", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue(null);

    render(await SellerListingsPage(params()));

    expect(screen.getByText(/don't have a shop yet/i)).toBeInTheDocument();
    expect(getMyShopListingsMock).not.toHaveBeenCalled();
  });

  it("defaults to the All tab (null status) with no query param", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await SellerListingsPage(params()));

    expect(getMyShopListingsMock).toHaveBeenCalledWith(20, null);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  });

  it("passes a valid status query param through to get_my_shop_listings and marks the matching tab active", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await SellerListingsPage(params({ status: "paused" })));

    expect(getMyShopListingsMock).toHaveBeenCalledWith(20, "paused");
    expect(screen.getByRole("link", { name: "Paused" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
  });

  it("falls back to All (null) for an invalid/unrecognized status query param, rather than crashing", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await SellerListingsPage(params({ status: "not-a-real-status" })));

    expect(getMyShopListingsMock).toHaveBeenCalledWith(20, null);
  });

  it("renders every status tab, including Reserved and Archived", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await SellerListingsPage(params()));

    for (const label of ["All", "Draft", "Available", "Reserved", "Paused", "Sold", "Archived"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("renders one h1 and the shop's own listings", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({
      listings: [makeListing({ title: "Nike Air Max 270" })],
      hadError: false,
      nextCursor: null,
    });

    render(await SellerListingsPage(params()));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "My Listings" })).toBeInTheDocument();
    expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument();
  });

  it("shows the empty state for a shop owner with no listings yet", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await SellerListingsPage(params()));

    expect(screen.getByText("No listings yet.")).toBeInTheDocument();
  });

  it("shows a safe error state (not a crash) when the RPC fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({ listings: [], hadError: true, nextCursor: null });

    render(await SellerListingsPage(params()));
    expect(screen.getByText(/unable to load your listings right now/i)).toBeInTheDocument();
  });

  it("renders a Sell shortcut link to /sell", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopListingsMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await SellerListingsPage(params()));
    expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/sell");
  });
});
