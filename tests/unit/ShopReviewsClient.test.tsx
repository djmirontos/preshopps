import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ShopReviewItem } from "@/lib/reviews/get-shop-reviews";
import { ShopReviewsClient } from "@/components/shop/ShopReviewsClient";

function review(overrides: Partial<ShopReviewItem> = {}): ShopReviewItem {
  return {
    reviewId: "review-1",
    rating: 5,
    body: "Great seller!",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    buyerDisplayName: "Jane D.",
    buyerAvatarUrl: undefined,
    replyBody: null,
    replyCreatedAt: null,
    replyUpdatedAt: null,
    imageUrls: [],
    purchasedItemTitles: ["Uniqlo Shirt"],
    ...overrides,
  };
}

describe("ShopReviewsClient", () => {
  it("renders the server-provided initial results without calling fetchReviews", () => {
    const fetchReviews = vi.fn();
    render(
      <ShopReviewsClient initialReviews={[review()]} initialHadError={false} initialCursor={null} fetchReviews={fetchReviews} />,
    );
    expect(screen.getByText("Great seller!")).toBeInTheDocument();
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it("shows a plain empty message (never a 404) for a valid shop with zero reviews", () => {
    render(<ShopReviewsClient initialReviews={[]} initialHadError={false} initialCursor={null} fetchReviews={vi.fn()} />);
    expect(screen.getByText("No reviews yet.")).toBeInTheDocument();
  });

  it("shows an error fallback when the initial fetch failed", () => {
    render(<ShopReviewsClient initialReviews={[]} initialHadError initialCursor={null} fetchReviews={vi.fn()} />);
    expect(screen.getByText("Unable to load reviews right now.")).toBeInTheDocument();
  });

  it("renders exactly one rating filter chip group (All, 5, 4, 3, 2, 1) and a sort control, defaulting to All / Newest", () => {
    render(<ShopReviewsClient initialReviews={[review()]} initialHadError={false} initialCursor={null} fetchReviews={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: /filter by rating/i });
    expect(group).toBeInTheDocument();
    for (const label of ["All ratings", "5 stars", "4 stars", "3 stars", "2 stars", "1 star"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "All ratings" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: /sort reviews/i })).toHaveValue("newest");
  });

  it("gives every rating chip and the sort select the shared disabled:opacity-60 visual treatment, matching the Load More button", () => {
    render(<ShopReviewsClient initialReviews={[review()]} initialHadError={false} initialCursor={null} fetchReviews={vi.fn()} />);
    for (const label of ["All ratings", "5 stars", "4 stars", "3 stars", "2 stars", "1 star"]) {
      expect(screen.getByRole("radio", { name: label }).className).toContain("disabled:opacity-60");
    }
    expect(screen.getByRole("combobox", { name: /sort reviews/i }).className).toContain("disabled:opacity-60");
  });

  it("Load more appends new results using the cursor and the currently selected filter/sort (default All/Newest)", async () => {
    const fetchReviews = vi.fn().mockResolvedValue({
      reviews: [review({ reviewId: "review-2", body: "Second review" })],
      hadError: false,
      nextCursor: null,
    });
    render(
      <ShopReviewsClient
        initialReviews={[review()]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-01T00:00:00.000Z", id: "review-1", rating: 5 }}
        fetchReviews={fetchReviews}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getByText("Second review")).toBeInTheDocument());
    expect(screen.getByText("Great seller!")).toBeInTheDocument();
    expect(fetchReviews).toHaveBeenCalledWith(
      { createdAt: "2026-01-01T00:00:00.000Z", id: "review-1", rating: 5 },
      null,
      "newest",
    );
  });

  it("switching the rating filter resets pagination and reloads from page 1 with cursor null", async () => {
    const fetchReviews = vi.fn().mockResolvedValue({
      reviews: [review({ reviewId: "review-5star", rating: 5, body: "Only five-star" })],
      hadError: false,
      nextCursor: null,
    });
    render(
      <ShopReviewsClient
        initialReviews={[review({ body: "Mixed rating review" })]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-01T00:00:00.000Z", id: "review-1", rating: 5 }}
        fetchReviews={fetchReviews}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));

    await waitFor(() => expect(screen.getByText("Only five-star")).toBeInTheDocument());
    // The prior page's results are replaced, not appended to.
    expect(screen.queryByText("Mixed rating review")).not.toBeInTheDocument();
    expect(fetchReviews).toHaveBeenCalledWith(null, 5, "newest");
    expect(screen.getByRole("radio", { name: "5 stars" })).toHaveAttribute("aria-checked", "true");
    // Load More no longer shows -- the reset fetch returned nextCursor: null.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("switching sort mode resets pagination and reloads from page 1 with cursor null, keeping the current rating filter", async () => {
    const fetchReviews = vi.fn().mockResolvedValue({
      reviews: [review({ reviewId: "review-top", body: "Top rated first" })],
      hadError: false,
      nextCursor: { createdAt: "2026-01-02T00:00:00.000Z", id: "review-top", rating: 5 },
    });
    render(
      <ShopReviewsClient
        initialReviews={[review({ body: "Newest first" })]}
        initialHadError={false}
        initialCursor={null}
        fetchReviews={fetchReviews}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: /sort reviews/i }), { target: { value: "highest_rating" } });

    await waitFor(() => expect(screen.getByText("Top rated first")).toBeInTheDocument());
    expect(screen.queryByText("Newest first")).not.toBeInTheDocument();
    expect(fetchReviews).toHaveBeenCalledWith(null, null, "highest_rating");
  });

  it("a filtered result set that comes back empty shows a filter-aware empty message, not the generic one", async () => {
    const fetchReviews = vi.fn().mockResolvedValue({ reviews: [], hadError: false, nextCursor: null });
    render(
      <ShopReviewsClient initialReviews={[review()]} initialHadError={false} initialCursor={null} fetchReviews={fetchReviews} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "1 star" }));

    await waitFor(() => expect(screen.getByText("No 1★ reviews yet.")).toBeInTheDocument());
  });

  it("shows a load-more error without discarding already-loaded results", async () => {
    const fetchReviews = vi.fn().mockResolvedValue({ reviews: [], hadError: true, nextCursor: null });
    render(
      <ShopReviewsClient
        initialReviews={[review()]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-01T00:00:00.000Z", id: "review-1", rating: 5 }}
        fetchReviews={fetchReviews}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getByText(/unable to load more reviews right now/i)).toBeInTheDocument());
    expect(screen.getByText("Great seller!")).toBeInTheDocument();
  });
});
