import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

/**
 * Row shape exactly matching public.get_order_review's RETURNS TABLE
 * (0047_review_order_context_rpc.sql). Dual-role: the caller must be either
 * the order's buyer or its shop's current owner, or the RPC returns zero
 * rows -- mirrored below as "not_found", identical to
 * get_conversation_context's own established privacy pattern.
 */
export type GetOrderReviewRow = {
  order_id: string;
  viewer_role: "buyer" | "seller";
  review_id: string | null;
  rating: number | null;
  body: string | null;
  image_paths: string[];
  review_created_at: string | null;
  review_updated_at: string | null;
  can_create_review: boolean;
  can_edit_review: boolean;
  reply_body: string | null;
  reply_created_at: string | null;
  reply_updated_at: string | null;
  can_write_reply: boolean;
};

export type OrderReview = {
  orderId: string;
  viewerRole: "buyer" | "seller";
  reviewId: string | null;
  rating: number | null;
  body: string | null;
  /** Raw, bucket-prefixed storage paths (review_images.storage_path) --
   * needed to resubmit unchanged images to update_review during an edit. */
  imagePaths: string[];
  /** Same images, resolved to public display URLs. */
  imageUrls: string[];
  createdAt: string | null;
  updatedAt: string | null;
  canCreateReview: boolean;
  canEditReview: boolean;
  replyBody: string | null;
  replyCreatedAt: string | null;
  replyUpdatedAt: string | null;
  canWriteReply: boolean;
};

export type OrderReviewResult = { status: "found"; review: OrderReview } | { status: "not_found" } | { status: "error" };

function mapRow(row: GetOrderReviewRow): OrderReview {
  return {
    orderId: row.order_id,
    viewerRole: row.viewer_role,
    reviewId: row.review_id,
    rating: row.rating,
    body: row.body,
    imagePaths: row.image_paths,
    imageUrls: row.image_paths.map(getListingImageUrl).filter((url): url is string => Boolean(url)),
    createdAt: row.review_created_at,
    updatedAt: row.review_updated_at,
    canCreateReview: row.can_create_review,
    canEditReview: row.can_edit_review,
    replyBody: row.reply_body,
    replyCreatedAt: row.reply_created_at,
    replyUpdatedAt: row.reply_updated_at,
    canWriteReply: row.can_write_reply,
  };
}

/**
 * An order the caller is neither the buyer nor the shop owner of, or a
 * nonexistent order id, both resolve to zero rows from get_order_review --
 * mapped identically to "not_found", exactly mirroring
 * get_conversation_context's established privacy pattern.
 */
export async function getOrderReview(orderId: string): Promise<OrderReviewResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_order_review", { p_order_id: orderId }));
  } catch (err) {
    console.error("get_order_review RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    console.error("get_order_review RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetOrderReviewRow[];
  if (rows.length === 0) {
    return { status: "not_found" };
  }

  return { status: "found", review: mapRow(rows[0]) };
}
