"use client";

import { useState, useTransition } from "react";
import { ShopReviewCard } from "@/components/shop/ShopReviewCard";
import { SectionEmptyState } from "@/components/marketplace/SectionEmptyState";
import type { ShopReviewItem, ShopReviewsCursor } from "@/lib/reviews/get-shop-reviews";

type LoadMoreResult = {
  reviews: ShopReviewItem[];
  hadError: boolean;
  nextCursor: ShopReviewsCursor | null;
};

type Props = {
  initialReviews: ShopReviewItem[];
  initialHadError: boolean;
  initialCursor: ShopReviewsCursor | null;
  loadMore: (cursor: ShopReviewsCursor) => Promise<LoadMoreResult>;
};

/** Same "Load More" shape as ShopListingsClient: the first page is
 * server-rendered, this client boundary exists only for paging via a
 * Server Action closing over the shop id -- pagination never runs the RPC
 * from the browser. */
export function ShopReviewsClient({ initialReviews, initialHadError, initialCursor, loadMore }: Props) {
  const [reviews, setReviews] = useState(initialReviews);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (initialHadError) {
    return <SectionEmptyState message="Unable to load reviews right now." />;
  }

  if (reviews.length === 0) {
    return <SectionEmptyState message="No reviews yet." />;
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await loadMore(cursor);
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
      <div className="space-y-3">
        {reviews.map((review) => (
          <ShopReviewCard key={review.reviewId} review={review} />
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
    </div>
  );
}
