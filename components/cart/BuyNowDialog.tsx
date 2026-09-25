"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { OrderReviewSubmit } from "@/components/cart/OrderReviewSubmit";
import { buildBuyNowLine } from "@/lib/cart/build-buy-now-line";
import { submitBuyNowOrder, type SubmitCartOrderResult, type SubmittedOrder } from "@/lib/cart/submit-buy-now-order";
import { markBuyNowOrderSubmitted } from "@/lib/cart/buy-now-success-flag";
import type { CartLineDisplay } from "@/lib/cart/map-cart-row";
import type { RefreshMyCartResult } from "@/lib/cart/refresh-my-cart-client";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

type Props = {
  publicCode: string;
  onClose: () => void;
};

/** Buy Now always starts at quantity 1 -- the listing detail page has no
 * quantity selector, and Buy Now is deliberately independent of whatever
 * quantity the same listing may already have sitting in the buyer's
 * persistent cart (see this task's own PART 9: cart state must never
 * influence Buy Now's default). */
const BUY_NOW_QUANTITY = 1;

/**
 * Buy Now reuses the exact canonical order-review UI (OrderReviewSubmit)
 * and, as of 0089_buy_now_order_submission.sql, the exact canonical
 * order-creation core (create_orders_from_selection) that submit_cart_order
 * itself calls -- there is no second, parallel checkout implementation.
 *
 * Cart independence is now structural, not a frontend convention this
 * component has to protect by hand: this file makes zero cart-related RPC
 * calls (no set_cart_item_quantity, no remove_cart_item, no read of the
 * persistent cart at all) and never touches CartProvider. The single
 * review line is built directly from the existing public get_listing_detail
 * RPC (lib/cart/build-buy-now-line.ts) -- the same read the listing page
 * and GuestCartClient already use -- and submitted via submit_buy_now_order
 * (lib/cart/submit-buy-now-order.ts), which never references cart_items/
 * carts in any statement. There is nothing left for this component to
 * create or clean up: no temporary row exists at any point, so there is no
 * possible hard-tab-close/abandonment case that could leave the buyer's
 * cart altered.
 */
export function BuyNowDialog({ publicCode, onClose }: Props) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLineDisplay[]>([]);

  useEffect(() => {
    let cancelled = false;

    buildBuyNowLine(publicCode, BUY_NOW_QUANTITY).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setErrorMessage(
          result.reason === "not_found"
            ? "This item is no longer available."
            : "Couldn't load this item. Please try again.",
        );
        setPhase("error");
        return;
      }
      setLines([result.line]);
      setPhase("ready");
    });

    return () => {
      cancelled = true;
    };
  }, [publicCode]);

  async function refreshLines(): Promise<RefreshMyCartResult> {
    const result = await buildBuyNowLine(publicCode, BUY_NOW_QUANTITY);
    if (!result.ok) return { lines: [], hadError: true };
    return { lines: [result.line], hadError: false };
  }

  async function submit({
    rows,
    fulfillmentChoices,
  }: {
    rows: CartLineDisplay[];
    fulfillmentChoices: Record<string, FulfillmentMethod | undefined>;
  }): Promise<SubmitCartOrderResult> {
    const row = rows[0];
    if (!row || !row.shopId) return { ok: false, code: "NO_ELIGIBLE_ITEMS" };

    const method = fulfillmentChoices[row.shopId];
    if (!method) return { ok: false, code: "FULFILLMENT_INVALID" };

    return submitBuyNowOrder({
      listingId: row.listingId,
      quantity: row.quantity,
      fulfillmentMethod: method,
      expectedPriceCents: row.priceCents ?? row.priceCentsSnapshot,
    });
  }

  /**
   * Buy Now always creates exactly one order (a single listing/shop), so
   * there is no multi-seller summary to show -- the buyer goes straight to
   * that order's own canonical detail page (the same /orders/{publicCode}
   * route every other "View Order" link in the app already uses: /orders
   * list, review flow, disputes), never the general /orders list. Only
   * ever invoked by OrderReviewSubmit after a CONFIRMED successful
   * submission (see its own onSuccess prop) -- a failed submit still
   * leaves this dialog open showing the existing error state. Closing
   * first removes the dialog immediately rather than letting it linger
   * for the tick before the route change completes.
   *
   * markBuyNowOrderSubmitted (LAUNCH UX S1.2) sets the one-time,
   * order-code-keyed sessionStorage flag BuyNowOrderSubmittedNotice reads
   * once on the destination page -- called only here, after
   * submit_buy_now_order has already confirmed success, never on a
   * validation/rejected submission (those never reach this function at
   * all; see OrderReviewSubmit's own onSuccess contract, only ever called
   * from `if (outcome.ok)`). Deliberately not a toast fired from here: a
   * toast on this page is not guaranteed to survive this immediate
   * navigation the way a flag read on the destination page is (same
   * reasoning as ChangePasswordForm's own redirect to /sign-in).
   */
  function handleSuccess(orders: SubmittedOrder[]) {
    onClose();
    const order = orders[0];
    if (order) {
      markBuyNowOrderSubmitted(order.orderPublicCode);
      router.push(`/orders/${order.orderPublicCode}`);
    }
  }

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="buy-now-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="buy-now-title" className="text-base font-semibold text-ink">
              Buy Now
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3">
            {phase === "loading" && <p className="text-sm text-ink-secondary">Loading…</p>}

            {phase === "error" && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage}
              </p>
            )}

            {phase === "ready" && (
              <OrderReviewSubmit
                lines={lines}
                onLinesChange={setLines}
                submit={submit}
                refreshLines={refreshLines}
                removeFromCartOnSuccess={false}
                onSuccess={handleSuccess}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
