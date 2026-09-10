import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getAdminReports, type ReportStatus } from "@/lib/admin/get-admin-reports";
import { getMyAdminRole } from "@/lib/admin/get-my-admin-role";
import { AdminReportsListClient } from "@/components/admin/AdminReportsListClient";

export const metadata = { title: "Admin | Preshopps" };

const REPORTS_LIMIT = 20;

const STATUS_VALUES: ReadonlySet<string> = new Set<ReportStatus>(["pending", "resolved", "dismissed"]);

const STATUS_TABS: { value: ReportStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

function parseStatus(raw: string | undefined): ReportStatus | null {
  return raw && STATUS_VALUES.has(raw) ? (raw as ReportStatus) : null;
}

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

/**
 * Admin-only reports queue. Authorization is never decided client-side or
 * by this page itself -- get_admin_reports (0067) is the sole source of
 * truth, checked against public.user_roles server-side; a non-admin
 * caller (including a signed-in ordinary user) gets the exact same
 * notFound() an unauthenticated guest gets after the redirect, never a
 * distinguishable "access denied" page that would confirm this route's
 * existence to someone probing it.
 */
export default async function AdminReportsPage({ searchParams }: PageProps) {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/admin")}`);
  }

  const { status: rawStatus } = await searchParams;
  const status = parseStatus(rawStatus);

  const result = await getAdminReports(REPORTS_LIMIT, status);

  if (result.notAdmin) {
    notFound();
  }

  const myRole = await getMyAdminRole();

  async function loadMoreAction(cursor: { createdAt: string; id: string }) {
    "use server";
    return getAdminReports(REPORTS_LIMIT, status, cursor);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Reports</h1>
      <p className="mt-1 text-sm text-ink-secondary">Moderation queue, newest first.</p>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <Link
          href="/admin"
          aria-current="page"
          className="flex h-8 shrink-0 items-center rounded-full bg-brand-action px-3 text-xs font-semibold text-brand-action-text"
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
          className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
        >
          Disputes
        </Link>
        {myRole === "super_admin" && (
          <Link
            href="/admin/admins"
            className="flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
          >
            Admins
          </Link>
        )}
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const isActive = tab.value === status;
          const href = tab.value === null ? "/admin" : `/admin?status=${tab.value}`;
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
        <AdminReportsListClient
          initialReports={result.reports}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
          activeStatus={status}
        />
      </div>
    </div>
  );
}
