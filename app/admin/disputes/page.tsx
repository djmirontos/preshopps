import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getAdminDisputes } from "@/lib/admin/get-admin-disputes";
import { AdminDisputesListClient } from "@/components/admin/AdminDisputesListClient";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

export const metadata = { title: "Disputes | Admin | Preshopps" };

const DISPUTES_LIMIT = 20;

const STATUS_VALUES: ReadonlySet<string> = new Set<DisputeStatus>(["opened", "under_review", "resolved"]);

const STATUS_TABS: { value: DisputeStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "opened", label: "Opened" },
  { value: "under_review", label: "Under Review" },
  { value: "resolved", label: "Resolved" },
];

function parseStatus(raw: string | undefined): DisputeStatus | null {
  return raw && STATUS_VALUES.has(raw) ? (raw as DisputeStatus) : null;
}

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

/**
 * Admin-only dispute queue (PRD 34.4). Same authorization posture as
 * /admin and /admin/support: get_admin_disputes (0075) is the sole
 * source of truth, checked against public.user_roles server-side; a
 * non-admin caller gets the same notFound() an unauthenticated guest
 * gets after the redirect.
 */
export default async function AdminDisputesPage({ searchParams }: PageProps) {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/admin/disputes")}`);
  }

  const { status: rawStatus } = await searchParams;
  const status = parseStatus(rawStatus);

  const result = await getAdminDisputes(DISPUTES_LIMIT, status);

  if (result.notAdmin) {
    notFound();
  }

  async function loadMoreAction(cursor: { createdAt: string; id: string }) {
    "use server";
    return getAdminDisputes(DISPUTES_LIMIT, status, cursor);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Disputes</h1>
      <p className="mt-1 text-sm text-ink-secondary">Dispute queue, newest first.</p>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <Link
          href="/admin"
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Reports
        </Link>
        <Link
          href="/admin/support"
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Support
        </Link>
        <Link
          href="/admin/disputes"
          aria-current="page"
          className="flex h-8 shrink-0 items-center rounded-full bg-brand-action px-3 text-xs font-semibold text-brand-action-text"
        >
          Disputes
        </Link>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const isActive = tab.value === status;
          const href = tab.value === null ? "/admin/disputes" : `/admin/disputes?status=${tab.value}`;
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "flex h-8 shrink-0 items-center rounded-full bg-brand-action px-3 text-xs font-semibold text-brand-action-text"
                  : "flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        <AdminDisputesListClient
          initialDisputes={result.disputes}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
          activeStatus={status}
        />
      </div>
    </div>
  );
}
