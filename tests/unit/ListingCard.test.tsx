import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingCard, type ListingCardData } from "@/components/marketplace/ListingCard";

const baseListing: ListingCardData = {
  id: "test-1",
  title: "Test Listing Title",
  priceCents: 150000,
  listingType: "preloved",
  condition: "good",
  locationLabel: "Tangub City",
  postedLabel: "2 hours ago",
  shopName: "Test Shop",
};

describe("ListingCard", () => {
  it("renders title, price, location, and shop name", () => {
    render(<ListingCard listing={baseListing} />);

    expect(screen.getByText("Test Listing Title")).toBeInTheDocument();
    expect(screen.getByText("₱1,500")).toBeInTheDocument();
    expect(screen.getByText(/Tangub City/)).toBeInTheDocument();
    expect(screen.getByText("Test Shop")).toBeInTheDocument();
  });

  it("shows 'Pre-loved · Good' for a pre-loved listing with condition", () => {
    render(<ListingCard listing={baseListing} />);
    expect(screen.getByText("Pre-loved · Good")).toBeInTheDocument();
  });

  it("shows only 'Brand New' without redundantly repeating condition", () => {
    render(
      <ListingCard
        listing={{ ...baseListing, listingType: "brand_new", condition: undefined }}
      />,
    );
    expect(screen.getByText("Brand New")).toBeInTheDocument();
    expect(screen.queryByText(/Brand New · Brand New/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Brand New · Good/)).not.toBeInTheDocument();
  });

  it("shows the original price struck through when higher than current price", () => {
    render(<ListingCard listing={{ ...baseListing, originalPriceCents: 200000 }} />);
    expect(screen.getByText("₱2,000")).toBeInTheDocument();
  });

  it("shows a Negotiable indicator when isNegotiable is true", () => {
    render(<ListingCard listing={{ ...baseListing, isNegotiable: true }} />);
    expect(screen.getByText("Negotiable")).toBeInTheDocument();
  });

  it("displays Free for a zero-cent listing instead of ₱0", () => {
    render(<ListingCard listing={{ ...baseListing, priceCents: 0 }} />);
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("shows a status badge when reserved or sold", () => {
    render(<ListingCard listing={{ ...baseListing, status: "reserved" }} />);
    expect(screen.getByText("Reserved")).toBeInTheDocument();
  });

  it("renders an accessible favorite button", () => {
    render(<ListingCard listing={baseListing} />);
    expect(screen.getByRole("button", { name: /favorite test listing title/i })).toBeInTheDocument();
  });
});
