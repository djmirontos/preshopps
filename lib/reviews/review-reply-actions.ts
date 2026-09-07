import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrapper around the existing seller reply RPC
 * (upsert_review_reply, 0034_reviews_security_and_rpcs.sql). Handles both
 * first reply and edit -- the backend itself decides which based on whether
 * reply_created_at is already set; this wrapper never distinguishes them.
 * Seller identity (shop ownership) is always derived by the RPC from
 * auth.uid(); no shop/seller id is ever sent from the client. There is no
 * delete path -- none exists anywhere in the backend, per locked product
 * rule ("seller cannot delete reply").
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export type UpsertReviewReplyErrorCode =
  | "NOT_AUTHENTICATED"
  | "REVIEW_NOT_FOUND"
  | "NOT_REVIEW_SELLER"
  | "INTERACTION_BLOCKED"
  | "REPLY_EMPTY"
  | "REPLY_TOO_LONG"
  | "REPLY_EDIT_WINDOW_CLOSED";

const UPSERT_REVIEW_REPLY_ERROR_CODES: ReadonlySet<string> = new Set<UpsertReviewReplyErrorCode>([
  "NOT_AUTHENTICATED",
  "REVIEW_NOT_FOUND",
  "NOT_REVIEW_SELLER",
  "INTERACTION_BLOCKED",
  "REPLY_EMPTY",
  "REPLY_TOO_LONG",
  "REPLY_EDIT_WINDOW_CLOSED",
]);

export const UPSERT_REVIEW_REPLY_ERROR_MESSAGES: ErrorMap<UpsertReviewReplyErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  REVIEW_NOT_FOUND: "This review could not be found.",
  NOT_REVIEW_SELLER: "You don't have permission to reply to this review.",
  INTERACTION_BLOCKED: "You can't reply to this review right now.",
  REPLY_EMPTY: "Please write a reply before submitting.",
  REPLY_TOO_LONG: "Your reply is too long. Please shorten it to 1000 characters or fewer.",
  REPLY_EDIT_WINDOW_CLOSED: "The 7-day edit window for this reply has closed.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type UpsertReviewReplyResult =
  | { ok: true; reviewId: string; replyCreatedAt: string; replyUpdatedAt: string | null }
  | { ok: false; code: UpsertReviewReplyErrorCode | "UNKNOWN" };

type UpsertReviewReplyRpcRow = { review_id: string; reply_created_at: string; reply_updated_at: string | null };

export async function upsertReviewReply(reviewId: string, body: string): Promise<UpsertReviewReplyResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("upsert_review_reply", { p_review_id: reviewId, p_body: body });

    if (error) {
      console.error("upsert_review_reply RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<UpsertReviewReplyErrorCode>((error as { details?: string }).details, UPSERT_REVIEW_REPLY_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as UpsertReviewReplyRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, reviewId: row.review_id, replyCreatedAt: row.reply_created_at, replyUpdatedAt: row.reply_updated_at };
  } catch (err) {
    console.error("upsert_review_reply RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
