import { createClient } from "@/lib/supabase/client";
import { interpretInteractionBlocked, type InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

/** send_message's own live definition (0040) always checks the buyer/
 * initiator's restrictions BEFORE the seller/shop-owner's, regardless of
 * which role the caller is -- so a confirmed match here is the guaranteed,
 * sole cause when the caller is the buyer (their own check always fires
 * first), but is only a TRUE FACT about the caller -- not a guaranteed
 * cause -- when the caller is the seller, since the buyer's own check may
 * already have fired first and is invisible here. Either way, this never
 * looks up or reveals the OTHER participant's restrictions, and the
 * resulting copy never claims causation, only the caller's own status. */
const BUYER_SEND_MESSAGE_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "buyer_restricted"];
const SELLER_SEND_MESSAGE_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "seller_suspended"];

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

export type SendMessageErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "CONVERSATION_NOT_FOUND"
  | "NOT_CONVERSATION_PARTICIPANT"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "CONVERSATION_STATE_INVALID";

const SEND_MESSAGE_ERROR_CODES: ReadonlySet<string> = new Set<SendMessageErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "CONVERSATION_NOT_FOUND",
  "NOT_CONVERSATION_PARTICIPANT",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "CONVERSATION_STATE_INVALID",
]);

export const SEND_MESSAGE_ERROR_MESSAGES: ErrorMap<SendMessageErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "You can't send messages in this conversation.",
  CONVERSATION_NOT_FOUND: "This conversation could not be found.",
  NOT_CONVERSATION_PARTICIPANT: "You don't have permission to send messages here.",
  MESSAGE_EMPTY: "Please enter a message.",
  MESSAGE_TOO_LONG: "Messages can be up to 4000 characters.",
  CONVERSATION_STATE_INVALID: "Something went wrong. Please try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type SendMessageResult =
  | { ok: true; messageId: string; createdAt: string }
  | {
      ok: false;
      code: SendMessageErrorCode | "UNKNOWN";
      /** Populated only when code is INTERACTION_BLOCKED and the caller's
       * own current restriction state confirms a type relevant to their
       * viewerRole -- see interpretInteractionBlocked. Absent for every
       * other code, for an unrelated other-participant-restriction/block
       * collision, or when the lookup itself fails; the existing generic
       * SEND_MESSAGE_ERROR_MESSAGES copy is the fallback in all of those
       * cases. */
      restriction?: InteractionBlockedPresentation;
    };

type SendMessageRpcRow = { message_id: string; conversation_id: string; message_created_at: string };

/**
 * Thin client wrapper around the existing public.send_message RPC (0031,
 * unchanged). Only conversation_id + body are ever sent -- sender is
 * derived from auth.uid() inside the RPC, never supplied by the client.
 *
 * viewerRole is presentation context only, supplied by the caller from
 * the server-derived, already-authoritative ConversationContext.viewerRole
 * -- it is never sent to the RPC and never used to authorize anything; it
 * only selects which of the caller's own restriction types is relevant to
 * interpret a generic INTERACTION_BLOCKED failure. The RPC remains the
 * sole enforcement authority regardless of what this argument is.
 */
export async function sendMessage(conversationId: string, body: string, viewerRole: "initiator" | "seller"): Promise<SendMessageResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("send_message", {
      p_conversation_id: conversationId,
      p_body: body,
    });

    if (error) {
      console.error("send_message RPC failed:", error.message);
      const code = toErrorCode((error as { details?: string }).details);
      const relevantRestrictions = viewerRole === "seller" ? SELLER_SEND_MESSAGE_RELEVANT_RESTRICTIONS : BUYER_SEND_MESSAGE_RELEVANT_RESTRICTIONS;
      const restriction = await interpretInteractionBlocked(code, relevantRestrictions);
      return restriction ? { ok: false, code, restriction } : { ok: false, code };
    }

    const row = ((data ?? []) as SendMessageRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, messageId: row.message_id, createdAt: row.message_created_at };
  } catch (err) {
    console.error("send_message RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

function toErrorCode(detail: string | undefined): SendMessageErrorCode | "UNKNOWN" {
  return detail && SEND_MESSAGE_ERROR_CODES.has(detail) ? (detail as SendMessageErrorCode) : "UNKNOWN";
}
