import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { pushMock, refreshMock, createReviewMock, updateReviewMock, notifySuccessMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  createReviewMock: vi.fn(),
  updateReviewMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/reviews/review-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reviews/review-actions")>("@/lib/reviews/review-actions");
  return {
    ...actual,
    createReview: createReviewMock,
    updateReview: updateReviewMock,
  };
});

vi.mock("@/lib/notifications/toast", () => ({
  notifySuccess: notifySuccessMock,
}));

import { ReviewFormClient } from "@/components/orders/ReviewFormClient";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReviewFormClient -- create mode", () => {
  it("requires a star rating before submitting -- no RPC call, error is associated with the fieldset", async () => {
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={["Uniqlo Shirt"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("Please choose a star rating.")).toBeInTheDocument();
    expect(createReviewMock).not.toHaveBeenCalled();
  });

  it("submits create_review with the chosen rating, trimmed body, and no photos (pilot restriction: new reviews never have photos)", async () => {
    createReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", createdAt: "2026-01-01T00:00:00.000Z" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={["Uniqlo Shirt"]} />);

    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }));
    fireEvent.change(screen.getByLabelText(/your review/i), { target: { value: "  Great seller  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(createReviewMock).toHaveBeenCalledWith("order-1", 4, "Great seller", []));
    expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC");
  });

  it("a successful create never fires a toast -- create keeps its existing navigation-only confirmation, unchanged", async () => {
    createReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", createdAt: "2026-01-01T00:00:00.000Z" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC"));
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("sends null body when the review text is left blank", async () => {
    createReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", createdAt: "2026-01-01T00:00:00.000Z" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(createReviewMock).toHaveBeenCalledWith("order-1", 5, null, []));
  });

  it("shows the backend's safe error message and does not navigate away on failure", async () => {
    createReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_ALREADY_EXISTS" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /3 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("You've already reviewed this order.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("displays the purchased item as read-only context, not an editable/product-specific rating field", () => {
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={["Uniqlo Shirt"]} />);
    expect(screen.getByText("Uniqlo Shirt")).toBeInTheDocument();
    expect(screen.queryByLabelText(/product rating/i)).not.toBeInTheDocument();
  });

  it("PILOT RESTRICTION: renders no Add Photo control or photo picker at all in create mode", () => {
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);
    expect(screen.queryByLabelText(/add a review photo/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Photos")).not.toBeInTheDocument();
  });

  it("maps a REVIEW_IMAGES_DISABLED failure (e.g. a direct RPC call bypassing the UI) to safe copy", async () => {
    createReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_IMAGES_DISABLED" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("Photos can't be added to reviews right now.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("ReviewFormClient -- create mode, restriction-aware INTERACTION_BLOCKED error (A2.2.2g.1)", () => {
  it("a buyer_restricted failure shows the generic message, the specific buying-access message, and a 'View account status' link", async () => {
    createReviewMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("You can't review this seller right now.")).toBeInTheDocument();
    expect(screen.getByText("Your buying access is currently restricted.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("an account_suspended failure shows the specific account-suspended message and link", async () => {
    createReviewMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("a generic blocked result (no confirmed restriction, e.g. a mutual-block-only collision) shows only the existing generic message, with no detail and no link", async () => {
    createReviewMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("You can't review this seller right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("an unrelated ordinary validation failure (e.g. REVIEW_ALREADY_EXISTS) renders no detail and no link", async () => {
    createReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_ALREADY_EXISTS" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("You've already reviewed this order.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("retrying after a restriction failure replaces the stale presentation with the new attempt's result", async () => {
    createReviewMock.mockResolvedValueOnce({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    createReviewMock.mockResolvedValueOnce({ ok: false, code: "REVIEW_ALREADY_EXISTS" });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(screen.getByText("You've already reviewed this order.")).toBeInTheDocument());
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a successful creation after a restriction failure retains existing arguments and navigation behavior", async () => {
    createReviewMock.mockResolvedValueOnce({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    createReviewMock.mockResolvedValueOnce({ ok: true, reviewId: "review-1", createdAt: "2026-01-01T00:00:00.000Z" });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(createReviewMock).toHaveBeenCalledWith("order-1", 5, null, []));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });
});

describe("ReviewFormClient -- edit mode", () => {
  it("prefills the existing rating and body, and calls update_review on submit", async () => {
    updateReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialBody="Original text"
        purchasedItemTitles={[]}
      />,
    );

    expect(screen.getByRole("radio", { name: /3 stars/i })).toBeChecked();
    expect(screen.getByDisplayValue("Original text")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateReviewMock).toHaveBeenCalledWith("review-1", 3, "Original text", []));
  });

  it("a successful edit fires exactly one 'Review updated' toast, before navigating away", async () => {
    updateReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialBody="Original text"
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC"));
    expect(notifySuccessMock).toHaveBeenCalledWith("Review updated");
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    expect(notifySuccessMock.mock.invocationCallOrder[0]).toBeLessThan(pushMock.mock.invocationCallOrder[0]);
  });

  it("maps REVIEW_EDIT_WINDOW_CLOSED to safe copy on a submit", async () => {
    updateReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_EDIT_WINDOW_CLOSED" });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("The 7-day edit window for this review has closed.")).toBeInTheDocument();
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("maps a REVIEW_IMAGES_DISABLED failure (e.g. a direct RPC call bypassing the UI) to safe copy", async () => {
    updateReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_IMAGES_DISABLED" });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Photos can't be changed on reviews right now.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("PILOT RESTRICTION: resubmits an existing review's photos completely unchanged on every save -- editing rating/text never requires touching them", async () => {
    updateReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialBody="Original text"
        initialImagePaths={["review-images/buyer-1/order-1/keep1.jpg", "review-images/buyer-1/order-1/keep2.jpg"]}
        initialImageUrls={["https://example.supabase.co/x/keep1.jpg", "https://example.supabase.co/x/keep2.jpg"]}
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText(/your review/i), { target: { value: "Updated text only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateReviewMock).toHaveBeenCalledWith("review-1", 3, "Updated text only", [
        "review-images/buyer-1/order-1/keep1.jpg",
        "review-images/buyer-1/order-1/keep2.jpg",
      ]),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC"));
  });

  it("PILOT RESTRICTION: an existing photo is still resubmitted unchanged even when the save itself fails -- nothing is dropped by a failed attempt", async () => {
    updateReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_EDIT_WINDOW_CLOSED" });
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialImagePaths={["review-images/buyer-1/order-1/existing.jpg"]}
        initialImageUrls={["https://example.supabase.co/storage/v1/object/public/review-images/buyer-1/order-1/existing.jpg"]}
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateReviewMock).toHaveBeenCalledWith("review-1", 3, null, ["review-images/buyer-1/order-1/existing.jpg"]),
    );
    expect(screen.getByText("Photos")).toBeInTheDocument();
  });

  it("PILOT RESTRICTION: renders existing photos read-only, with no Add Photo and no Remove Photo control", () => {
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={5}
        initialImagePaths={["review-images/buyer-1/order-1/unchanged.jpg"]}
        initialImageUrls={["https://example.supabase.co/x/unchanged.jpg"]}
        purchasedItemTitles={[]}
      />,
    );

    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.queryByLabelText(/add a review photo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });

  it("a generic INTERACTION_BLOCKED edit failure with no confirmed restriction (e.g. a deleted-account or buyer_restricted-alone collision) shows only the existing generic message, with no detail and no link", async () => {
    updateReviewMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("You can't edit this review right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });
});

describe("ReviewFormClient -- edit mode, restriction-aware INTERACTION_BLOCKED error (A2.2 CORRECTION 1)", () => {
  it("an account_suspended failure shows the generic edit message, the specific account-suspended message, and a 'View account status' link", async () => {
    updateReviewMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("You can't edit this review right now.")).toBeInTheDocument();
    expect(screen.getByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("a buyer-only restriction (update_review deliberately never blocks editing for buyer_restricted alone) produces the generic edit error with no detail/link", async () => {
    updateReviewMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("You can't edit this review right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("an ordinary non-blocked failure (REVIEW_EDIT_WINDOW_CLOSED) produces no Account Status guidance", async () => {
    updateReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_EDIT_WINDOW_CLOSED" });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("The 7-day edit window for this review has closed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("retrying after a restriction failure replaces the stale presentation with the new attempt's result", async () => {
    updateReviewMock.mockResolvedValueOnce({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();

    updateReviewMock.mockResolvedValueOnce({ ok: false, code: "REVIEW_EDIT_WINDOW_CLOSED" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("The 7-day edit window for this review has closed.")).toBeInTheDocument());
    expect(screen.queryByText("Your account is currently suspended.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a failed restricted edit never navigates and never replaces the persisted review", async () => {
    updateReviewMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialBody="Original text"
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Original text")).toBeInTheDocument();
  });

  it("a successful retry after a restriction failure clears the detail/link and preserves existing navigation and refresh behavior", async () => {
    updateReviewMock.mockResolvedValueOnce({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialImagePaths={["review-images/buyer-1/order-1/keep.jpg"]}
        initialImageUrls={["https://example.supabase.co/x/keep.jpg"]}
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();

    updateReviewMock.mockResolvedValueOnce({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateReviewMock).toHaveBeenLastCalledWith("review-1", 3, null, ["review-images/buyer-1/order-1/keep.jpg"]));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByText("Your account is currently suspended.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("create-mode restriction behavior remains unchanged after this correction", async () => {
    createReviewMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });
});
