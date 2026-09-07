import { Star } from "lucide-react";

type Props = {
  rating: number;
  size?: "sm" | "md";
};

/**
 * Read-only star rating -- used everywhere a review's own rating is shown
 * (shop review list, buyer's own review, seller's read-only view). The
 * rating is announced as text (role="img" + aria-label), never conveyed by
 * fill color alone.
 */
export function StarRatingDisplay({ rating, size = "sm" }: Props) {
  const starSize = size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((position) => (
        <Star
          key={position}
          aria-hidden="true"
          className={`${starSize} ${position <= rating ? "fill-current text-brand-link" : "text-divider"}`}
        />
      ))}
    </span>
  );
}
