"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import type { AdminDisputeSummary, AdminDisputesCursor } from "@/lib/admin/get-admin-disputes";
import type { DisputeStatus } from "@/lib/disputes/get-my-disputes";

type LoadMoreResult = {
  disputes: AdminDisputeSummary[];
  hadError: boolean;
  nextCursor: AdminDisputesCursor | null;
};

type Props = {
  initialDisputes: AdminDisputeSummary[];
  initialHadError: boolean;
  initialCursor: AdminDisputesCursor | null;
  loadMore: (cursor: AdminDisputesCursor) => Promise<LoadMoreResult>;
  activeStatus: DisputeStatus | null;
};

const STATUS_LABELS: Record<DisputeStatus, string> = {
  opened: "Opened",
  under_review: "Under Review",
  resolved: "Resolved",
};

/** Same server-rendered-first-page + Load More shape as AdminReportsListClient. */
export function AdminDisputesListClient({ initialDisputes, initialHadError, initialCursor, loadMore, activeStatus }: Props) {
  const [disputes, setDisputes] = useState(initialDisputes);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (initialHadError) {
    return <p className="text-sm text-ink-secondary">Unable to load disputes right now.</p>;
  }

  if (disputes.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">
          {activeStatus ? `No ${STATUS_LABELS[activeStatus].toLowerCase()} disputes.` : "No disputes yet."}
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
      setDisputes((prev) => [...prev, ...result.disputes]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <ul className="space-y-3">
        {disputes.map((dispute) => (
          <li key={dispute.disputeId}>
            <Link
              href={`/admin/disputes/${dispute.disputeId}`}
              className="block rounded-[14px] border border-border bg-surface p-4 hover:border-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{dispute.orderPublicCode}</span>
                <Badge tone={dispute.status === "opened" ? "brand" : "neutral"}>{STATUS_LABELS[dispute.status]}</Badge>
              </div>
              <p className="mt-1 truncate text-sm text-ink-secondary">{dispute.reason}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-muted">
                <span>
                  {dispute.buyerDisplayName} · {dispute.shopName}
                </span>
                <span>{formatOrderDate(dispute.createdAt)}</span>
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
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more disputes right now.</p>}
        </div>
      )}
    </div>
  );
}
