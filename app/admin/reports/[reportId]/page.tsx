import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getAdminReportDetail } from "@/lib/admin/get-admin-report-detail";
import { getAdminUserRestrictions, type AdminUserRestriction } from "@/lib/admin/get-admin-user-restrictions";
import { AdminReportDetailClient } from "@/components/admin/AdminReportDetailClient";
import { REPORT_REASON_LABELS } from "@/lib/moderation/report-actions";

export const metadata = { title: "Report | Admin | Preshopps" };

type PageProps = {
  params: Promise<{ reportId: string }>;
};

export type AdminTargetUser = {
  userId: string;
  displayName: string;
  roleLabel: string;
  restrictions: AdminUserRestriction[];
};

/**
 * Admin-only report detail. Same authorization posture as /admin: a
 * non-admin caller gets notFound(), never a distinguishable error. Resolves
 * whichever target-owner user(s) this report actually concerns (one for
 * listing/shop/review, two -- buyer and shop owner -- for a conversation
 * report) and loads each one's full restriction history up front, so the
 * client component never needs a second round trip just to decide whether
 * to offer Apply or Lift.
 */
export default async function AdminReportDetailPage({ params }: PageProps) {
  const { reportId } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/admin/reports/${reportId}`)}`);
  }

  const result = await getAdminReportDetail(reportId);

  if (result.status === "not_admin" || result.status === "not_found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this report right now.</p>
      </div>
    );
  }

  const { report } = result;

  const targetUserRefs: { userId: string; displayName: string; roleLabel: string }[] = [];

  if (report.targetType === "listing" && report.listingShopOwnerId && report.listingShopOwnerDisplayName) {
    targetUserRefs.push({ userId: report.listingShopOwnerId, displayName: report.listingShopOwnerDisplayName, roleLabel: "Shop owner" });
  } else if (report.targetType === "shop" && report.shopOwnerId && report.shopOwnerDisplayName) {
    targetUserRefs.push({ userId: report.shopOwnerId, displayName: report.shopOwnerDisplayName, roleLabel: "Shop owner" });
  } else if (report.targetType === "review" && report.reviewAuthorId && report.reviewAuthorDisplayName) {
    targetUserRefs.push({ userId: report.reviewAuthorId, displayName: report.reviewAuthorDisplayName, roleLabel: "Reviewer" });
  } else if (report.targetType === "conversation") {
    if (report.conversationBuyerId && report.conversationBuyerDisplayName) {
      targetUserRefs.push({ userId: report.conversationBuyerId, displayName: report.conversationBuyerDisplayName, roleLabel: "Buyer" });
    }
    if (report.conversationShopOwnerId && report.conversationShopOwnerDisplayName) {
      targetUserRefs.push({ userId: report.conversationShopOwnerId, displayName: report.conversationShopOwnerDisplayName, roleLabel: "Shop owner" });
    }
  }

  const targetUsers: AdminTargetUser[] = await Promise.all(
    targetUserRefs.map(async (ref) => {
      const restrictionsResult = await getAdminUserRestrictions(ref.userId);
      return {
        ...ref,
        restrictions: restrictionsResult.status === "found" ? restrictionsResult.restrictions : [],
      };
    }),
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-sm font-medium text-brand-link hover:underline">
        ← Back to reports
      </Link>

      <h1 className="mt-3 text-xl font-bold text-ink lg:text-2xl">{REPORT_REASON_LABELS[report.reason]}</h1>

      <AdminReportDetailClient report={report} targetUsers={targetUsers} />
    </div>
  );
}
