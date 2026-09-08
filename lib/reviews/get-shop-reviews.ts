import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

/**
 * Row shape exactly matching public.get_shop_reviews' RETURNS TABLE
 * (0034_reviews_security_and_rpcs.sql, rating filter/sort params added by
 * 0053_shop_reviews_rating_filter_and_sort.sql -- RETURNS TABLE shape
 * itself is unchanged). Public/guest-safe -- never returns order_id or
 * buyer_id. buyer_display_name/buyer_avatar_storage_path are already
 * anonymized server-side to "Deleted user"/null when the reviewer's profile
 * is soft-deleted; this module does not re-derive that.
 */

/** null = "All" (PRD 26.8), matching get_shop_reviews' own p_rating_filter default. */
export type ReviewRatingFilter = 1 | 2 | 3 | 4 | 5 | null;

/** Matches get_shop_reviews' p_sort_mode values exactly ("newest" is its default). */
export type ReviewSortMode = "newest" | "highest_rating";
export type GetShopReviewsRow = {
  review_id: string;
  rating: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  buyer_display_name: string;
  buyer_avatar_storage_path: string | null;
  reply_body: string | null;
  reply_created_at: string | null;
  reply_updated_at: string | null;
  image_paths: string[];
  purchased_item_titles: string[];
};

export type ShopReviewItem = {
  reviewId: string;
  rating: number;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  buyerDisplayName: string;
  buyerAvatarUrl: string | undefined;
  replyBody: string | null;
  replyCreatedAt: string | null;
  replyUpdatedAt: string | null;
  imageUrls: string[];
  purchasedItemTitles: string[];
};

export type ShopReviewsCursor = {
  createdAt: string;
  id: string;
  /** Needed only for sortMode "highest_rating"'s keyset cursor
   * (p_before_rating); harmlessly ignored server-side in "newest" mode, so
   * the cursor shape stays the same across a sort-mode switch. */
  rating: number;
};

export type GetShopReviewsResult = {
  reviews: ShopReviewItem[];
  hadError: boolean;
  nextCursor: ShopReviewsCursor | null;
};

function mapRow(row: GetShopReviewsRow): ShopReviewItem {
  return {
    reviewId: row.review_id,
    rating: row.rating,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    buyerDisplayName: row.buyer_display_name,
    buyerAvatarUrl: getListingImageUrl(row.buyer_avatar_storage_path),
    replyBody: row.reply_body,
    replyCreatedAt: row.reply_created_at,
    replyUpdatedAt: row.reply_updated_at,
    imageUrls: row.image_paths.map(getListingImageUrl).filter((url): url is string => Boolean(url)),
    purchasedItemTitles: row.purchased_item_titles,
  };
}

/**
 * Cursor pagination keyed on (created_at, id) DESC for sortMode "newest", or
 * (rating, created_at, id) DESC for "highest_rating" -- get_shop_reviews
 * (0034, extended by 0053) already implements both keysets itself; this is
 * a plain pass-through, no OFFSET. ratingFilter/sortMode default to "All"/
 * "newest", reproducing pre-0053 behavior exactly for any caller that omits
 * them. Guest-safe: never requires an authenticated caller.
 */
export async function getShopReviews(
  shopId: string,
  limit: number,
  cursor?: ShopReviewsCursor,
  ratingFilter: ReviewRatingFilter = null,
  sortMode: ReviewSortMode = "newest",
): Promise<GetShopReviewsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_shop_reviews", {
      p_shop_id: shopId,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_rating_filter: ratingFilter,
      p_sort_mode: sortMode,
      p_before_rating: cursor?.rating ?? null,
    }));
  } catch (err) {
    console.error("get_shop_reviews RPC threw:", err instanceof Error ? err.message : err);
    return { reviews: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_shop_reviews RPC failed:", error.message);
    return { reviews: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetShopReviewsRow[];
  const reviews = rows.map(mapRow);
  const nextCursor =
    rows.length === limit
      ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].review_id, rating: rows[rows.length - 1].rating }
      : null;

  return { reviews, hadError: false, nextCursor };
}
