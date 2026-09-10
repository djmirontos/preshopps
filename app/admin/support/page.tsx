import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getAdminSupportTickets } from "@/lib/admin/get-admin-support-tickets";
import { AdminSupportTicketsListClient } from "@/components/admin/AdminSupportTicketsListClient";

export const metadata = { title: "Support | Admin | Preshopps" };

const TICKETS_LIMIT = 20;

/**
 * Admin-only support ticket queue (PRD 43.1: submissions "route to
 * admin"). Same authorization posture as /admin: get_admin_support_tickets
 * (0070) is the sole source of truth, checked against public.user_roles
 * server-side; a non-admin caller gets the same notFound() an
 * unauthenticated guest gets after the redirect. Read-only -- no
 * status/workflow exists to filter or mutate here.
 */
export default async function AdminSupportTicketsPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/admin/support")}`);
  }

  const result = await getAdminSupportTickets(TICKETS_LIMIT);

  if (result.notAdmin) {
    notFound();
  }

  async function loadMoreAction(cursor: { createdAt: string; id: string }) {
    "use server";
    return getAdminSupportTickets(TICKETS_LIMIT, cursor);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Support</h1>
      <p className="mt-1 text-sm text-ink-secondary">Submitted support requests, newest first.</p>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <Link
          href="/admin"
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Reports
        </Link>
        <Link
          href="/admin/support"
          aria-current="page"
          className="flex h-8 shrink-0 items-center rounded-full bg-brand-action px-3 text-xs font-semibold text-brand-action-text"
        >
          Support
        </Link>
        <Link
          href="/admin/disputes"
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Disputes
        </Link>
      </div>

      <div className="mt-6">
        <AdminSupportTicketsListClient
          initialTickets={result.tickets}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
        />
      </div>
    </div>
  );
}
