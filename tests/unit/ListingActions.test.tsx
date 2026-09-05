import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingActions } from "@/components/listing/ListingActions";

describe("ListingActions", () => {
  it("shows a disabled Add to Cart for an available, ordinary listing", () => {
    render(<ListingActions status="available" isInquiryOnly={false} />);
    const addToCart = screen.getByRole("button", { name: "Add to Cart" });
    expect(addToCart).toBeDisabled();
  });

  it("shows Message Seller alongside Add to Cart for an available, ordinary listing", () => {
    render(<ListingActions status="available" isInquiryOnly={false} />);
    expect(screen.getByRole("button", { name: "Message Seller" })).toBeDisabled();
  });

  it("does not fake success -- there is no success/confirmation state to reach", () => {
    render(<ListingActions status="available" isInquiryOnly={false} />);
    expect(screen.queryByText(/added to cart/i)).not.toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("hides Add to Cart when reserved", () => {
    render(<ListingActions status="reserved" isInquiryOnly={false} />);
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/currently reserved/i)).toBeInTheDocument();
  });

  it("hides Add to Cart when sold", () => {
    render(<ListingActions status="sold" isInquiryOnly={false} />);
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/already been sold/i)).toBeInTheDocument();
  });

  it("hides Add to Cart when archived", () => {
    render(<ListingActions status="archived" isInquiryOnly={false} />);
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it("shows Message Seller as the primary action for an inquiry-only listing, and never Add to Cart", () => {
    render(<ListingActions status="available" isInquiryOnly />);
    expect(screen.getByRole("button", { name: "Message Seller" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
  });

  it("never shows Add to Cart for an inquiry-only listing regardless of status", () => {
    for (const status of ["available", "reserved", "sold", "archived"] as const) {
      const { unmount } = render(<ListingActions status={status} isInquiryOnly />);
      expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
      unmount();
    }
  });
});
