import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";

const { getAuthUserMock, redirectMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import SellListingEditPlaceholderPage from "@/app/sell/[listingId]/edit/page";

describe("SellListingEditPlaceholderPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with the listing-specific next path", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(SellListingEditPlaceholderPage({ params: Promise.resolve({ listingId: "listing-1" }) })).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fsell%2Flisting-1%2Fedit",
    );
  });

  it("shows a generic confirmation for an authenticated seller, regardless of listing id", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });

    render(await SellListingEditPlaceholderPage({ params: Promise.resolve({ listingId: "any-id-at-all" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Draft saved" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Account" })).toHaveAttribute("href", "/account");
  });

  it("never reads listing data -- no title, price, or other listing-specific content is rendered", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });

    render(await SellListingEditPlaceholderPage({ params: Promise.resolve({ listingId: "listing-1" }) }));

    expect(screen.queryByText("listing-1")).not.toBeInTheDocument();
  });

  it("exactly one h1 renders on the page", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });

    render(await SellListingEditPlaceholderPage({ params: Promise.resolve({ listingId: "listing-1" }) }));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
