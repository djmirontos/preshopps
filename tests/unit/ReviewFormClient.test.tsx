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
});
