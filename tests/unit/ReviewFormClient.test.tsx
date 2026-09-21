import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { pushMock, refreshMock, createReviewMock, updateReviewMock, uploadImageMock, deleteUploadedImageMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  createReviewMock: vi.fn(),
  updateReviewMock: vi.fn(),
  uploadImageMock: vi.fn(),
  deleteUploadedImageMock: vi.fn(),
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

vi.mock("@/lib/image-processing/upload-image", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing/upload-image")>("@/lib/image-processing/upload-image");
  return {
    ...actual,
    uploadImage: uploadImageMock,
    deleteUploadedImage: deleteUploadedImageMock,
  };
});

import { ReviewFormClient } from "@/components/orders/ReviewFormClient";

beforeEach(() => {
  vi.clearAllMocks();
  deleteUploadedImageMock.mockResolvedValue(true);
  if (!("createObjectURL" in URL)) {
    // jsdom does not implement this -- provide a minimal stand-in so
    // selecting a file for preview doesn't throw.
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

function selectFile(input: HTMLElement, name = "photo.jpg") {
  const file = new File(["fake-bytes"], name, { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ReviewFormClient -- create mode", () => {
  it("requires a star rating before submitting -- no RPC call, error is associated with the fieldset", async () => {
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={["Uniqlo Shirt"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    expect(await screen.findByText("Please choose a star rating.")).toBeInTheDocument();
    expect(createReviewMock).not.toHaveBeenCalled();
  });

  it("submits create_review with the chosen rating, trimmed body, and no photos when none were added", async () => {
    createReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", createdAt: "2026-01-01T00:00:00.000Z" });
    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={["Uniqlo Shirt"]} />);

    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }));
    fireEvent.change(screen.getByLabelText(/your review/i), { target: { value: "  Great seller  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(createReviewMock).toHaveBeenCalledWith("order-1", 4, "Great seller", []));
    expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC");
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

  it("includes an uploaded photo's storage path when submitting, and disables Submit while the upload is in flight", async () => {
    let resolveUpload: (value: { ok: true; path: string }) => void = () => {};
    uploadImageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    createReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", createdAt: "2026-01-01T00:00:00.000Z" });

    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));

    selectFile(screen.getByLabelText(/add a review photo/i));

    const submitButton = screen.getByRole("button", { name: /uploading photos/i });
    expect(submitButton).toBeDisabled();

    resolveUpload({ ok: true, path: "review-images/buyer-1/order-1/new-photo.jpg" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit review" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() =>
      expect(createReviewMock).toHaveBeenCalledWith("order-1", 5, null, ["review-images/buyer-1/order-1/new-photo.jpg"]),
    );
  });

  it("best-effort deletes a newly-uploaded photo when the review mutation itself fails", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/orphaned.jpg" });
    createReviewMock.mockResolvedValue({ ok: false, code: "ORDER_NOT_REVIEWABLE" });

    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    selectFile(screen.getByLabelText(/add a review photo/i));

    await waitFor(() => expect(screen.getByRole("button", { name: "Submit review" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("review-images/buyer-1/order-1/orphaned.jpg"));
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

  it("best-effort deletes a newly-uploaded photo when the failure carries a confirmed restriction presentation", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/orphaned.jpg" });
    createReviewMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your buying access is currently restricted.", ctaLabel: "View account status", href: "/account#account-status" },
    });

    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    selectFile(screen.getByLabelText(/add a review photo/i));

    await waitFor(() => expect(screen.getByRole("button", { name: "Submit review" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("review-images/buyer-1/order-1/orphaned.jpg"));
  });

  it("best-effort deletes a newly-uploaded photo when the failure is a generic blocked result with no confirmed restriction", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/orphaned-2.jpg" });
    createReviewMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });

    render(<ReviewFormClient mode="create" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" purchasedItemTitles={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    selectFile(screen.getByLabelText(/add a review photo/i));

    await waitFor(() => expect(screen.getByRole("button", { name: "Submit review" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));

    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("review-images/buyer-1/order-1/orphaned-2.jpg"));
  });

  it("a successful creation after a restriction failure retains existing arguments, cleanup, and navigation behavior", async () => {
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

  it("maps REVIEW_EDIT_WINDOW_CLOSED to safe copy on a stale submit", async () => {
    updateReviewMock.mockResolvedValue({ ok: false, code: "REVIEW_EDIT_WINDOW_CLOSED" });
    render(
      <ReviewFormClient mode="edit" buyerId="buyer-1" orderId="order-1" orderPublicCode="PSO-ABC" reviewId="review-1" initialRating={3} purchasedItemTitles={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("The 7-day edit window for this review has closed.")).toBeInTheDocument();
  });

  it("resubmits an existing image path unchanged, and never deletes it if the mutation fails", async () => {
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
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("successful edit removing a persisted photo deletes only that removed path, after update_review succeeds", async () => {
    updateReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialImagePaths={["review-images/buyer-1/order-1/keep.jpg", "review-images/buyer-1/order-1/remove.jpg"]}
        initialImageUrls={["https://example.supabase.co/x/keep.jpg", "https://example.supabase.co/x/remove.jpg"]}
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove photo" })[1]);
    // Removing an existing (previously-persisted) image must never delete it
    // immediately -- only after a successful save.
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateReviewMock).toHaveBeenCalledWith("review-1", 3, null, ["review-images/buyer-1/order-1/keep.jpg"]));
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("review-images/buyer-1/order-1/remove.jpg"));
    expect(deleteUploadedImageMock).not.toHaveBeenCalledWith("review-images/buyer-1/order-1/keep.jpg");
    expect(deleteUploadedImageMock).toHaveBeenCalledTimes(1);
  });

  it("successful replacement deletes the old persisted path but keeps the new one", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/replacement.jpg" });
    updateReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });

    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={4}
        initialImagePaths={["review-images/buyer-1/order-1/old.jpg"]}
        initialImageUrls={["https://example.supabase.co/x/old.jpg"]}
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    selectFile(screen.getByLabelText(/add a review photo/i));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateReviewMock).toHaveBeenCalledWith("review-1", 4, null, ["review-images/buyer-1/order-1/replacement.jpg"]),
    );
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("review-images/buyer-1/order-1/old.jpg"));
    expect(deleteUploadedImageMock).not.toHaveBeenCalledWith("review-images/buyer-1/order-1/replacement.jpg");
  });

  it("leaves an unchanged persisted photo alone on a successful save -- no delete call at all", async () => {
    updateReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });
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

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateReviewMock).toHaveBeenCalledWith("review-1", 5, null, ["review-images/buyer-1/order-1/unchanged.jpg"]),
    );
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("a cleanup failure after a successful save still navigates away as a success (never surfaced as a submit error)", async () => {
    updateReviewMock.mockResolvedValue({ ok: true, reviewId: "review-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    deleteUploadedImageMock.mockRejectedValue(new Error("network down"));

    render(
      <ReviewFormClient
        mode="edit"
        buyerId="buyer-1"
        orderId="order-1"
        orderPublicCode="PSO-ABC"
        reviewId="review-1"
        initialRating={3}
        initialImagePaths={["review-images/buyer-1/order-1/remove.jpg"]}
        initialImageUrls={["https://example.supabase.co/x/remove.jpg"]}
        purchasedItemTitles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
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

  it("best-effort deletes a newly-uploaded photo when a restricted edit fails with a confirmed account-suspension presentation", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/edit-orphaned.jpg" });
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
        purchasedItemTitles={[]}
      />,
    );
    selectFile(screen.getByLabelText(/add a review photo/i));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("review-images/buyer-1/order-1/edit-orphaned.jpg"));
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

  it("a successful retry after a restriction failure clears the detail/link and preserves existing cleanup, navigation, and refresh behavior", async () => {
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

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/orders/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
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
