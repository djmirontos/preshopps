import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrapper around submit_report (0067) -- the four canonical
 * report targets PRD 31 lists (listing, seller/shop, review, message/
 * conversation), nothing more. Identity is always derived server-side from
 * auth.uid(); this wrapper never sends a reporter id.
 */

export type ReportTargetType = "listing" | "shop" | "review" | "conversation";

export type ReportReason = "scam_fraud" | "prohibited_item" | "misleading" | "harassment" | "spam" | "duplicate_spam" | "other";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  scam_fraud: "Scam/Fraud",
  prohibited_item: "Prohibited Item",
  misleading: "Misleading",
  harassment: "Harassment",
  spam: "Spam",
  duplicate_spam: "Duplicate/Spam",
  other: "Other",
};

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export type SubmitReportErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "TARGET_TYPE_INVALID"
  | "REPORT_DESCRIPTION_TOO_LONG"
  | "LISTING_NOT_FOUND"
  | "SHOP_NOT_FOUND"
  | "REVIEW_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "SELF_REPORT_NOT_ALLOWED"
  | "NOT_CONVERSATION_PARTICIPANT";

const SUBMIT_REPORT_ERROR_CODES: ReadonlySet<string> = new Set<SubmitReportErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "TARGET_TYPE_INVALID",
  "REPORT_DESCRIPTION_TOO_LONG",
  "LISTING_NOT_FOUND",
  "SHOP_NOT_FOUND",
  "REVIEW_NOT_FOUND",
  "CONVERSATION_NOT_FOUND",
  "SELF_REPORT_NOT_ALLOWED",
  "NOT_CONVERSATION_PARTICIPANT",
]);

export const SUBMIT_REPORT_ERROR_MESSAGES: ErrorMap<SubmitReportErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "Your account cannot submit reports right now.",
  TARGET_TYPE_INVALID: "That can't be reported right now. Please refresh and try again.",
  REPORT_DESCRIPTION_TOO_LONG: "Please shorten your description.",
  LISTING_NOT_FOUND: "We couldn't find this listing. Please refresh and try again.",
  SHOP_NOT_FOUND: "We couldn't find this shop. Please refresh and try again.",
  REVIEW_NOT_FOUND: "We couldn't find this review. Please refresh and try again.",
  CONVERSATION_NOT_FOUND: "We couldn't find this conversation. Please refresh and try again.",
  SELF_REPORT_NOT_ALLOWED: "You can't report your own content.",
  NOT_CONVERSATION_PARTICIPANT: "You're not a participant in this conversation.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type SubmitReportResult =
  | { ok: true; reportId: string; createdAt: string }
  | { ok: false; code: SubmitReportErrorCode | "UNKNOWN" };

type SubmitReportRpcRow = { report_id: string; created_at: string };

export async function submitReport(
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  description: string | null,
): Promise<SubmitReportResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("submit_report", {
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: reason,
      p_description: description,
    });

    if (error) {
      console.error("submit_report RPC failed:", error.message);
      return { ok: false, code: toErrorCode<SubmitReportErrorCode>((error as { details?: string }).details, SUBMIT_REPORT_ERROR_CODES) };
    }

    const row = ((data ?? []) as SubmitReportRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, reportId: row.report_id, createdAt: row.created_at };
  } catch (err) {
    console.error("submit_report RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
