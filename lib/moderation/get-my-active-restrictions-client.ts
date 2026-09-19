import { createClient } from "@/lib/supabase/client";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

/**
 * Row shape exactly matching public.get_my_active_restrictions' RETURNS
 * TABLE (0096_restriction_visibility_notifications.sql) -- same RPC as
 * lib/moderation/get-my-active-restrictions.ts (server), called here with
 * the browser Supabase client instead. Kept as a separate module rather
 * than sharing one function body, per this codebase's own convention of
 * never mixing server-only and browser-only client construction in one
 * file (see lib/messaging/get-my-unread-conversation-count.ts vs its
 * -server.ts counterpart).
 */
type GetMyActiveRestrictionsRow = {
  restriction_id: string;
  restriction_type: RestrictionType;
  reason: string;
  created_at: string;
};

export type MyActiveRestrictionClient = {
  restrictionId: string;
  restrictionType: RestrictionType;
  reason: string;
  createdAt: string;
};

export type GetMyActiveRestrictionsClientResult =
  | { ok: true; restrictions: MyActiveRestrictionClient[] }
  | { ok: false };

function mapRow(row: GetMyActiveRestrictionsRow): MyActiveRestrictionClient {
  return {
    restrictionId: row.restriction_id,
    restrictionType: row.restriction_type,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/**
 * Browser-client counterpart to getMyActiveRestrictions (server). No
 * getAuthUser() pre-guard -- this is only ever invoked from an
 * already-authenticated action's own error path (e.g. after a real
 * INTERACTION_BLOCKED from submit_cart_order), never speculatively, so
 * there is no guest pageview to guard against, matching
 * getMyUnreadConversationCount's own browser-side convention. Fails open
 * (never throws) on any RPC error -- a display-only degrade; the backend
 * remains the sole enforcement authority regardless of what this returns.
 */
export async function getMyActiveRestrictionsClient(): Promise<GetMyActiveRestrictionsClientResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_active_restrictions");

    if (error) {
      console.error("get_my_active_restrictions RPC failed:", error.message);
      return { ok: false };
    }

    const rows = (data ?? []) as GetMyActiveRestrictionsRow[];
    return { ok: true, restrictions: rows.map(mapRow) };
  } catch (err) {
    console.error("get_my_active_restrictions RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
