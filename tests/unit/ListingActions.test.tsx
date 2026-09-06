import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListingActions } from "@/components/listing/ListingActions";

const NEXT = "/item/PLS-ABC123";

describe("ListingActions (authenticated)", () => {
  it("shows a disabled Add to Cart for an available, ordinary listing", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated next={NEXT} />);
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeDisabled();
  });

  it("shows Message Seller alongside Add to Cart for an available, ordinary listing", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated next={NEXT} />);
    expect(screen.getByRole("button", { name: "Message Seller" })).toBeDisabled();
  });

  it("does not fake success -- there is no success/confirmation state to reach", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated next={NEXT} />);
    expect(screen.queryByText(/added to cart/i)).not.toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("does not open the auth gate for an authenticated user", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated next={NEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides Add to Cart when reserved", () => {
    render(<ListingActions status="reserved" isInquiryOnly={false} isAuthenticated next={NEXT} />);
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/currently reserved/i)).toBeInTheDocument();
  });

  it("hides Add to Cart when sold", () => {
    render(<ListingActions status="sold" isInquiryOnly={false} isAuthenticated next={NEXT} />);
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/already been sold/i)).toBeInTheDocument();
  });

  it("hides Add to Cart when archived", () => {
    render(<ListingActions status="archived" isInquiryOnly={false} isAuthenticated next={NEXT} />);
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it("shows Message Seller as the primary action for an inquiry-only listing, and never Add to Cart", () => {
    render(<ListingActions status="available" isInquiryOnly isAuthenticated next={NEXT} />);
    expect(screen.getByRole("button", { name: "Message Seller" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
  });

  it("never shows Add to Cart for an inquiry-only listing regardless of status", () => {
    for (const status of ["available", "reserved", "sold", "archived"] as const) {
      const { unmount } = render(
        <ListingActions status={status} isInquiryOnly isAuthenticated next={NEXT} />,
      );
      expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("ListingActions (guest)", () => {
  it("opens the auth gate when a guest clicks Add to Cart", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated={false} next={NEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Sign in to add to cart")).toBeInTheDocument();
  });

  it("opens the auth gate when a guest clicks Message Seller", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated={false} next={NEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByText("Sign in to message this seller")).toBeInTheDocument();
  });

  it("opens the Message Seller gate for an inquiry-only listing (its only action)", () => {
    render(<ListingActions status="available" isInquiryOnly isAuthenticated={false} next={NEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByText("Sign in to message this seller")).toBeInTheDocument();
  });

  it("guest buttons are not disabled (they are real triggers for the gate)", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated={false} next={NEXT} />);
    expect(screen.getByRole("button", { name: "Add to Cart" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Message Seller" })).not.toBeDisabled();
  });

  it("carries the given safe next path into both Sign in and Create account links", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated={false} next={NEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent(NEXT)}`,
    );
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      `/sign-up?next=${encodeURIComponent(NEXT)}`,
    );
  });

  it("closes the gate on Escape", () => {
    render(<ListingActions status="available" isInquiryOnly={false} isAuthenticated={false} next={NEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Message Seller" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
