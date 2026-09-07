import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

/**
 * Row shape exactly matching public.get_shop_reviews' RETURNS TABLE
 * (0034_reviews_security_and_rpcs.sql). Public/guest-safe -- never returns
 * order_id or buyer_id. buyer_display_name/buyer_avatar_storage_path are
 * already anonymized server-side to "Deleted user"/null when the reviewer's
 * profile is soft-deleted; this module does not re-derive that.
 */
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
 * Cursor pagination on (created_at, id) DESC, matching every other list in
 * this schema -- get_shop_reviews (0034) already implements the keyset
 * itself; this is a plain pass-through, no OFFSET. Guest-safe: never
 * requires an authenticated caller.
 */
export async function getShopReviews(shopId: string, limit: number, cursor?: ShopReviewsCursor): Promise<GetShopReviewsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_shop_reviews", {
      p_shop_id: shopId,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
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
  const nextCursor = rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].review_id } : null;

  return { reviews, hadError: false, nextCursor };
}
