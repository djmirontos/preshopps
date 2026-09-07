"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { FULFILLMENT_LABELS } from "@/lib/marketplace/search-params";
import type { SellerOrderSummary, SellerOrdersCursor } from "@/lib/seller/get-my-shop-orders";

type LoadMoreResult = {
  orders: SellerOrderSummary[];
  hadError: boolean;
  nextCursor: SellerOrdersCursor | null;
};

type Props = {
  initialOrders: SellerOrderSummary[];
  initialHadError: boolean;
  initialCursor: SellerOrdersCursor | null;
  loadMore: (cursor: SellerOrdersCursor) => Promise<LoadMoreResult>;
};

/**
 * Same server-rendered-first-page + Load More shape as OrdersListClient --
 * cursor pagination on (created_at, id), never OFFSET, per
 * get_my_shop_orders (0043). Rows show only safe fields: public order
 * code, buyer display name, status, date, item count, total, fulfillment
 * method -- never a raw order/buyer UUID or buyer email.
 */
export function SellerOrdersListClient({ initialOrders, initialHadError, initialCursor, loadMore }: Props) {
  const [orders, setOrders] = useState(initialOrders);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (initialHadError) {
    return <p className="text-sm text-ink-secondary">Unable to load your shop&apos;s orders right now.</p>;
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">No orders yet.</p>
        <p className="mt-1 text-sm text-ink-muted">Orders buyers place with your shop will appear here.</p>
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
      setOrders((prev) => [...prev, ...result.orders]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <ul className="space-y-3">
        {orders.map((order) => (
          <li key={order.orderId}>
            <Link
              href={`/seller/orders/${order.orderPublicCode}`}
              className="block rounded-[14px] border border-border bg-surface p-4 hover:border-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{order.orderPublicCode}</span>
                <OrderStatusBadge status={order.status} fulfillmentMethod={order.fulfillmentMethod} />
              </div>
              <p className="mt-1 truncate text-sm text-ink-secondary">{order.buyerDisplayName}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-muted">
                <span>
                  {formatOrderDate(order.createdAt)} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"} ·{" "}
                  {FULFILLMENT_LABELS[order.fulfillmentMethod]}
                </span>
                <span className="text-sm font-semibold tabular-nums text-ink">{formatPriceFromCents(order.totalCents)}</span>
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
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more orders right now.</p>}
        </div>
      )}
    </div>
  );
}
