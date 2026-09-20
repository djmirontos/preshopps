import { createClient } from "@/lib/supabase/client";
import { interpretInteractionBlocked, type InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

/**
 * Thin client wrapper around the existing public.start_conversation RPC
 * (0031/0032, unchanged by this module). Used both to start a genuinely
 * new conversation and to send the next message in an existing one --
 * start_conversation itself finds-or-creates the logical thread and always
 * inserts p_body as a real message, so "Message Seller"/"Message Shop"
 * always simply calls this with whatever the buyer typed; there is no
 * separate "peek if a conversation already exists" step; none is possible
 * without also sending a message, per this RPC's own locked design. No
 * client-supplied initiator/sender id -- auth.uid() is the sole identity
 * source inside the RPC.
 */

/** The caller of start_conversation is always the buyer/initiator role --
 * confirmed directly against the RPC's own live definition (0040): its own
 * restriction check (account_suspended/buyer_restricted on auth.uid()
 * itself) fires before the separate, never-surfaced check against the
 * shop owner (seller_suspended/account_suspended) -- so a confirmed match
 * here is always the true cause, never a misattributed guess. seller_
 * suspended is deliberately excluded: it describes the seller (the other
 * participant), never the caller, and must never be looked up or shown
 * to a buyer regardless of what restriction the buyer happens to have. */
const BUYER_START_CONVERSATION_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "buyer_restricted"];

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

export type StartConversationErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "SHOP_NOT_FOUND"
  | "LISTING_NOT_FOUND"
  | "CANNOT_MESSAGE_OWN_SHOP"
  | "LISTING_NOT_MESSAGEABLE"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "CONVERSATION_STATE_INVALID";

const START_CONVERSATION_ERROR_CODES: ReadonlySet<string> = new Set<StartConversationErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "SHOP_NOT_FOUND",
  "LISTING_NOT_FOUND",
  "CANNOT_MESSAGE_OWN_SHOP",
  "LISTING_NOT_MESSAGEABLE",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "CONVERSATION_STATE_INVALID",
]);

export const START_CONVERSATION_ERROR_MESSAGES: ErrorMap<StartConversationErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "You can't message this seller right now.",
  SHOP_NOT_FOUND: "This shop could not be found.",
  LISTING_NOT_FOUND: "This listing could not be found.",
  CANNOT_MESSAGE_OWN_SHOP: "You can't message your own shop.",
  LISTING_NOT_MESSAGEABLE: "This listing is no longer available to message about.",
  MESSAGE_EMPTY: "Please enter a message.",
  MESSAGE_TOO_LONG: "Messages can be up to 4000 characters.",
  CONVERSATION_STATE_INVALID: "Something went wrong. Please try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type StartConversationResult =
  | { ok: true; conversationId: string; conversationCreated: boolean }
  | {
      ok: false;
      code: StartConversationErrorCode | "UNKNOWN";
      /** Populated only when code is INTERACTION_BLOCKED and the caller's
       * own current restriction state confirms account_suspended or
       * buyer_restricted -- see interpretInteractionBlocked. Absent for
       * every other code, for an unrelated seller-restriction/deleted-
       * seller/block collision, or when the lookup itself fails; the
       * existing generic START_CONVERSATION_ERROR_MESSAGES copy is the
       * fallback in all of those cases. */
      restriction?: InteractionBlockedPresentation;
    };

type StartConversationRpcRow = {
  conversation_id: string;
  message_id: string;
  message_created_at: string;
  conversation_created: boolean;
};

export async function startConversation(shopId: string, body: string, listingId?: string): Promise<StartConversationResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("start_conversation", {
      p_shop_id: shopId,
      p_body: body,
      p_listing_id: listingId ?? null,
    });

    if (error) {
      console.error("start_conversation RPC failed:", error.message);
      const code = toErrorCode((error as { details?: string }).details);
      const restriction = await interpretInteractionBlocked(code, BUYER_START_CONVERSATION_RELEVANT_RESTRICTIONS);
      return restriction ? { ok: false, code, restriction } : { ok: false, code };
    }

    const row = ((data ?? []) as StartConversationRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, conversationId: row.conversation_id, conversationCreated: row.conversation_created };
  } catch (err) {
    console.error("start_conversation RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

function toErrorCode(detail: string | undefined): StartConversationErrorCode | "UNKNOWN" {
  return detail && START_CONVERSATION_ERROR_CODES.has(detail) ? (detail as StartConversationErrorCode) : "UNKNOWN";
}
