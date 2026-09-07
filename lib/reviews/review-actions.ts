import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrappers around the existing buyer review RPCs (create_review,
 * update_review -- both from 0034_reviews_security_and_rpcs.sql). No new
 * write RPC is introduced here -- this module only calls each function and
 * maps its own `detail` error code (read directly from its migration
 * source) to safe, non-technical copy. Buyer identity is always derived by
 * the RPC from auth.uid(); no buyer/shop id is ever sent from the client.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// createReview (create_review)
// ============================================================

export type CreateReviewErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "ORDER_NOT_FOUND"
  | "NOT_ORDER_BUYER"
  | "ORDER_NOT_REVIEWABLE"
  | "REVIEW_ALREADY_EXISTS"
  | "RATING_INVALID"
  | "REVIEW_BODY_TOO_LONG"
  | "TOO_MANY_REVIEW_IMAGES"
  | "REVIEW_IMAGE_PATH_INVALID";

const CREATE_REVIEW_ERROR_CODES: ReadonlySet<string> = new Set<CreateReviewErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_BUYER",
  "ORDER_NOT_REVIEWABLE",
  "REVIEW_ALREADY_EXISTS",
  "RATING_INVALID",
  "REVIEW_BODY_TOO_LONG",
  "TOO_MANY_REVIEW_IMAGES",
  "REVIEW_IMAGE_PATH_INVALID",
]);

export const CREATE_REVIEW_ERROR_MESSAGES: ErrorMap<CreateReviewErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "You can't review this seller right now.",
  ORDER_NOT_FOUND: "This order could not be found.",
  NOT_ORDER_BUYER: "You don't have permission to review this order.",
  ORDER_NOT_REVIEWABLE: "This order isn't eligible for a review.",
  REVIEW_ALREADY_EXISTS: "You've already reviewed this order.",
  RATING_INVALID: "Please choose a star rating from 1 to 5.",
  REVIEW_BODY_TOO_LONG: "Your review is too long. Please shorten it to 1000 characters or fewer.",
  TOO_MANY_REVIEW_IMAGES: "A review can have at most 2 photos.",
  REVIEW_IMAGE_PATH_INVALID: "One of your review photos couldn't be attached. Please try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type CreateReviewResult =
  | { ok: true; reviewId: string; createdAt: string }
  | { ok: false; code: CreateReviewErrorCode | "UNKNOWN" };

type CreateReviewRpcRow = { review_id: string; created_at: string };

export async function createReview(
  orderId: string,
  rating: number,
  body: string | null,
  imagePaths: string[] = [],
): Promise<CreateReviewResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("create_review", {
      p_order_id: orderId,
      p_rating: rating,
      p_body: body,
      p_image_paths: imagePaths,
    });

    if (error) {
      console.error("create_review RPC failed:", error.message);
      return { ok: false, code: toErrorCode<CreateReviewErrorCode>((error as { details?: string }).details, CREATE_REVIEW_ERROR_CODES) };
    }

    const row = ((data ?? []) as CreateReviewRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, reviewId: row.review_id, createdAt: row.created_at };
  } catch (err) {
    console.error("create_review RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// updateReview (update_review)
// ============================================================

export type UpdateReviewErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "REVIEW_NOT_FOUND"
  | "NOT_REVIEW_AUTHOR"
  | "REVIEW_EDIT_WINDOW_CLOSED"
  | "RATING_INVALID"
  | "REVIEW_BODY_TOO_LONG"
  | "TOO_MANY_REVIEW_IMAGES"
  | "REVIEW_IMAGE_PATH_INVALID";

const UPDATE_REVIEW_ERROR_CODES: ReadonlySet<string> = new Set<UpdateReviewErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "REVIEW_NOT_FOUND",
  "NOT_REVIEW_AUTHOR",
  "REVIEW_EDIT_WINDOW_CLOSED",
  "RATING_INVALID",
  "REVIEW_BODY_TOO_LONG",
  "TOO_MANY_REVIEW_IMAGES",
  "REVIEW_IMAGE_PATH_INVALID",
]);

export const UPDATE_REVIEW_ERROR_MESSAGES: ErrorMap<UpdateReviewErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "You can't edit this review right now.",
  REVIEW_NOT_FOUND: "This review could not be found.",
  NOT_REVIEW_AUTHOR: "You don't have permission to edit this review.",
  REVIEW_EDIT_WINDOW_CLOSED: "The 7-day edit window for this review has closed.",
  RATING_INVALID: "Please choose a star rating from 1 to 5.",
  REVIEW_BODY_TOO_LONG: "Your review is too long. Please shorten it to 1000 characters or fewer.",
  TOO_MANY_REVIEW_IMAGES: "A review can have at most 2 photos.",
  REVIEW_IMAGE_PATH_INVALID: "One of your review photos couldn't be attached. Please try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type UpdateReviewResult =
  | { ok: true; reviewId: string; updatedAt: string }
  | { ok: false; code: UpdateReviewErrorCode | "UNKNOWN" };

type UpdateReviewRpcRow = { review_id: string; updated_at: string };

export async function updateReview(
  reviewId: string,
  rating: number,
  body: string | null,
  imagePaths: string[] = [],
): Promise<UpdateReviewResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("update_review", {
      p_review_id: reviewId,
      p_rating: rating,
      p_body: body,
      p_image_paths: imagePaths,
    });

    if (error) {
      console.error("update_review RPC failed:", error.message);
      return { ok: false, code: toErrorCode<UpdateReviewErrorCode>((error as { details?: string }).details, UPDATE_REVIEW_ERROR_CODES) };
    }

    const row = ((data ?? []) as UpdateReviewRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, reviewId: row.review_id, updatedAt: row.updated_at };
  } catch (err) {
    console.error("update_review RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
