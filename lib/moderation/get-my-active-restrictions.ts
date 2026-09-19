import { getAuthUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * The three values of public.restriction_type_enum (0004_identity.sql) --
 * confirmed live, no drift since. Never invent a fourth.
 */
export type RestrictionType = "seller_suspended" | "buyer_restricted" | "account_suspended";

/**
 * Row shape exactly matching public.get_my_active_restrictions' RETURNS
 * TABLE (0096_restriction_visibility_notifications.sql). This RPC returns
 * only the caller's own currently-active (lifted_at IS NULL) restrictions --
 * no moderator identity, no lifted/audit fields, no other user's data.
 * Never widen this wrapper to call get_admin_user_restrictions or read
 * moderation_actions/user_restrictions directly -- get_my_active_restrictions
 * is the sole, already-privacy-checked source for a self-facing surface.
 */
type GetMyActiveRestrictionsRow = {
  restriction_id: string;
  restriction_type: RestrictionType;
  reason: string;
  created_at: string;
};

export type MyActiveRestriction = {
  restrictionId: string;
  restrictionType: RestrictionType;
  reason: string;
  createdAt: string;
};

export type GetMyActiveRestrictionsResult = {
  restrictions: MyActiveRestriction[];
  hadError: boolean;
};

function mapRow(row: GetMyActiveRestrictionsRow): MyActiveRestriction {
  return {
    restrictionId: row.restriction_id,
    restrictionType: row.restriction_type,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/**
 * Guards on getAuthUser() first, exactly like
 * getMyUnreadConversationCountServer's own convention, so a guest pageview
 * never issues a doomed-to-fail authenticated RPC call. On any RPC error,
 * fails open to an empty list (a display-only degrade, never a security
 * boundary -- actual enforcement remains server-side in every restriction-
 * gated RPC regardless of what this wrapper returns).
 */
export async function getMyActiveRestrictions(): Promise<GetMyActiveRestrictionsResult> {
  const user = await getAuthUser();
  if (!user) return { restrictions: [], hadError: false };

  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_active_restrictions"));
  } catch (err) {
    console.error("get_my_active_restrictions RPC threw:", err instanceof Error ? err.message : err);
    return { restrictions: [], hadError: true };
  }

  if (error) {
    console.error("get_my_active_restrictions RPC failed:", error.message);
    return { restrictions: [], hadError: true };
  }

  const rows = (data ?? []) as GetMyActiveRestrictionsRow[];
  return { restrictions: rows.map(mapRow), hadError: false };
}
