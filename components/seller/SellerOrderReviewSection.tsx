import { StarRatingDisplay } from "@/components/reviews/StarRatingDisplay";
import { SellerReviewReplyClient } from "@/components/seller/SellerReviewReplyClient";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import type { OrderReview } from "@/lib/reviews/get-order-review";

import { ReviewVisibilityUnknownNotice } from "@/components/orders/ReviewRemovalNotice";
import type { ReviewVisibility } from "@/lib/reviews/review-visibility";

type Props = {
  review: OrderReview | null;
  /** "removed": moderation removed this review, and replies are closed by the
   * backend (canWriteReply is false). "unknown": the removal reader failed, so
   * the status is not shown as visible. null/"visible": no status line. */
  visibility?: ReviewVisibility | null;
};

/**
 * Seller-facing review + reply section for a completed order. Renders
 * nothing when there's no review yet (the buyer hasn't reviewed, or the
 * fetch failed) -- there is no seller action to take against a review that
 * doesn't exist. Visually subordinate to the order's own status/items
 * block above it, per this task's own restraint requirement.
 */
export function SellerOrderReviewSection({ review, visibility = null }: Props) {
  if (review === null || review.reviewId === null || review.rating === null || review.createdAt === null) {
    return null;
  }

  return (
    <div className="mt-6 rounded-[14px] border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Buyer review</h2>
      {visibility === "removed" && (
        <p className="mt-2 text-xs text-ink-secondary">This review was removed after a moderation review. It is no longer shown publicly, and replies are closed.</p>
      )}
      {visibility === "unknown" && <ReviewVisibilityUnknownNotice />}
      <div className="mt-2 flex items-center gap-2">
        <StarRatingDisplay rating={review.rating} />
        <span className="text-xs text-ink-muted">{formatOrderDate(review.createdAt)}</span>
      </div>
      {review.body && <p className="mt-2 text-sm text-ink">{review.body}</p>}

      <SellerReviewReplyClient reviewId={review.reviewId} initialReplyBody={review.replyBody} canWriteReply={review.canWriteReply} />
    </div>
  );
}
