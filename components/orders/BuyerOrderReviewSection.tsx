import Link from "next/link";
import type { OrderReview } from "@/lib/reviews/get-order-review";

type Props = {
  orderPublicCode: string;
  status: string;
  review: OrderReview | null;
};

/**
 * Completed-order-only review entry point on the buyer's own order detail
 * page -- "Leave a review" (no review yet), "Edit review" (exists, still
 * within the 7-day window), or "View review" (exists, window closed). All
 * three route to the same /orders/{code}/review page, which renders the
 * correct mode itself using the same get_order_review flags -- this
 * component only decides the label, never the eligibility. `review` is
 * null when the status isn't completed (never fetched) or the fetch
 * failed; the latter fails safe by simply omitting the action rather than
 * guessing.
 */
export function BuyerOrderReviewSection({ orderPublicCode, status, review }: Props) {
  if (status !== "completed" || review === null) {
    return null;
  }

  if (review.reviewId === null && !review.canCreateReview) {
    return null;
  }

  const label = review.reviewId === null ? "Leave a review" : review.canEditReview ? "Edit review" : "View review";

  return (
    <div className="mt-4">
      <Link
        href={`/orders/${orderPublicCode}/review`}
        className="inline-flex h-11 items-center rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {label}
      </Link>
    </div>
  );
}
