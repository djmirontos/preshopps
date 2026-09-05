import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingHeader } from "@/components/listing/ListingHeader";

const baseProps = {
  title: "Test Listing",
  listingType: "preloved" as const,
  condition: "good" as const,
  priceCents: 10000,
  originalPriceCents: undefined,
  isNegotiable: false,
  status: "available" as const,
  locationLabel: "Tangub City, Misamis Occidental",
  availableQuantity: 1,
};

describe("ListingHeader", () => {
  it("shows Pre-loved with its condition label", () => {
    render(<ListingHeader {...baseProps} />);
    expect(screen.getByText("Pre-loved · Good")).toBeInTheDocument();
  });

  it("shows only Brand New without duplicating condition", () => {
    render(<ListingHeader {...baseProps} listingType="brand_new" condition={undefined} />);
    expect(screen.getByText("Brand New")).toBeInTheDocument();
    expect(screen.queryByText(/Brand New · Brand New/)).not.toBeInTheDocument();
  });

  it("renders a normal PHP price", () => {
    render(<ListingHeader {...baseProps} priceCents={150000} />);
    expect(screen.getByText("₱1,500")).toBeInTheDocument();
  });

  it("renders Free for a zero-cent listing", () => {
    render(<ListingHeader {...baseProps} priceCents={0} />);
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("shows the original price struck through when it's greater than the current price", () => {
    render(<ListingHeader {...baseProps} priceCents={100000} originalPriceCents={150000} />);
    expect(screen.getByText("₱1,000")).toBeInTheDocument();
    expect(screen.getByText("₱1,500")).toBeInTheDocument();
  });

  it("does not show an original price when it isn't greater than the current price", () => {
    render(<ListingHeader {...baseProps} priceCents={100000} originalPriceCents={100000} />);
    expect(screen.queryAllByText("₱1,000")).toHaveLength(1);
  });

  it("shows a subtle Negotiable label", () => {
    render(<ListingHeader {...baseProps} isNegotiable />);
    expect(screen.getByText("Negotiable")).toBeInTheDocument();
  });

  it("renders the h1 as the listing title", () => {
    render(<ListingHeader {...baseProps} />);
    expect(screen.getByRole("heading", { level: 1, name: "Test Listing" })).toBeInTheDocument();
  });

  it("shows a text status badge for Reserved (not color alone)", () => {
    render(<ListingHeader {...baseProps} status="reserved" />);
    expect(screen.getByText("Reserved")).toBeInTheDocument();
  });

  it("shows a text status badge for Sold", () => {
    render(<ListingHeader {...baseProps} status="sold" />);
    expect(screen.getByText("Sold")).toBeInTheDocument();
  });

  it("shows a text status badge for Archived", () => {
    render(<ListingHeader {...baseProps} status="archived" />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("shows no status badge for Available", () => {
    render(<ListingHeader {...baseProps} status="available" />);
    expect(screen.queryByText("Available")).not.toBeInTheDocument();
  });

  it("composes the location label as given", () => {
    render(<ListingHeader {...baseProps} />);
    expect(screen.getByText("Tangub City, Misamis Occidental")).toBeInTheDocument();
  });
});
