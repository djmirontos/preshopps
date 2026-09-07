import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyOrders } from "@/lib/orders/get-my-orders";
import { OrdersListClient } from "@/components/orders/OrdersListClient";
import type { OrdersCursor } from "@/lib/orders/get-my-orders";

export const metadata = { title: "Orders | Preshopps" };

const ORDERS_LIMIT = 20;

/**
 * Authenticated-only, server-guarded exactly like /account and /favorites:
 * getAuthUser() runs before any order data is fetched, so a guest never
 * triggers get_my_orders at all. Uses the existing get_my_orders RPC
 * (0042_buyer_orders_read_rpcs.sql) plus the same cursor + Load-More
 * pattern already used on /favorites/search/shop pages.
 */
export default async function OrdersPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/orders")}`);
  }

  const result = await getMyOrders(ORDERS_LIMIT);

  async function loadMoreAction(cursor: OrdersCursor) {
    "use server";
    return getMyOrders(ORDERS_LIMIT, cursor);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Orders</h1>
      <p className="mt-1 text-sm text-ink-secondary">Orders you&apos;ve placed, newest first.</p>

      <div className="mt-6">
        <OrdersListClient
          initialOrders={result.orders}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
        />
      </div>
    </div>
  );
}
