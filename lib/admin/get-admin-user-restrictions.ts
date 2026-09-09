import { createClient } from "@/lib/supabase/server";

export type RestrictionType = "seller_suspended" | "buyer_restricted" | "account_suspended";

/**
 * Row shape exactly matching public.get_admin_user_restrictions'
 * RETURNS TABLE (0067_moderation_admin_rpcs.sql).
 */
export type GetAdminUserRestrictionsRow = {
  restriction_id: string;
  restriction_type: RestrictionType;
  reason: string;
  issued_by: string;
  issued_by_display_name: string;
  created_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
  lifted_by_display_name: string | null;
};

export type AdminUserRestriction = {
  restrictionId: string;
  restrictionType: RestrictionType;
  reason: string;
  issuedBy: string;
  issuedByDisplayName: string;
  createdAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
  liftedByDisplayName: string | null;
};

export type GetAdminUserRestrictionsResult =
  | { status: "found"; restrictions: AdminUserRestriction[] }
  | { status: "not_admin" }
  | { status: "not_found" }
  | { status: "error" };

function mapRow(row: GetAdminUserRestrictionsRow): AdminUserRestriction {
  return {
    restrictionId: row.restriction_id,
    restrictionType: row.restriction_type,
    reason: row.reason,
    issuedBy: row.issued_by,
    issuedByDisplayName: row.issued_by_display_name,
    createdAt: row.created_at,
    liftedAt: row.lifted_at,
    liftedBy: row.lifted_by,
    liftedByDisplayName: row.lifted_by_display_name,
  };
}

export async function getAdminUserRestrictions(userId: string): Promise<GetAdminUserRestrictionsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_user_restrictions", { p_user_id: userId }));
  } catch (err) {
    console.error("get_admin_user_restrictions RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "NOT_ADMIN") return { status: "not_admin" };
    if (error.details === "USER_NOT_FOUND") return { status: "not_found" };
    console.error("get_admin_user_restrictions RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetAdminUserRestrictionsRow[];
  return { status: "found", restrictions: rows.map(mapRow) };
}
