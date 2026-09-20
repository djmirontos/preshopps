import { createClient } from "@/lib/supabase/client";
import { interpretInteractionBlocked, type InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

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

/** upsert_review_reply's own live definition (0040) checks mutual block
 * (both directions) BEFORE the caller's own restriction check -- so when a
 * block and a caller restriction both exist, the block can be the actual
 * proximate cause of this specific INTERACTION_BLOCKED even though the
 * post-error self-lookup below still confirms a real, currently-active
 * restriction on the caller. The confirmed restriction is always a true
 * fact about the caller's own current status; it is never treated as proof
 * of which check inside the RPC actually fired for this attempt. Copy
 * derived from this array must stay self-facing and non-causal for exactly
 * that reason. buyer_restricted is deliberately excluded: upsert_review_
 * reply never checks the buyer's own restriction at all (a locked, seller-
 * only check per the RPC's own comment), so it is never relevant here and
 * must never be looked up or shown to a seller. */
const SELLER_REVIEW_REPLY_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "seller_suspended"];

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
  | {
      ok: false;
      code: UpsertReviewReplyErrorCode | "UNKNOWN";
      /** Populated only when code is INTERACTION_BLOCKED and the caller's
       * own current restriction state confirms account_suspended or
       * seller_suspended -- see interpretInteractionBlocked and this
       * module's own header comment on SELLER_REVIEW_REPLY_RELEVANT_
       * RESTRICTIONS for why this is a true self-status fact, never proof
       * of causation. Absent for every other code, for a mutual-block-only
       * collision, or when the lookup itself fails; the existing generic
       * UPSERT_REVIEW_REPLY_ERROR_MESSAGES copy is the fallback in all of
       * those cases. */
      restriction?: InteractionBlockedPresentation;
    };

type UpsertReviewReplyRpcRow = { review_id: string; reply_created_at: string; reply_updated_at: string | null };

export async function upsertReviewReply(reviewId: string, body: string): Promise<UpsertReviewReplyResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("upsert_review_reply", { p_review_id: reviewId, p_body: body });

    if (error) {
      console.error("upsert_review_reply RPC failed:", error.message);
      const code = toErrorCode<UpsertReviewReplyErrorCode>((error as { details?: string }).details, UPSERT_REVIEW_REPLY_ERROR_CODES);
      const restriction = await interpretInteractionBlocked(code, SELLER_REVIEW_REPLY_RELEVANT_RESTRICTIONS);
      return restriction ? { ok: false, code, restriction } : { ok: false, code };
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
