import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrapper around create_dispute (0074). Identity is always
 * derived server-side from auth.uid(); this wrapper never sends a buyer/
 * seller/user id of any kind. Image paths are already-uploaded storage
 * paths (DisputeImagePicker), never raw files.
 */

export type CreateDisputeErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "ORDER_NOT_FOUND"
  | "NOT_ORDER_PARTICIPANT"
  | "ORDER_NOT_DISPUTABLE"
  | "DISPUTE_ALREADY_ACTIVE"
  | "DISPUTE_REASON_REQUIRED"
  | "DISPUTE_REASON_TOO_LONG"
  | "DISPUTE_EXPLANATION_REQUIRED"
  | "DISPUTE_EXPLANATION_TOO_LONG"
  | "TOO_MANY_DISPUTE_IMAGES"
  | "DISPUTE_IMAGE_PATH_INVALID";

const CREATE_DISPUTE_ERROR_CODES: ReadonlySet<string> = new Set<CreateDisputeErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "ORDER_NOT_FOUND",
  "NOT_ORDER_PARTICIPANT",
  "ORDER_NOT_DISPUTABLE",
  "DISPUTE_ALREADY_ACTIVE",
  "DISPUTE_REASON_REQUIRED",
  "DISPUTE_REASON_TOO_LONG",
  "DISPUTE_EXPLANATION_REQUIRED",
  "DISPUTE_EXPLANATION_TOO_LONG",
  "TOO_MANY_DISPUTE_IMAGES",
  "DISPUTE_IMAGE_PATH_INVALID",
]);

export const CREATE_DISPUTE_ERROR_MESSAGES: Record<CreateDisputeErrorCode | "UNKNOWN", string> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "Your account cannot do this right now.",
  ORDER_NOT_FOUND: "We couldn't find this order. Please refresh and try again.",
  NOT_ORDER_PARTICIPANT: "You don't have permission to open a dispute on this order.",
  ORDER_NOT_DISPUTABLE: "This order can't be disputed right now.",
  DISPUTE_ALREADY_ACTIVE: "A dispute is already open for this order.",
  DISPUTE_REASON_REQUIRED: "Please enter a reason.",
  DISPUTE_REASON_TOO_LONG: "Please shorten the reason.",
  DISPUTE_EXPLANATION_REQUIRED: "Please enter an explanation.",
  DISPUTE_EXPLANATION_TOO_LONG: "Please shorten the explanation.",
  TOO_MANY_DISPUTE_IMAGES: "You can include at most 3 photos.",
  DISPUTE_IMAGE_PATH_INVALID: "One of the selected photos couldn't be used. Please remove and retry it.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type CreateDisputeResult =
  | { ok: true; disputeId: string; createdAt: string }
  | { ok: false; code: CreateDisputeErrorCode | "UNKNOWN" };

type CreateDisputeRpcRow = { dispute_id: string; created_at: string };

export async function createDispute(
  orderId: string,
  reason: string,
  explanation: string,
  imagePaths: string[],
): Promise<CreateDisputeResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("create_dispute", {
      p_order_id: orderId,
      p_reason: reason,
      p_explanation: explanation,
      p_image_paths: imagePaths,
    });

    if (error) {
      console.error("create_dispute RPC failed:", error.message);
      const detail = (error as { details?: string }).details;
      const code = detail && CREATE_DISPUTE_ERROR_CODES.has(detail) ? (detail as CreateDisputeErrorCode) : "UNKNOWN";
      return { ok: false, code };
    }

    const row = ((data ?? []) as CreateDisputeRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, disputeId: row.dispute_id, createdAt: row.created_at };
  } catch (err) {
    console.error("create_dispute RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
