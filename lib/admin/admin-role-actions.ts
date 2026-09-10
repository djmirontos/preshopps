import { createClient } from "@/lib/supabase/client";
import type { AdminRole } from "@/lib/admin/get-my-admin-role";

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// find_user_for_role_assignment
// ============================================================
export type FindUserForRoleAssignmentErrorCode = "NOT_AUTHENTICATED" | "NOT_SUPER_ADMIN" | "EMAIL_REQUIRED";

const FIND_USER_ERROR_CODES: ReadonlySet<string> = new Set<FindUserForRoleAssignmentErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_SUPER_ADMIN",
  "EMAIL_REQUIRED",
]);

export const FIND_USER_FOR_ROLE_ASSIGNMENT_ERROR_MESSAGES: ErrorMap<FindUserForRoleAssignmentErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_SUPER_ADMIN: "Super admin access is required.",
  EMAIL_REQUIRED: "Please enter an email address.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type FoundUserForRoleAssignment = {
  userId: string;
  displayName: string;
  email: string;
  currentRole: AdminRole | null;
};

export type FindUserForRoleAssignmentResult =
  | { ok: true; user: FoundUserForRoleAssignment | null }
  | { ok: false; code: FindUserForRoleAssignmentErrorCode | "UNKNOWN" };

/**
 * Wraps find_user_for_role_assignment (0078) -- the super-admin-only
 * search RPC this task's own instruction requires in place of any
 * general user directory. Zero matching rows is a valid, non-error
 * outcome (`user: null`), not a distinguishable "not found" error, so the
 * UI can render "No user found with that email" without leaking whether
 * that specific email even has an account elsewhere in the product.
 */
export async function findUserForRoleAssignment(email: string): Promise<FindUserForRoleAssignmentResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("find_user_for_role_assignment", { p_email: email });
    if (error) {
      console.error("find_user_for_role_assignment RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<FindUserForRoleAssignmentErrorCode>((error as { details?: string }).details, FIND_USER_ERROR_CODES),
      };
    }
    const row = ((data ?? []) as { user_id: string; display_name: string; email: string; existing_role: AdminRole | null }[])[0];
    if (!row) return { ok: true, user: null };
    return {
      ok: true,
      user: { userId: row.user_id, displayName: row.display_name, email: row.email, currentRole: row.existing_role },
    };
  } catch (err) {
    console.error("find_user_for_role_assignment RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// grant_admin_role
// ============================================================
export type GrantAdminRoleErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_SUPER_ADMIN"
  | "TARGET_USER_NOT_FOUND"
  | "REASON_TOO_LONG"
  | "LAST_SUPER_ADMIN";

const GRANT_ERROR_CODES: ReadonlySet<string> = new Set<GrantAdminRoleErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_SUPER_ADMIN",
  "TARGET_USER_NOT_FOUND",
  "REASON_TOO_LONG",
  "LAST_SUPER_ADMIN",
]);

export const GRANT_ADMIN_ROLE_ERROR_MESSAGES: ErrorMap<GrantAdminRoleErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_SUPER_ADMIN: "Super admin access is required.",
  TARGET_USER_NOT_FOUND: "We couldn't find that user. Please refresh and try again.",
  REASON_TOO_LONG: "Please shorten the reason.",
  LAST_SUPER_ADMIN: "You can't demote the last remaining super admin.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type GrantAdminRoleResult =
  | { ok: true; userId: string; role: AdminRole; previousRole: AdminRole | null }
  | { ok: false; code: GrantAdminRoleErrorCode | "UNKNOWN" };

export async function grantAdminRole(userId: string, role: AdminRole, reason?: string): Promise<GrantAdminRoleResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("grant_admin_role", {
      p_user_id: userId,
      p_role: role,
      p_reason: reason ?? null,
    });
    if (error) {
      console.error("grant_admin_role RPC failed:", error.message);
      return { ok: false, code: toErrorCode<GrantAdminRoleErrorCode>((error as { details?: string }).details, GRANT_ERROR_CODES) };
    }
    const row = ((data ?? []) as { user_id: string; role: AdminRole; previous_role: AdminRole | null }[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, userId: row.user_id, role: row.role, previousRole: row.previous_role };
  } catch (err) {
    console.error("grant_admin_role RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// revoke_admin_role
// ============================================================
export type RevokeAdminRoleErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_SUPER_ADMIN"
  | "TARGET_HAS_NO_ROLE"
  | "REASON_TOO_LONG"
  | "LAST_SUPER_ADMIN";

const REVOKE_ERROR_CODES: ReadonlySet<string> = new Set<RevokeAdminRoleErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_SUPER_ADMIN",
  "TARGET_HAS_NO_ROLE",
  "REASON_TOO_LONG",
  "LAST_SUPER_ADMIN",
]);

export const REVOKE_ADMIN_ROLE_ERROR_MESSAGES: ErrorMap<RevokeAdminRoleErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_SUPER_ADMIN: "Super admin access is required.",
  TARGET_HAS_NO_ROLE: "This user doesn't have an admin role.",
  REASON_TOO_LONG: "Please shorten the reason.",
  LAST_SUPER_ADMIN: "You can't remove the last remaining super admin.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type RevokeAdminRoleResult =
  | { ok: true; userId: string; previousRole: AdminRole }
  | { ok: false; code: RevokeAdminRoleErrorCode | "UNKNOWN" };

export async function revokeAdminRole(userId: string, reason?: string): Promise<RevokeAdminRoleResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("revoke_admin_role", { p_user_id: userId, p_reason: reason ?? null });
    if (error) {
      console.error("revoke_admin_role RPC failed:", error.message);
      return { ok: false, code: toErrorCode<RevokeAdminRoleErrorCode>((error as { details?: string }).details, REVOKE_ERROR_CODES) };
    }
    const row = ((data ?? []) as { user_id: string; previous_role: AdminRole }[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, userId: row.user_id, previousRole: row.previous_role };
  } catch (err) {
    console.error("revoke_admin_role RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
