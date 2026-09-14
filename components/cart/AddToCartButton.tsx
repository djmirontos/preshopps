"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { useIsAuthenticated } from "@/lib/auth/use-is-authenticated";
import { useCart } from "@/components/cart/CartProvider";
import { AddToCartSuccessModal } from "@/components/cart/AddToCartSuccessModal";

type Props = {
  listingId: string;
  publicCode: string;
  availableQuantity: number;
  /** Optional -- both must be present for the success modal to show a
   * thumbnail/title row (see AddToCartSuccessModal's own comment). */
  listingTitle?: string;
  listingImageUrl?: string;
  className?: string;
};

/** AddToCartButton always adds exactly one unit per click -- this constant
 * exists purely so the success modal's copy reads as "how many this click
 * added" rather than a hardcoded "1" scattered at the call site; it does
 * not change cart quantity semantics in any way. */
const QUANTITY_ADDED_PER_CLICK = 1;

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
 *
 * The previous inline "N in cart" text below the button is gone --
 * replaced by AddToCartSuccessModal, shown only on a genuinely successful
 * add triggered by *this* click (never merely because currentQuantity > 0
 * from an earlier click or a page reload). The header's own cart badge
 * reads live itemCount from this same CartProvider and is completely
 * unaffected by anything in this component.
 */
export function AddToCartButton({ listingId, publicCode, availableQuantity, listingTitle, listingImageUrl, className }: Props) {
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();
  const { getQuantity, setQuantity } = useCart();
  const currentQuantity = getQuantity(listingId);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const atStockLimit = currentQuantity >= availableQuantity;

  async function handleClick() {
    if (isPending || atStockLimit) return;
    setError(null);

    const desiredQuantity = currentQuantity + QUANTITY_ADDED_PER_CLICK;
    // Optimistic: reflects in the shared quantity map immediately.
    setQuantity(listingId, publicCode, desiredQuantity);

    if (!isAuthenticated) {
      // Guest mutation is fully local/synchronous -- CartProvider already
      // persisted it to localStorage as part of setQuantity above, so this
      // click has already fully succeeded.
      setShowSuccessModal(true);
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
    } else {
      setShowSuccessModal(true);
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

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}

      {showSuccessModal && (
        <AddToCartSuccessModal
          quantityAdded={QUANTITY_ADDED_PER_CLICK}
          listingTitle={listingTitle}
          listingImageUrl={listingImageUrl}
          onViewCart={() => {
            setShowSuccessModal(false);
            router.push("/cart");
          }}
          onClose={() => setShowSuccessModal(false)}
        />
      )}
    </div>
  );
}
