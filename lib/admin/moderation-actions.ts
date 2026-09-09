import { createClient } from "@/lib/supabase/client";
import type { ReportStatus } from "@/lib/admin/get-admin-reports";
import type { RestrictionType } from "@/lib/admin/get-admin-user-restrictions";

/**
 * Thin client wrappers around the three admin write RPCs (0067):
 * resolve_admin_report, apply_user_restriction, lift_user_restriction.
 * Every admin-authorization check happens server-side inside each RPC --
 * these wrappers never send a role/admin flag of any kind.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// resolveAdminReport (resolve_admin_report)
// ============================================================
export type ResolveAdminReportErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "TARGET_STATUS_NOT_ALLOWED" | "REPORT_NOT_FOUND" | "RESOLUTION_NOTE_TOO_LONG";

const RESOLVE_ADMIN_REPORT_ERROR_CODES: ReadonlySet<string> = new Set<ResolveAdminReportErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "TARGET_STATUS_NOT_ALLOWED",
  "REPORT_NOT_FOUND",
  "RESOLUTION_NOTE_TOO_LONG",
]);

export const RESOLVE_ADMIN_REPORT_ERROR_MESSAGES: ErrorMap<ResolveAdminReportErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  TARGET_STATUS_NOT_ALLOWED: "That status can't be set directly.",
  REPORT_NOT_FOUND: "We couldn't find this report. Please refresh and try again.",
  RESOLUTION_NOTE_TOO_LONG: "Please shorten your note.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type ResolveAdminReportResult =
  | { ok: true; reportId: string; status: ReportStatus; wasAlreadyInStatus: boolean; resolvedAt: string }
  | { ok: false; code: ResolveAdminReportErrorCode | "UNKNOWN" };

type ResolveAdminReportRpcRow = { report_id: string; status: ReportStatus; was_already_in_status: boolean; resolved_at: string };

export async function resolveAdminReport(
  reportId: string,
  status: Exclude<ReportStatus, "pending">,
  resolutionNote: string | null,
): Promise<ResolveAdminReportResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("resolve_admin_report", {
      p_report_id: reportId,
      p_status: status,
      p_resolution_note: resolutionNote,
    });

    if (error) {
      console.error("resolve_admin_report RPC failed:", error.message);
      return { ok: false, code: toErrorCode<ResolveAdminReportErrorCode>((error as { details?: string }).details, RESOLVE_ADMIN_REPORT_ERROR_CODES) };
    }

    const row = ((data ?? []) as ResolveAdminReportRpcRow[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };

    return { ok: true, reportId: row.report_id, status: row.status, wasAlreadyInStatus: row.was_already_in_status, resolvedAt: row.resolved_at };
  } catch (err) {
    console.error("resolve_admin_report RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// applyUserRestriction (apply_user_restriction)
// ============================================================
export type ApplyUserRestrictionErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_ADMIN"
  | "RESTRICTION_TYPE_REQUIRED"
  | "REASON_REQUIRED"
  | "USER_NOT_FOUND";

const APPLY_USER_RESTRICTION_ERROR_CODES: ReadonlySet<string> = new Set<ApplyUserRestrictionErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "RESTRICTION_TYPE_REQUIRED",
  "REASON_REQUIRED",
  "USER_NOT_FOUND",
]);

export const APPLY_USER_RESTRICTION_ERROR_MESSAGES: ErrorMap<ApplyUserRestrictionErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  RESTRICTION_TYPE_REQUIRED: "Please choose a restriction type.",
  REASON_REQUIRED: "Please provide a reason.",
  USER_NOT_FOUND: "We couldn't find this user. Please refresh and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type ApplyUserRestrictionResult =
  | { ok: true; restrictionId: string; userId: string; restrictionType: RestrictionType; wasAlreadyActive: boolean; createdAt: string }
  | { ok: false; code: ApplyUserRestrictionErrorCode | "UNKNOWN" };

type ApplyUserRestrictionRpcRow = {
  restriction_id: string;
  user_id: string;
  restriction_type: RestrictionType;
  was_already_active: boolean;
  created_at: string;
};

export async function applyUserRestriction(
  userId: string,
  restrictionType: RestrictionType,
  reason: string,
): Promise<ApplyUserRestrictionResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("apply_user_restriction", {
      p_user_id: userId,
      p_restriction_type: restrictionType,
      p_reason: reason,
    });

    if (error) {
      console.error("apply_user_restriction RPC failed:", error.message);
      return {
        ok: false,
        code: toErrorCode<ApplyUserRestrictionErrorCode>((error as { details?: string }).details, APPLY_USER_RESTRICTION_ERROR_CODES),
      };
    }

    const row = ((data ?? []) as ApplyUserRestrictionRpcRow[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };

    return {
      ok: true,
      restrictionId: row.restriction_id,
      userId: row.user_id,
      restrictionType: row.restriction_type,
      wasAlreadyActive: row.was_already_active,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error("apply_user_restriction RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// liftUserRestriction (lift_user_restriction)
// ============================================================
export type LiftUserRestrictionErrorCode = "NOT_AUTHENTICATED" | "NOT_ADMIN" | "RESTRICTION_NOT_FOUND" | "RESOLUTION_NOTE_TOO_LONG";

const LIFT_USER_RESTRICTION_ERROR_CODES: ReadonlySet<string> = new Set<LiftUserRestrictionErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "RESTRICTION_NOT_FOUND",
  "RESOLUTION_NOTE_TOO_LONG",
]);

export const LIFT_USER_RESTRICTION_ERROR_MESSAGES: ErrorMap<LiftUserRestrictionErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  RESTRICTION_NOT_FOUND: "We couldn't find this restriction. Please refresh and try again.",
  RESOLUTION_NOTE_TOO_LONG: "Please shorten your note.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type LiftUserRestrictionResult =
  | { ok: true; restrictionId: string; userId: string; restrictionType: RestrictionType; wasAlreadyLifted: boolean; liftedAt: string }
  | { ok: false; code: LiftUserRestrictionErrorCode | "UNKNOWN" };

type LiftUserRestrictionRpcRow = {
  restriction_id: string;
  user_id: string;
  restriction_type: RestrictionType;
  was_already_lifted: boolean;
  lifted_at: string;
};

export async function liftUserRestriction(restrictionId: string, note: string | null): Promise<LiftUserRestrictionResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("lift_user_restriction", {
      p_restriction_id: restrictionId,
      p_note: note,
    });

    if (error) {
      console.error("lift_user_restriction RPC failed:", error.message);
      return { ok: false, code: toErrorCode<LiftUserRestrictionErrorCode>((error as { details?: string }).details, LIFT_USER_RESTRICTION_ERROR_CODES) };
    }

    const row = ((data ?? []) as LiftUserRestrictionRpcRow[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };

    return {
      ok: true,
      restrictionId: row.restriction_id,
      userId: row.user_id,
      restrictionType: row.restriction_type,
      wasAlreadyLifted: row.was_already_lifted,
      liftedAt: row.lifted_at,
    };
  } catch (err) {
    console.error("lift_user_restriction RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
