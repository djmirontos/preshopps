import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShopHeader } from "@/components/shop/ShopHeader";

const baseProps = {
  name: "Anne's Closet",
  logoUrl: undefined,
  locationLabel: "Tangub City, Misamis Occidental",
  status: "active" as const,
  isTrustedSeller: false,
  memberSinceLabel: "January 2025",
  messengerLink: null,
  reviewCount: 0,
  averageRating: null,
  completedOrderCount: 0,
  activeListingCount: 0,
};

describe("ShopHeader", () => {
  it("renders the shop name as the page h1", () => {
    render(<ShopHeader {...baseProps} />);
    expect(screen.getByRole("heading", { level: 1, name: "Anne's Closet" })).toBeInTheDocument();
  });

  it("shows the location", () => {
    render(<ShopHeader {...baseProps} />);
    expect(screen.getByText("Tangub City, Misamis Occidental")).toBeInTheDocument();
  });

  it("shows an Away badge only when status is away", () => {
    render(<ShopHeader {...baseProps} status="away" />);
    expect(screen.getByText("Away")).toBeInTheDocument();
  });

  it("does not show an Away badge for an active shop", () => {
    render(<ShopHeader {...baseProps} status="active" />);
    expect(screen.queryByText("Away")).not.toBeInTheDocument();
  });

  it("shows the Trusted Seller badge only when true", () => {
    render(<ShopHeader {...baseProps} isTrustedSeller />);
    expect(screen.getByText("Trusted Seller")).toBeInTheDocument();
  });

  it("does not show the Trusted Seller badge when false", () => {
    render(<ShopHeader {...baseProps} isTrustedSeller={false} />);
    expect(screen.queryByText("Trusted Seller")).not.toBeInTheDocument();
  });

  it("shows member since", () => {
    render(<ShopHeader {...baseProps} />);
    expect(screen.getByText("Member since January 2025")).toBeInTheDocument();
  });

  it("shows the rating and review count when reviews exist", () => {
    render(<ShopHeader {...baseProps} reviewCount={27} averageRating={4.8} />);
    expect(screen.getByText("4.8")).toBeInTheDocument();
    expect(screen.getByText("27 reviews")).toBeInTheDocument();
  });

  it("shows No reviews yet, never a fake 0.0, when there are none", () => {
    render(<ShopHeader {...baseProps} reviewCount={0} averageRating={null} />);
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
  });

  it("shows the completed order count", () => {
    render(<ShopHeader {...baseProps} completedOrderCount={27} />);
    expect(screen.getByText("27")).toBeInTheDocument();
    expect(screen.getByText("Completed orders")).toBeInTheDocument();
  });

  it("shows the active listing count", () => {
    render(<ShopHeader {...baseProps} activeListingCount={8} />);
    expect(screen.getByText("Active listings")).toBeInTheDocument();
  });

  it("shows a Contact on Messenger link only when a messenger link is returned, with safe target/rel", () => {
    render(<ShopHeader {...baseProps} messengerLink="https://m.me/annescloset" />);
    const link = screen.getByRole("link", { name: /contact on messenger/i });
    expect(link).toHaveAttribute("href", "https://m.me/annescloset");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("omits the Messenger link entirely when none is returned", () => {
    render(<ShopHeader {...baseProps} messengerLink={null} />);
    expect(screen.queryByRole("link", { name: /messenger/i })).not.toBeInTheDocument();
  });
});
