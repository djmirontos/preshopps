import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getAuthUser } from "@/lib/auth/session";
import { getDisputeDetail } from "@/lib/disputes/get-dispute-detail";
import { getDisputeImageSignedUrls } from "@/lib/disputes/get-dispute-image-url";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { FULFILLMENT_LABELS } from "@/lib/marketplace/search-params";

export const metadata = { title: "Dispute | Preshopps" };

type PageProps = {
  params: Promise<{ disputeId: string }>;
};

const STATUS_LABELS = {
  opened: "Opened",
  under_review: "Under Review",
  resolved: "Resolved",
} as const;

/**
 * Buyer/seller dispute detail (PRD 34.3/34.6) -- authenticated participant
 * only. get_dispute_detail (0074) scopes every row to the caller's own
 * order participancy server-side; a dispute the caller doesn't
 * participate in, or a nonexistent id, both resolve to not_found, mapped
 * to the same notFound(), matching this codebase's established privacy
 * pattern for order/conversation detail pages. Never shows admin-only
 * private notes (those exist only in get_admin_dispute_detail).
 */
export default async function DisputeDetailPage({ params }: PageProps) {
  const { disputeId } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/disputes/${disputeId}`)}`);
  }

  const result = await getDisputeDetail(disputeId);

  if (result.status === "not_found") {
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
  const imageUrls = await getDisputeImageSignedUrls(dispute.imagePaths);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href={`/orders/${dispute.orderPublicCode}`} className="text-sm text-ink-secondary hover:text-ink">
        ← Back to order
      </Link>

      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">Dispute</h1>
        <span className="rounded-full border border-border bg-canvas px-3 py-1 text-xs font-semibold text-ink">
          {STATUS_LABELS[dispute.status]}
        </span>
      </div>

      <p className="mt-1 text-sm text-ink-secondary">
        Order {dispute.orderPublicCode} · {dispute.shopName} · {FULFILLMENT_LABELS[dispute.fulfillmentMethod as keyof typeof FULFILLMENT_LABELS]}
      </p>

      <div className="mt-6 rounded-[14px] border border-border bg-surface p-4">
        <p className="text-xs font-medium text-ink-muted">Reason</p>
        <p className="mt-1 text-sm font-semibold text-ink">{dispute.reason}</p>

        <p className="mt-3 text-xs font-medium text-ink-muted">Explanation</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{dispute.explanation}</p>

        <p className="mt-3 text-xs text-ink-muted">
          Opened {formatOrderDate(dispute.createdAt)}
          {dispute.resolvedAt && ` · Resolved ${formatOrderDate(dispute.resolvedAt)}`}
        </p>
      </div>

      {imageUrls.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-ink-muted">Photos</p>
          <div className="mt-2 flex gap-2">
            {imageUrls.map((url) => (
              <span key={url} className="relative h-20 w-20 overflow-hidden rounded-[10px] bg-divider">
                <Image src={url} alt="" fill sizes="80px" className="object-contain" />
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-ink-muted">
        Preshopps records and reviews disputes but does not hold funds or issue automated refunds in MVP.
      </p>
    </div>
  );
}
