"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import { SUPPORT_CATEGORY_LABELS } from "@/lib/support/submit-support-ticket";
import type { AdminSupportTicketSummary, AdminSupportTicketsCursor } from "@/lib/admin/get-admin-support-tickets";

type LoadMoreResult = {
  tickets: AdminSupportTicketSummary[];
  hadError: boolean;
  nextCursor: AdminSupportTicketsCursor | null;
};

type Props = {
  initialTickets: AdminSupportTicketSummary[];
  initialHadError: boolean;
  initialCursor: AdminSupportTicketsCursor | null;
  loadMore: (cursor: AdminSupportTicketsCursor) => Promise<LoadMoreResult>;
};

/** Same server-rendered-first-page + Load More shape as AdminReportsListClient. */
export function AdminSupportTicketsListClient({ initialTickets, initialHadError, initialCursor, loadMore }: Props) {
  const [tickets, setTickets] = useState(initialTickets);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (initialHadError) {
    return <p className="text-sm text-ink-secondary">Unable to load support tickets right now.</p>;
  }

  if (tickets.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">No support tickets yet.</p>
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
      setTickets((prev) => [...prev, ...result.tickets]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <ul className="space-y-3">
        {tickets.map((ticket) => (
          <li key={ticket.ticketId}>
            <Link
              href={`/admin/support/${ticket.ticketId}`}
              className="block rounded-[14px] border border-border bg-surface p-4 hover:border-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{SUPPORT_CATEGORY_LABELS[ticket.category]}</span>
                <span className="text-xs text-ink-muted">{formatMessageTimestamp(ticket.createdAt)}</span>
              </div>
              <p className="mt-1 truncate text-sm text-ink-secondary">{ticket.message}</p>
              <p className="mt-2 text-xs text-ink-muted">{ticket.userDisplayName}</p>
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
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more support tickets right now.</p>}
        </div>
      )}
    </div>
  );
}
