import Image from "next/image";
import { User } from "lucide-react";
import { StarRatingDisplay } from "@/components/reviews/StarRatingDisplay";
import { ReportButton } from "@/components/moderation/ReportButton";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import type { ShopReviewItem } from "@/lib/reviews/get-shop-reviews";

type Props = {
  review: ShopReviewItem;
  isAuthenticated: boolean;
  /** Safe internal path to return to after sign-in. */
  next: string;
};

/**
 * One review row on the shop page -- reviewer identity, rating, body,
 * purchased-item context, photos (if any), the seller's reply (visually
 * subordinate, indented in a muted panel) if present, and a restrained
 * Report affordance (PRD 31). get_shop_reviews (0034/0053) is
 * deliberately guest-safe and never returns buyer_id -- unlike
 * ListingActions/ShopReportAction's isOwnListing/isOwnShop, there is no
 * reviewer identity available client-side to compare against the viewer
 * and hide the action for one's own review; submit_report's own
 * SELF_REPORT_NOT_ALLOWED check (0067) remains the actual, authoritative
 * guard regardless, surfaced through the same friendly error message
 * ReportButton already shows for every other target type.
 */
export function ShopReviewCard({ review, isAuthenticated, next }: Props) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas">
          {review.buyerAvatarUrl ? (
            <Image src={review.buyerAvatarUrl} alt="" fill sizes="32px" className="object-cover" />
          ) : (
            <User className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{review.buyerDisplayName}</p>
          <p className="text-xs text-ink-muted">{formatOrderDate(review.createdAt)}</p>
        </div>
      </div>

      <div className="mt-2">
        <StarRatingDisplay rating={review.rating} />
      </div>

      {review.purchasedItemTitles.length > 0 && (
        <p className="mt-1.5 text-xs text-ink-muted">Purchased: {review.purchasedItemTitles.join(", ")}</p>
      )}

      {review.body && <p className="mt-2 text-sm text-ink">{review.body}</p>}

      {review.imageUrls.length > 0 && (
        <div className="mt-2.5 flex gap-2">
          {review.imageUrls.map((url) => (
            <span key={url} className="relative h-16 w-16 overflow-hidden rounded-[10px] bg-divider">
              <Image src={url} alt="" fill sizes="64px" className="object-contain" />
            </span>
          ))}
        </div>
      )}

      {review.replyBody && (
        <div className="mt-3 rounded-[10px] bg-canvas p-3">
          <p className="text-xs font-semibold text-ink-secondary">Seller reply</p>
          <p className="mt-1 text-sm text-ink">{review.replyBody}</p>
        </div>
      )}

      <ReportButton
        targetType="review"
        targetId={review.reviewId}
        targetLabel="review"
        isAuthenticated={isAuthenticated}
        next={next}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      />
    </div>
  );
}
