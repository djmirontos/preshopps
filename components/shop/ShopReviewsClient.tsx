"use client";

import { useState, useTransition } from "react";
import { ShopReviewCard } from "@/components/shop/ShopReviewCard";
import { SectionEmptyState } from "@/components/marketplace/SectionEmptyState";
import { cn } from "@/lib/cn";
import type { ShopReviewItem, ShopReviewsCursor, ReviewRatingFilter, ReviewSortMode } from "@/lib/reviews/get-shop-reviews";

type FetchReviewsResult = {
  reviews: ShopReviewItem[];
  hadError: boolean;
  nextCursor: ShopReviewsCursor | null;
};

type Props = {
  initialReviews: ShopReviewItem[];
  initialHadError: boolean;
  initialCursor: ShopReviewsCursor | null;
  /** Fetches one page for the given (cursor, ratingFilter, sortMode).
   * cursor === null means "first page" -- used both for the initial load
   * (server-rendered, not through this prop) and whenever the filter/sort
   * controls change (pagination resets). A non-null cursor is always for
   * "Load more" and always carries the currently selected filter/sort. */
  fetchReviews: (
    cursor: ShopReviewsCursor | null,
    ratingFilter: ReviewRatingFilter,
    sortMode: ReviewSortMode,
  ) => Promise<FetchReviewsResult>;
  isAuthenticated: boolean;
  /** Safe internal path to return to after sign-in, passed through to each
   * review's Report action. */
  next: string;
};

const RATING_FILTERS: ReviewRatingFilter[] = [null, 5, 4, 3, 2, 1];

const SORT_OPTIONS: Array<{ value: ReviewSortMode; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "highest_rating", label: "Highest Rated" },
];

function pillClass(isActive: boolean): string {
  return cn(
    "flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
    isActive
      ? "border-brand-action bg-brand-action text-brand-action-text"
      : "border-border bg-surface text-ink-secondary hover:border-brand-link hover:text-brand-link",
  );
}

function ratingFilterLabel(value: ReviewRatingFilter): string {
  return value === null ? "All ratings" : `${value} star${value === 1 ? "" : "s"}`;
}

/**
 * Same "Load More" shape as ShopListingsClient, plus PRD 26.8's rating
 * filter (All/5/4/3/2/1) and sort control (Newest/Highest Rated). Both
 * controls are local client state, not URL params -- consistent with this
 * component's existing pagination-via-Server-Action design, not the
 * separate URL-driven marketplace search filters. Changing either control
 * discards the current page and refetches page 1 with the new selection;
 * "Load more" always resends the currently selected filter/sort alongside
 * its cursor.
 */
export function ShopReviewsClient({ initialReviews, initialHadError, initialCursor, fetchReviews, isAuthenticated, next }: Props) {
  const [ratingFilter, setRatingFilter] = useState<ReviewRatingFilter>(null);
  const [sortMode, setSortMode] = useState<ReviewSortMode>("newest");
  const [reviews, setReviews] = useState(initialReviews);
  const [hadError, setHadError] = useState(initialHadError);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function applySelection(nextRatingFilter: ReviewRatingFilter, nextSortMode: ReviewSortMode) {
    setRatingFilter(nextRatingFilter);
    setSortMode(nextSortMode);
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await fetchReviews(null, nextRatingFilter, nextSortMode);
      setHadError(result.hadError);
      setReviews(result.reviews);
      setCursor(result.nextCursor);
    });
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await fetchReviews(cursor, ratingFilter, sortMode);
      if (result.hadError) {
        setLoadMoreFailed(true);
        return;
      }
      setReviews((prev) => [...prev, ...result.reviews]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Filter by rating" className="flex flex-wrap gap-1.5">
          {RATING_FILTERS.map((value) => {
            const isActive = ratingFilter === value;
            return (
              <button
                key={value ?? "all"}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={ratingFilterLabel(value)}
                disabled={isPending}
                onClick={() => !isActive && applySelection(value, sortMode)}
                className={pillClass(isActive)}
              >
                {value === null ? "All" : `${value}★`}
              </button>
            );
          })}
        </div>

        <select
          aria-label="Sort reviews"
          value={sortMode}
          disabled={isPending}
          onChange={(event) => applySelection(ratingFilter, event.target.value as ReviewSortMode)}
          className="h-8 rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        {hadError ? (
          <SectionEmptyState message="Unable to load reviews right now." />
        ) : reviews.length === 0 ? (
          <SectionEmptyState message={ratingFilter === null ? "No reviews yet." : `No ${ratingFilter}★ reviews yet.`} />
        ) : (
          <>
            <div className="space-y-3">
              {reviews.map((review) => (
                <ShopReviewCard key={review.reviewId} review={review} isAuthenticated={isAuthenticated} next={next} />
              ))}
            </div>

            {cursor && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isPending}
                  className="rounded-[10px] border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-link hover:text-brand-link disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {isPending ? "Loading…" : "Load more"}
                </button>
                {loadMoreFailed && <p className="text-xs text-danger">Unable to load more reviews right now.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
