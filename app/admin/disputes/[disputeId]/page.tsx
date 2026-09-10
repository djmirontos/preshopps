import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth/session";
import { getAdminDisputeDetail } from "@/lib/admin/get-admin-dispute-detail";
import { getAdminDisputeMessages } from "@/lib/admin/get-admin-dispute-messages";
import { getDisputeImageSignedUrls } from "@/lib/disputes/get-dispute-image-url";
import { AdminDisputeDetailClient } from "@/components/admin/AdminDisputeDetailClient";

export const metadata = { title: "Dispute | Admin | Preshopps" };

type PageProps = {
  params: Promise<{ disputeId: string }>;
};

/**
 * Admin-only dispute detail. Same authorization posture as
 * /admin/reports/[reportId] and /admin/support/[ticketId]: a non-admin
 * caller gets notFound(), never a distinguishable error.
 */
export default async function AdminDisputeDetailPage({ params }: PageProps) {
  const { disputeId } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/admin/disputes/${disputeId}`)}`);
  }

  const result = await getAdminDisputeDetail(disputeId);

  if (result.status === "not_admin" || result.status === "not_found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this dispute right now.</p>
      </div>
    );
  }

  const { dispute } = result;

  const [imageUrls, messagesResult] = await Promise.all([
    getDisputeImageSignedUrls(dispute.imagePaths),
    getAdminDisputeMessages(disputeId),
  ]);

  const messages = messagesResult.status === "found" ? messagesResult.messages : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin/disputes" className="text-sm font-medium text-brand-link hover:underline">
        ← Back to disputes
      </Link>

      <div className="mt-3">
        <AdminDisputeDetailClient dispute={dispute} imageUrls={imageUrls} messages={messages} />
      </div>
    </div>
  );
}
