import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getAdminSupportTicketDetail } from "@/lib/admin/get-admin-support-ticket-detail";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/support/submit-support-ticket";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";

export const metadata = { title: "Support Ticket | Admin | Preshopps" };

type PageProps = {
  params: Promise<{ ticketId: string }>;
};

/**
 * Admin-only support ticket detail. Same authorization posture as
 * /admin/reports/[reportId]: a non-admin caller gets notFound(), never a
 * distinguishable error. Read-only -- no action buttons exist here on
 * purpose, since canon does not require a mutable ticket status/workflow
 * and this task explicitly says not to invent one.
 */
export default async function AdminSupportTicketDetailPage({ params }: PageProps) {
  const { ticketId } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/admin/support/${ticketId}`)}`);
  }

  const result = await getAdminSupportTicketDetail(ticketId);

  if (result.status === "not_admin" || result.status === "not_found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this support ticket right now.</p>
      </div>
    );
  }

  const { ticket } = result;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin/support" className="text-sm font-medium text-brand-link hover:underline">
        ← Back to support
      </Link>

      <h1 className="mt-3 text-xl font-bold text-ink lg:text-2xl">{SUPPORT_CATEGORY_LABELS[ticket.category]}</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        Submitted by {ticket.userDisplayName} · {formatMessageTimestamp(ticket.createdAt)}
      </p>

      <div className="mt-6 whitespace-pre-wrap rounded-[14px] border border-border bg-surface p-4 text-sm text-ink">{ticket.message}</div>
    </div>
  );
}
