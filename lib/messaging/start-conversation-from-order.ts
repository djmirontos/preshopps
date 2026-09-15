import { createClient } from "@/lib/supabase/client";

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
  | { ok: false; code: StartConversationFromOrderErrorCode | "UNKNOWN" };

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
      return { ok: false, code: toErrorCode((error as { details?: string }).details) };
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
