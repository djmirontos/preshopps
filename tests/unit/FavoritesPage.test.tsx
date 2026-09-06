import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import type { GetMyFavoritesResult } from "@/lib/favorites/get-my-favorites";

const { getAuthUserMock, getMyFavoritesMock, redirectMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyFavoritesMock: vi.fn<() => Promise<GetMyFavoritesResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/favorites/get-my-favorites", () => ({
  getMyFavorites: getMyFavoritesMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import FavoritesPage from "@/app/favorites/page";

const sampleListing: ListingCardData = {
  id: "listing-1",
  href: "/item/PSO-ABC",
  title: "Uniqlo Airism T-Shirt",
  priceCents: 45000,
  locationLabel: "Cebu City",
  shopName: "Anne's Closet",
};

describe("FavoritesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with next=/favorites before fetching any favorite data", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(FavoritesPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Ffavorites");
    expect(getMyFavoritesMock).not.toHaveBeenCalled();
  });

  it("shows the empty state for an authenticated user with no favorites", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyFavoritesMock.mockResolvedValue({ listings: [], hadError: false, nextCursor: null });

    render(await FavoritesPage());

    expect(screen.getByText("No favorites yet.")).toBeInTheDocument();
    expect(screen.getByText("Items you save will appear here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse listings/i })).toHaveAttribute("href", "/search");
  });

  it("renders the user's favorited listings as real listing cards", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyFavoritesMock.mockResolvedValue({ listings: [sampleListing], hadError: false, nextCursor: null });

    render(await FavoritesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Favorites" })).toBeInTheDocument();
    expect(screen.getByText("Uniqlo Airism T-Shirt")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /uniqlo airism t-shirt/i })).toHaveAttribute(
      "href",
      "/item/PSO-ABC",
    );
  });

  it("shows a safe error state (not a crash) when the RPC fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyFavoritesMock.mockResolvedValue({ listings: [], hadError: true, nextCursor: null });

    render(await FavoritesPage());
    expect(screen.getByText(/unable to load your favorites right now/i)).toBeInTheDocument();
  });
});
