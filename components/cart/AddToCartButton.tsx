"use client";

import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { useIsAuthenticated } from "@/lib/auth/use-is-authenticated";
import { useCart } from "@/components/cart/CartProvider";

type Props = {
  listingId: string;
  publicCode: string;
  availableQuantity: number;
  className?: string;
};

/**
 * Adds one unit to the signed-in DB cart (set_cart_item_quantity) or the
 * local guest cart, whichever applies -- no AuthGate for a guest, per PRD
 * S20.1 ("Guests may add eligible sale listings to cart"), unlike
 * Favorite/Message Seller which are sign-in-only actions.
 *
 * Quantity is read live from the shared CartProvider (never copied into
 * local state), so clicking this button again correctly increments the
 * existing cart line instead of resetting it to 1, and it disables itself
 * once available stock is reached -- mirroring FavoriteButton's "read
 * live from shared context" fix from the Favorites correction task.
 */
export function AddToCartButton({ listingId, publicCode, availableQuantity, className }: Props) {
  const isAuthenticated = useIsAuthenticated();
  const { getQuantity, setQuantity } = useCart();
  const currentQuantity = getQuantity(listingId);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atStockLimit = currentQuantity >= availableQuantity;

  async function handleClick() {
    if (isPending || atStockLimit) return;
    setError(null);

    const desiredQuantity = currentQuantity + 1;
    // Optimistic: reflects in the shared quantity map immediately.
    setQuantity(listingId, publicCode, desiredQuantity);

    if (!isAuthenticated) {
      // Guest mutation is fully local/synchronous -- CartProvider already
      // persisted it to localStorage as part of setQuantity above.
      return;
    }

    setIsPending(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_cart_item_quantity", {
      p_listing_id: listingId,
      p_quantity: desiredQuantity,
    });

    if (rpcError) {
      console.error("set_cart_item_quantity failed:", rpcError.message);
      // Roll back the shared quantity map to the pre-click value.
      setQuantity(listingId, publicCode, currentQuantity);
      setError("Couldn't add this item to your cart. Please try again.");
    }

    setIsPending(false);
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || atStockLimit}
        className={cn(
          "flex h-12 w-full items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-semibold",
          atStockLimit
            ? "cursor-not-allowed bg-divider text-ink-muted"
            : "bg-brand-action text-brand-action-text hover:brightness-95",
        )}
      >
        {!atStockLimit && <ShoppingBag className="h-4 w-4" aria-hidden="true" />}
        {atStockLimit ? "Out of Stock" : "Add to Cart"}
      </button>

      {currentQuantity > 0 && !atStockLimit && (
        <p className="mt-1.5 text-xs text-ink-secondary">{currentQuantity} in cart</p>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
