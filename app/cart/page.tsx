import { getAuthUser } from "@/lib/auth/session";
import { getMyCart } from "@/lib/cart/get-my-cart";
import { AuthenticatedCartClient } from "@/components/cart/AuthenticatedCartClient";
import { GuestCartClient } from "@/components/cart/GuestCartClient";

export const metadata = { title: "Cart | Preshopps" };

/**
 * Accessible to guests and authenticated users alike (PRD S20.1/20.2) --
 * unlike /favorites and /account, this route never redirects a guest.
 * Authenticated cart data is fetched server-side via the shared
 * getMyCart() (React cache()-deduped with the root layout's own
 * getMyCartQuantities() call within the same request -- see
 * lib/cart/get-my-cart.ts -- so this is not a second real get_my_cart()
 * round trip). Guest cart lives entirely in localStorage, so it can only
 * be read and hydrated client-side -- GuestCartClient does that itself on
 * mount.
 */
export default async function CartPage() {
  const user = await getAuthUser();
  const result = user ? await getMyCart() : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Cart</h1>
      <p className="mt-1 text-sm text-ink-secondary">Items from multiple sellers are grouped separately below.</p>

      <div className="mt-6">
        {result ? (
          <AuthenticatedCartClient initialLines={result.lines} hadError={result.hadError} />
        ) : (
          <GuestCartClient />
        )}
      </div>
    </div>
  );
}
