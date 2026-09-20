import { createClient } from "@/lib/supabase/client";
import { interpretInteractionBlocked, type InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

/** The caller of start_conversation_from_order is always the seller/shop-
 * owner role -- confirmed directly against the RPC's own live definition
 * (0093): the buyer's own restriction check (buyer_restricted/
 * account_suspended) fires before the caller's own (seller_suspended/
 * account_suspended), so a confirmed match here is always a TRUE fact
 * about the caller, but is not guaranteed to be the proximate cause of
 * this specific denial whenever both participants happen to be
 * restricted at once -- an accepted, unavoidable limitation given the
 * RPC's own single generic INTERACTION_BLOCKED code, identical in kind to
 * every other messaging restriction surface in this codebase. buyer_
 * restricted is deliberately excluded: it describes the buyer (the other
 * participant), never the caller, and must never be looked up or shown
 * to a seller regardless of what restriction the seller happens to have. */
const SELLER_START_CONVERSATION_FROM_ORDER_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "seller_suspended"];

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

export type StartConversationFromOrderErrorCode =
  | "NOT_AUTHENTICATED"
  | "ORDER_NOT_FOUND"
  | "INTERACTION_BLOCKED"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "CONVERSATION_STATE_INVALID";

const START_CONVERSATION_FROM_ORDER_ERROR_CODES: ReadonlySet<string> = new Set<StartConversationFromOrderErrorCode>([
  "NOT_AUTHENTICATED",
  "ORDER_NOT_FOUND",
  "INTERACTION_BLOCKED",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "CONVERSATION_STATE_INVALID",
]);

/** Deliberately collapsed to three safe, generic buckets -- never reveals
 * which specific authorization/restriction/deletion condition applied,
 * matching the RPC's own single INTERACTION_BLOCKED code for every
 * blocking reason (caller deleted, buyer restricted, seller suspended,
 * mutual block, or a brand-new conversation targeting an anonymized
 * buyer) and ORDER_NOT_FOUND for every not-authorized-or-nonexistent
 * order outcome. */
export const START_CONVERSATION_FROM_ORDER_ERROR_MESSAGES: ErrorMap<StartConversationFromOrderErrorCode> = {
  NOT_AUTHENTICATED: "We couldn't open this conversation right now.",
  ORDER_NOT_FOUND: "We couldn't open this conversation right now.",
  INTERACTION_BLOCKED: "You can't message this buyer right now.",
  MESSAGE_EMPTY: "Please enter a message.",
  MESSAGE_TOO_LONG: "Messages can be up to 4000 characters.",
  CONVERSATION_STATE_INVALID: "Something went wrong. Please try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type StartConversationFromOrderResult =
  | { ok: true; conversationId: string; messageId: string; createdAt: string; conversationCreated: boolean }
  | {
      ok: false;
      code: StartConversationFromOrderErrorCode | "UNKNOWN";
      /** Populated only when code is INTERACTION_BLOCKED and the caller's
       * own current restriction state confirms account_suspended or
       * seller_suspended -- see interpretInteractionBlocked. Absent for
       * every other code, for an unrelated buyer-restriction/deleted-
       * buyer/block collision, or when the lookup itself fails; the
       * existing generic START_CONVERSATION_FROM_ORDER_ERROR_MESSAGES copy
       * is the fallback in all of those cases. */
      restriction?: InteractionBlockedPresentation;
    };

type StartConversationFromOrderRpcRow = {
  conversation_id: string;
  message_id: string;
  message_created_at: string;
  conversation_created: boolean;
};

/**
 * Thin client wrapper around the new public.start_conversation_from_order
 * RPC (0093) -- the seller's first/next real message to the buyer of one
 * of their own orders. Only order_public_code + body are ever sent; the
 * buyer is derived entirely server-side from the authorized order and
 * never appears in this module, in either direction. Always pairs any
 * newly created conversation with this real message -- there is no
 * "create an empty conversation" call shape here at all.
 */
export async function startConversationFromOrder(orderPublicCode: string, body: string): Promise<StartConversationFromOrderResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("start_conversation_from_order", {
      p_order_public_code: orderPublicCode,
      p_body: body,
    });

    if (error) {
      console.error("start_conversation_from_order RPC failed:", error.message);
      const code = toErrorCode((error as { details?: string }).details);
      const restriction = await interpretInteractionBlocked(code, SELLER_START_CONVERSATION_FROM_ORDER_RELEVANT_RESTRICTIONS);
      return restriction ? { ok: false, code, restriction } : { ok: false, code };
    }

    const row = ((data ?? []) as StartConversationFromOrderRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return {
      ok: true,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      createdAt: row.message_created_at,
      conversationCreated: row.conversation_created,
    };
  } catch (err) {
    console.error("start_conversation_from_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

function toErrorCode(detail: string | undefined): StartConversationFromOrderErrorCode | "UNKNOWN" {
  return detail && START_CONVERSATION_FROM_ORDER_ERROR_CODES.has(detail) ? (detail as StartConversationFromOrderErrorCode) : "UNKNOWN";
}
