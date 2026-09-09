import { createClient } from "@/lib/supabase/server";
import type { ReportTargetType, ReportReason } from "@/lib/moderation/report-actions";

export type ReportStatus = "pending" | "resolved" | "dismissed";

/**
 * Row shape exactly matching public.get_admin_reports' RETURNS TABLE
 * (0067_moderation_admin_rpcs.sql).
 */
export type GetAdminReportsRow = {
  report_id: string;
  target_type: ReportTargetType;
  target_label: string | null;
  reason: ReportReason;
  status: ReportStatus;
  reporter_display_name: string;
  created_at: string;
};

export type AdminReportSummary = {
  reportId: string;
  targetType: ReportTargetType;
  targetLabel: string | null;
  reason: ReportReason;
  status: ReportStatus;
  reporterDisplayName: string;
  createdAt: string;
};

export type AdminReportsCursor = {
  createdAt: string;
  id: string;
};

export type GetAdminReportsResult = {
  reports: AdminReportSummary[];
  hadError: boolean;
  /** True specifically when the RPC rejected the caller as not an admin --
   * distinguished from a generic error so the page can show a clean
   * not-found/access-denied state instead of a "try again" message. */
  notAdmin: boolean;
  nextCursor: AdminReportsCursor | null;
};

function mapRow(row: GetAdminReportsRow): AdminReportSummary {
  return {
    reportId: row.report_id,
    targetType: row.target_type,
    targetLabel: row.target_label,
    reason: row.reason,
    status: row.status,
    reporterDisplayName: row.reporter_display_name,
    createdAt: row.created_at,
  };
}

/**
 * get_admin_reports (0067) raises NOT_ADMIN for a non-admin caller --
 * surfaced here as `notAdmin: true` rather than a generic error, so the
 * page can render notFound() for an ordinary user without leaking any
 * report data or distinguishing "not signed in" from "signed in, not
 * admin" in its own copy.
 */
export async function getAdminReports(
  limit: number,
  status?: ReportStatus | null,
  cursor?: AdminReportsCursor,
): Promise<GetAdminReportsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_reports", {
      p_status: status ?? null,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_admin_reports RPC threw:", err instanceof Error ? err.message : err);
    return { reports: [], hadError: true, notAdmin: false, nextCursor: null };
  }

  if (error) {
    const isNotAdmin = error.details === "NOT_ADMIN";
    if (!isNotAdmin) {
      console.error("get_admin_reports RPC failed:", error.message);
    }
    return { reports: [], hadError: !isNotAdmin, notAdmin: isNotAdmin, nextCursor: null };
  }

  const rows = (data ?? []) as GetAdminReportsRow[];
  const reports = rows.map(mapRow);
  const nextCursor = rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].report_id } : null;

  return { reports, hadError: false, notAdmin: false, nextCursor };
}
