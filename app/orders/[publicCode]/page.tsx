import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Package } from "lucide-react";
import { getAuthUser } from "@/lib/auth/session";
import { getMyOrderDetail } from "@/lib/orders/get-my-order-detail";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { getOrderStatusGuidance } from "@/lib/orders/order-status-copy";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { FULFILLMENT_LABELS } from "@/lib/marketplace/search-params";

type PageProps = {
  params: Promise<{ publicCode: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { publicCode } = await params;
  return { title: `Order ${publicCode} | Preshopps` };
}

/**
 * Authenticated buyer only. get_my_order_detail (0042) scopes every row to
 * the caller's own buyer_id server-side -- a public_code belonging to
 * another buyer resolves to zero rows, mapped to the same notFound() as a
 * genuinely nonexistent code, so a direct URL to someone else's order is
 * indistinguishable from "not found" (never a distinguishing 403/permission
 * error that would confirm the order exists).
 */
export default async function OrderDetailPage({ params }: PageProps) {
  const { publicCode } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/orders/${publicCode}`)}`);
  }

  const result = await getMyOrderDetail(publicCode);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this order right now.</p>
      </div>
    );
  }

  const { order } = result;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/orders" className="text-sm text-ink-secondary hover:text-ink">
        ← Back to Orders
      </Link>

      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">{order.orderPublicCode}</h1>
        <OrderStatusBadge status={order.status} fulfillmentMethod={order.fulfillmentMethod} />
      </div>
      <p className="mt-1 text-sm text-ink-secondary">{getOrderStatusGuidance(order.status, order.fulfillmentMethod)}</p>

      <div className="mt-6 rounded-[14px] border border-border bg-surface p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Seller</dt>
            <dd className="mt-0.5 font-medium text-ink">
              <Link href={`/shop/${order.shopSlug}`} className="hover:underline">
                {order.shopName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Order date</dt>
            <dd className="mt-0.5 font-medium text-ink">{formatOrderDate(order.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Fulfillment</dt>
            <dd className="mt-0.5 font-medium text-ink">{FULFILLMENT_LABELS[order.fulfillmentMethod]}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Total</dt>
            <dd className="mt-0.5 font-semibold text-ink">{formatPriceFromCents(order.totalCents)}</dd>
          </div>
        </dl>

        {order.buyerNote && (
          <div className="mt-4 border-t border-divider pt-4">
            <p className="text-xs text-ink-muted">Your note</p>
            <p className="mt-1 text-sm text-ink">{order.buyerNote}</p>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold text-ink">Items</h2>
        {order.items.map((item) => (
          <div key={item.orderItemId} className="flex gap-3 rounded-[14px] border border-border bg-surface p-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-divider">
              {item.imageUrl ? (
                <Image src={item.imageUrl} alt={item.title} fill sizes="64px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Package className="h-5 w-5 text-ink-muted/60" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium text-ink">{item.title}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Qty {item.quantity} × {formatPriceFromCents(item.priceCentsSnapshot)}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {formatPriceFromCents(item.priceCentsSnapshot * item.quantity)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
