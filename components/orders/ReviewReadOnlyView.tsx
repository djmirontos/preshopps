import Image from "next/image";
import { StarRatingDisplay } from "@/components/reviews/StarRatingDisplay";
import { formatOrderDate } from "@/lib/orders/format-order-date";

type Props = {
  rating: number;
  body: string | null;
  createdAt: string;
  purchasedItemTitles: string[];
  replyBody: string | null;
  imageUrls: string[];
};

/** Read-only rendering for a review whose 7-day buyer edit window has
 * closed -- "View review" lands here rather than on the editable form. */
export function ReviewReadOnlyView({ rating, body, createdAt, purchasedItemTitles, replyBody, imageUrls }: Props) {
  return (
    <div className="mt-6 rounded-[14px] border border-border bg-surface p-4">
      {purchasedItemTitles.length > 0 && <p className="text-xs text-ink-muted">You bought {purchasedItemTitles.join(", ")}</p>}
      <div className="mt-2 flex items-center gap-2">
        <StarRatingDisplay rating={rating} size="md" />
        <span className="text-xs text-ink-muted">{formatOrderDate(createdAt)}</span>
      </div>
      {body && <p className="mt-3 text-sm text-ink">{body}</p>}

      {imageUrls.length > 0 && (
        <div className="mt-3 flex gap-2">
          {imageUrls.map((url) => (
            <span key={url} className="relative h-20 w-20 overflow-hidden rounded-[10px] bg-canvas">
              <Image src={url} alt="" fill sizes="80px" className="object-contain" />
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-muted">The 7-day edit window for this review has closed.</p>

      {replyBody && (
        <div className="mt-4 rounded-[10px] bg-canvas p-3">
          <p className="text-xs font-semibold text-ink-secondary">Seller reply</p>
          <p className="mt-1 text-sm text-ink">{replyBody}</p>
        </div>
      )}
    </div>
  );
}
