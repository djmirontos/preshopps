"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { REPORT_REASON_LABELS } from "@/lib/moderation/report-actions";
import type { AdminReportSummary, AdminReportsCursor, ReportStatus } from "@/lib/admin/get-admin-reports";

type LoadMoreResult = {
  reports: AdminReportSummary[];
  hadError: boolean;
  nextCursor: AdminReportsCursor | null;
};

type Props = {
  initialReports: AdminReportSummary[];
  initialHadError: boolean;
  initialCursor: AdminReportsCursor | null;
  loadMore: (cursor: AdminReportsCursor) => Promise<LoadMoreResult>;
  activeStatus: ReportStatus | null;
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "Pending",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const TARGET_TYPE_LABELS: Record<AdminReportSummary["targetType"], string> = {
  listing: "Listing",
  shop: "Shop",
  review: "Review",
  conversation: "Conversation",
};

/** Same server-rendered-first-page + Load More shape as every other list
 * client in this codebase (SellerOrdersListClient, SellerListingsListClient). */
export function AdminReportsListClient({ initialReports, initialHadError, initialCursor, loadMore, activeStatus }: Props) {
  const [reports, setReports] = useState(initialReports);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (initialHadError) {
    return <p className="text-sm text-ink-secondary">Unable to load reports right now.</p>;
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">
          {activeStatus ? `No ${STATUS_LABELS[activeStatus].toLowerCase()} reports.` : "No reports yet."}
        </p>
      </div>
    );
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await loadMore(cursor);
      if (result.hadError) {
        setLoadMoreFailed(true);
        return;
      }
      setReports((prev) => [...prev, ...result.reports]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <ul className="space-y-3">
        {reports.map((report) => (
          <li key={report.reportId}>
            <Link
              href={`/admin/reports/${report.reportId}`}
              className="block rounded-[14px] border border-border bg-surface p-4 hover:border-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{TARGET_TYPE_LABELS[report.targetType]}</span>
                <Badge tone={report.status === "pending" ? "brand" : "neutral"}>{STATUS_LABELS[report.status]}</Badge>
              </div>
              <p className="mt-1 truncate text-sm text-ink-secondary">{report.targetLabel ?? "—"}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-muted">
                <span>{REPORT_REASON_LABELS[report.reason]}</span>
                <span>
                  {report.reporterDisplayName} · {formatOrderDate(report.createdAt)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-[10px] border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-link hover:text-brand-link disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more reports right now.</p>}
        </div>
      )}
    </div>
  );
}
