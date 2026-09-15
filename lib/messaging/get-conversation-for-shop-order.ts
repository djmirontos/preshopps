import { createClient } from "@/lib/supabase/client";

const GENERIC_ERROR_MESSAGE = "We couldn't open this conversation right now.";

export type GetConversationForShopOrderResult =
  | { ok: true; conversationId: string | null }
  | { ok: false; error: string };

type GetConversationForShopOrderRpcRow = { conversation_id: string };

/**
 * Thin client wrapper around the new public.get_conversation_for_shop_order
 * RPC (0093) -- a pure lookup, never a write. Only the seller's own
 * order_public_code is ever sent; the buyer is resolved entirely inside
 * the RPC and never appears in this module at all, in either direction.
 * `conversationId: null` means "no GENERAL conversation exists for this
 * order's buyer yet" -- this is a normal, expected outcome, not an error.
 */
export async function getConversationForShopOrder(orderPublicCode: string): Promise<GetConversationForShopOrderResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_conversation_for_shop_order", {
      p_order_public_code: orderPublicCode,
    });

    if (error) {
      console.error("get_conversation_for_shop_order RPC failed:", error.message);
      return { ok: false, error: GENERIC_ERROR_MESSAGE };
    }

    const row = ((data ?? []) as GetConversationForShopOrderRpcRow[])[0];
    return { ok: true, conversationId: row ? row.conversation_id : null };
  } catch (err) {
    console.error("get_conversation_for_shop_order RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
}
