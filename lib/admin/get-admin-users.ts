import { createClient } from "@/lib/supabase/server";
import type { AdminRole } from "@/lib/admin/get-my-admin-role";

/**
 * Row shape exactly matching public.get_admin_users' RETURNS TABLE
 * (0078_admin_role_management_rpcs.sql).
 */
export type GetAdminUsersRow = {
  user_id: string;
  display_name: string;
  email: string;
  role: AdminRole;
  granted_by: string | null;
  granted_by_display_name: string | null;
  created_at: string;
};

export type AdminUserSummary = {
  userId: string;
  displayName: string;
  email: string;
  role: AdminRole;
  grantedBy: string | null;
  grantedByDisplayName: string | null;
  createdAt: string;
};

export type GetAdminUsersResult =
  | { status: "found"; users: AdminUserSummary[] }
  | { status: "not_super_admin" }
  | { status: "error" };

function mapRow(row: GetAdminUsersRow): AdminUserSummary {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    grantedBy: row.granted_by,
    grantedByDisplayName: row.granted_by_display_name,
    createdAt: row.created_at,
  };
}

/**
 * get_admin_users (0078) raises NOT_SUPER_ADMIN for any caller who is not
 * specifically a super_admin (including an ordinary admin) -- surfaced
 * here as `status: "not_super_admin"` so the page can render notFound()
 * without leaking the roster or distinguishing "not signed in" / "admin
 * but not super_admin" in its own copy.
 */
export async function getAdminUsers(): Promise<GetAdminUsersResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_users"));
  } catch (err) {
    console.error("get_admin_users RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "NOT_SUPER_ADMIN") return { status: "not_super_admin" };
    console.error("get_admin_users RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetAdminUsersRow[];
  return { status: "found", users: rows.map(mapRow) };
}
