import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuyerOrderReviewSection } from "@/components/orders/BuyerOrderReviewSection";
import type { OrderReview } from "@/lib/reviews/get-order-review";

function sampleReview(overrides: Partial<OrderReview> = {}): OrderReview {
  return {
    orderId: "order-1",
    viewerRole: "buyer",
    reviewId: null,
    rating: null,
    body: null,
    imagePaths: [],
    imageUrls: [],
    createdAt: null,
    updatedAt: null,
    canCreateReview: true,
    canEditReview: false,
    replyBody: null,
    replyCreatedAt: null,
    replyUpdatedAt: null,
    canWriteReply: false,
    ...overrides,
  };
}

describe("BuyerOrderReviewSection", () => {
  it("shows 'Leave a review' when the order is completed and no review exists yet", () => {
    render(<BuyerOrderReviewSection orderPublicCode="PSO-ABC" status="completed" review={sampleReview()} />);
    expect(screen.getByRole("link", { name: "Leave a review" })).toHaveAttribute("href", "/orders/PSO-ABC/review");
  });

  it("shows 'Edit review' when a review exists and is still within the buyer edit window", () => {
    render(
      <BuyerOrderReviewSection
        orderPublicCode="PSO-ABC"
        status="completed"
        review={sampleReview({ reviewId: "review-1", canCreateReview: false, canEditReview: true })}
      />,
    );
    expect(screen.getByRole("link", { name: "Edit review" })).toHaveAttribute("href", "/orders/PSO-ABC/review");
  });

  it("shows 'View review' when a review exists but the edit window has closed", () => {
    render(
      <BuyerOrderReviewSection
        orderPublicCode="PSO-ABC"
        status="completed"
        review={sampleReview({ reviewId: "review-1", canCreateReview: false, canEditReview: false })}
      />,
    );
    expect(screen.getByRole("link", { name: "View review" })).toHaveAttribute("href", "/orders/PSO-ABC/review");
  });

  it("renders nothing for a non-completed order, even if a review object were somehow passed", () => {
    const { container } = render(<BuyerOrderReviewSection orderPublicCode="PSO-ABC" status="pending" review={sampleReview()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the review fetch failed (review is null)", () => {
    const { container } = render(<BuyerOrderReviewSection orderPublicCode="PSO-ABC" status="completed" review={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no review exists and creation isn't eligible (e.g. backend disagrees with client status)", () => {
    const { container } = render(
      <BuyerOrderReviewSection orderPublicCode="PSO-ABC" status="completed" review={sampleReview({ canCreateReview: false })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
