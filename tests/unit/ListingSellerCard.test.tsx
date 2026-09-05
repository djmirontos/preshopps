import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingSellerCard } from "@/components/listing/ListingSellerCard";

const baseProps = {
  slug: "annes-closet",
  name: "Anne's Closet",
  logoUrl: undefined,
  locationLabel: "Tangub City, Misamis Occidental",
  isTrustedSeller: false,
  memberSinceLabel: "January 2025",
  messengerLink: null,
  reviewCount: 0,
  averageRating: null,
};

describe("ListingSellerCard", () => {
  it("shows the shop name", () => {
    render(<ListingSellerCard {...baseProps} />);
    expect(screen.getByText("Anne's Closet")).toBeInTheDocument();
  });

  it("links the shop name to the canonical /shop/{slug} route", () => {
    render(<ListingSellerCard {...baseProps} />);
    expect(screen.getByRole("link", { name: /anne's closet/i })).toHaveAttribute(
      "href",
      "/shop/annes-closet",
    );
  });

  it("shows the Trusted Seller badge only when true", () => {
    render(<ListingSellerCard {...baseProps} isTrustedSeller />);
    expect(screen.getByText("Trusted Seller")).toBeInTheDocument();
  });

  it("does not show the Trusted Seller badge when false", () => {
    render(<ListingSellerCard {...baseProps} isTrustedSeller={false} />);
    expect(screen.queryByText("Trusted Seller")).not.toBeInTheDocument();
  });

  it("shows No reviews yet when there are none", () => {
    render(<ListingSellerCard {...baseProps} />);
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
  });

  it("shows the rating and review count when reviews exist", () => {
    render(<ListingSellerCard {...baseProps} reviewCount={12} averageRating={4.6} />);
    expect(screen.getByText(/4\.6/)).toBeInTheDocument();
    expect(screen.getByText(/12 reviews/)).toBeInTheDocument();
  });

  it("shows a Contact on Messenger link only when a messenger link is returned", () => {
    render(<ListingSellerCard {...baseProps} messengerLink="https://m.me/annescloset" />);
    const link = screen.getByRole("link", { name: /contact on messenger/i });
    expect(link).toHaveAttribute("href", "https://m.me/annescloset");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("omits the Messenger link entirely when none is returned", () => {
    render(<ListingSellerCard {...baseProps} messengerLink={null} />);
    expect(screen.queryByRole("link", { name: /messenger/i })).not.toBeInTheDocument();
  });
});
