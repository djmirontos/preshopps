"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { useIsAuthenticated } from "@/lib/auth/use-is-authenticated";
import { useCart } from "@/components/cart/CartProvider";
import { AddToCartSuccessModal } from "@/components/cart/AddToCartSuccessModal";
import { interpretInteractionBlocked, type InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

/** set_cart_item_quantity's own live definition (0038) checks the caller's
 * own restriction BEFORE the mutual-block check -- unlike create_review/
 * upsert_review_reply, there is no earlier, invisible check that could have
 * fired first, so a confirmed match here is the guaranteed, sole cause of
 * this specific INTERACTION_BLOCKED. get_my_active_restrictions() returns
 * every one of the caller's own active restrictions, so it CAN return a
 * seller_suspended row too (e.g. a buyer who also runs a suspended shop) --
 * selectInteractionBlockedPresentation still ignores it by selection, since
 * seller_suspended is simply absent from this array. A seller's own
 * restriction is separately folded into the listing-side LISTING_NOT_
 * CARTABLE code instead, never into INTERACTION_BLOCKED, so it can never
 * reach this lookup as the cause of a buyer's own cart failure. */
const CART_RELEVANT_RESTRICTIONS: RestrictionType[] = ["account_suspended", "buyer_restricted"];

/** Carries the existing generic Add-to-Cart message plus an optional
 * confirmed restriction presentation. */
type AddToCartError = { message: string; restriction?: InteractionBlockedPresentation };

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
  const [error, setError] = useState<AddToCartError | null>(null);
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
      // Roll back the shared quantity map to the pre-click value -- happens
      // unconditionally here, before the restriction lookup, so a slow or
      // failed lookup can never delay or skip the rollback.
      setQuantity(listingId, publicCode, currentQuantity);
      const restriction = await interpretInteractionBlocked(
        (rpcError as { details?: string }).details ?? "",
        CART_RELEVANT_RESTRICTIONS,
      );
      setError({ message: "Couldn't add this item to your cart. Please try again.", restriction: restriction ?? undefined });
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
        <>
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {error.message}
          </p>
          {error.restriction && (
            <>
              <p className="mt-1 text-xs text-danger">{error.restriction.message}</p>
              <p className="mt-1 text-xs text-danger">
                <Link href={error.restriction.href} className="font-semibold underline underline-offset-2 hover:no-underline">
                  {error.restriction.ctaLabel}
                </Link>
              </p>
            </>
          )}
        </>
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
