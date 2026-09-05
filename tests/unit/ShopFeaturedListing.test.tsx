import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import { ShopFeaturedListing } from "@/components/shop/ShopFeaturedListing";

const listing: ListingCardData = {
  id: "l1",
  href: "/item/PLS-ABC123",
  title: "Featured Item",
  priceCents: 50000,
  listingType: "preloved",
  condition: "good",
  locationLabel: "Tangub City",
  shopName: "Anne's Closet",
};

describe("ShopFeaturedListing", () => {
  it("renders the featured listing under a Featured heading", () => {
    render(<ShopFeaturedListing listing={listing} />);
    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByText("Featured Item")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/item/PLS-ABC123");
  });
});
