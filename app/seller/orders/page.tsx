import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyShop } from "@/lib/seller/get-my-shop";
import { getMyShopOrders } from "@/lib/seller/get-my-shop-orders";
import { SellerOrdersListClient } from "@/components/seller/SellerOrdersListClient";
import type { SellerOrdersCursor } from "@/lib/seller/get-my-shop-orders";

export const metadata = { title: "Seller Orders | Preshopps" };

const ORDERS_LIMIT = 20;

/**
 * Authenticated-only, exactly like /orders: getAuthUser() runs before any
 * shop/order data is fetched, so a guest never triggers either read. If
 * the user has no shop (getMyShop() -- shops_select_owner RLS, no new
 * migration), a simple explanatory state is shown -- not an error, since
 * "no shop yet" is expected for most accounts until a future Sell module
 * exists (confirmed: no shop-creation flow currently exists anywhere in
 * this codebase).
 */
export default async function SellerOrdersPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/seller/orders")}`);
  }

  const shop = await getMyShop();

  if (!shop) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">Seller Orders</h1>
        <div className="mt-6 rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
          <p className="text-sm font-medium text-ink">You don&apos;t have a shop yet.</p>
          <p className="mt-1 text-sm text-ink-muted">Orders for your shop will appear here once you start selling.</p>
        </div>
      </div>
    );
  }

  const result = await getMyShopOrders(ORDERS_LIMIT);

  async function loadMoreAction(cursor: SellerOrdersCursor) {
    "use server";
    return getMyShopOrders(ORDERS_LIMIT, cursor);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Seller Orders</h1>
      <p className="mt-1 text-sm text-ink-secondary">Orders placed with your shop, newest first.</p>

      <div className="mt-6">
        <SellerOrdersListClient
          initialOrders={result.orders}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
        />
      </div>
    </div>
  );
}
