import { createClient } from "@/lib/supabase/server";
import type { ReportTargetType, ReportReason } from "@/lib/moderation/report-actions";
import type { ReportStatus } from "@/lib/admin/get-admin-reports";

/**
 * Row shape exactly matching public.get_admin_report_detail's RETURNS
 * TABLE (0067_moderation_admin_rpcs.sql) -- one wide row resolving
 * whichever target type applies; every other target-specific column
 * comes back null.
 */
export type GetAdminReportDetailRow = {
  report_id: string;
  target_type: ReportTargetType;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  created_at: string;
  reporter_id: string;
  reporter_display_name: string;
  resolved_by: string | null;
  resolved_by_display_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  listing_id: string | null;
  listing_title: string | null;
  listing_shop_id: string | null;
  listing_shop_owner_id: string | null;
  listing_shop_owner_display_name: string | null;
  shop_id: string | null;
  shop_name: string | null;
  shop_owner_id: string | null;
  shop_owner_display_name: string | null;
  review_id: string | null;
  review_rating: number | null;
  review_body: string | null;
  review_author_id: string | null;
  review_author_display_name: string | null;
  conversation_id: string | null;
  conversation_buyer_id: string | null;
  conversation_buyer_display_name: string | null;
  conversation_shop_id: string | null;
  conversation_shop_owner_id: string | null;
  conversation_shop_owner_display_name: string | null;
  conversation_shop_name: string | null;
};

export type AdminReportDetail = {
  reportId: string;
  targetType: ReportTargetType;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  createdAt: string;
  reporterId: string;
  reporterDisplayName: string;
  resolvedBy: string | null;
  resolvedByDisplayName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  listingId: string | null;
  listingTitle: string | null;
  listingShopId: string | null;
  listingShopOwnerId: string | null;
  listingShopOwnerDisplayName: string | null;
  shopId: string | null;
  shopName: string | null;
  shopOwnerId: string | null;
  shopOwnerDisplayName: string | null;
  reviewId: string | null;
  reviewRating: number | null;
  reviewBody: string | null;
  reviewAuthorId: string | null;
  reviewAuthorDisplayName: string | null;
  conversationId: string | null;
  conversationBuyerId: string | null;
  conversationBuyerDisplayName: string | null;
  conversationShopId: string | null;
  conversationShopOwnerId: string | null;
  conversationShopOwnerDisplayName: string | null;
  conversationShopName: string | null;
};

export type GetAdminReportDetailResult =
  | { status: "found"; report: AdminReportDetail }
  | { status: "not_found" }
  | { status: "not_admin" }
  | { status: "error" };

function mapRow(row: GetAdminReportDetailRow): AdminReportDetail {
  return {
    reportId: row.report_id,
    targetType: row.target_type,
    reason: row.reason,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    reporterId: row.reporter_id,
    reporterDisplayName: row.reporter_display_name,
    resolvedBy: row.resolved_by,
    resolvedByDisplayName: row.resolved_by_display_name,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    listingShopId: row.listing_shop_id,
    listingShopOwnerId: row.listing_shop_owner_id,
    listingShopOwnerDisplayName: row.listing_shop_owner_display_name,
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopOwnerId: row.shop_owner_id,
    shopOwnerDisplayName: row.shop_owner_display_name,
    reviewId: row.review_id,
    reviewRating: row.review_rating,
    reviewBody: row.review_body,
    reviewAuthorId: row.review_author_id,
    reviewAuthorDisplayName: row.review_author_display_name,
    conversationId: row.conversation_id,
    conversationBuyerId: row.conversation_buyer_id,
    conversationBuyerDisplayName: row.conversation_buyer_display_name,
    conversationShopId: row.conversation_shop_id,
    conversationShopOwnerId: row.conversation_shop_owner_id,
    conversationShopOwnerDisplayName: row.conversation_shop_owner_display_name,
    conversationShopName: row.conversation_shop_name,
  };
}

export async function getAdminReportDetail(reportId: string): Promise<GetAdminReportDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_report_detail", { p_report_id: reportId }));
  } catch (err) {
    console.error("get_admin_report_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "NOT_ADMIN") return { status: "not_admin" };
    if (error.details === "REPORT_NOT_FOUND") return { status: "not_found" };
    console.error("get_admin_report_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const row = ((data ?? []) as GetAdminReportDetailRow[])[0];
  if (!row) return { status: "not_found" };

  return { status: "found", report: mapRow(row) };
}
