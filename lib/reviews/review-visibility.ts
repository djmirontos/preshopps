import type { OrderReviewRemovalResult } from "@/lib/reviews/get-order-review-removal";

/**
 * What a page may state about a review's visibility. Pure: no server-only
 * imports, so pages and their tests can use it directly.
 *
 * Only a validated reader success yields "visible" or "removed". A reader
 * error, a zero-row result for an order that has a review, or anything
 * malformed yields "unknown", which must never be rendered as visible. The
 * server-side edit and reply guards in get_order_review do not depend on this
 * value.
 */
export type ReviewVisibility = "visible" | "removed" | "unknown";

export function reviewVisibilityFromRemovalResult(result: OrderReviewRemovalResult): ReviewVisibility {
  if (result.status !== "found") return "unknown";
  return result.removal.isRemoved ? "removed" : "visible";
}
