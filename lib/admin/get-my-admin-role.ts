import { createClient } from "@/lib/supabase/server";

export type AdminRole = "admin" | "super_admin";

/**
 * Wraps get_my_admin_role (0078) -- self-only, role-agnostic (any
 * authenticated user may call it; it only ever answers "what is MY
 * role"). Returns null for an ordinary user or on any error, so callers
 * can use it purely to decide whether to render the super-admin-only
 * "Admins" nav link without needing a distinguishable error state.
 */
export async function getMyAdminRole(): Promise<AdminRole | null> {
  const supabase = await createClient();

  try {
    const { data, error } = await supabase.rpc("get_my_admin_role");
    if (error) {
      console.error("get_my_admin_role RPC failed:", error.message);
      return null;
    }
    return (data as AdminRole | null) ?? null;
  } catch (err) {
    console.error("get_my_admin_role RPC threw:", err instanceof Error ? err.message : err);
    return null;
  }
}
