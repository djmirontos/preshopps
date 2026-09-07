"use client";

import Link from "next/link";
import { useState, type Dispatch, type SetStateAction } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { FULFILLMENT_LABELS, type FulfillmentMethod } from "@/lib/marketplace/search-params";
import { submitCartOrder, ORDER_ERROR_MESSAGES, type SubmittedOrder } from "@/lib/cart/submit-cart-order";
import { refreshMyCart } from "@/lib/cart/refresh-my-cart-client";
import type { CartLineDisplay } from "@/lib/cart/map-cart-row";

type Props = {
  lines: CartLineDisplay[];
  onLinesChange: Dispatch<SetStateAction<CartLineDisplay[]>>;
};

const METHOD_ORDER: FulfillmentMethod[] = ["meetup", "pickup", "local_delivery", "shipping"];

type ShopGroup = {
  shopId: string;
  shopName: string;
  rows: CartLineDisplay[];
  /** Intersection of every row's own fulfillmentMethods (get_my_cart,
   * 0041_get_my_cart_projection_fix.sql) -- the only methods that could
   * possibly satisfy submit_cart_order's per-listing compatibility check
   * for every item in this shop's selection. Empty when no single method
   * works for all of them. */
  availableMethods: FulfillmentMethod[];
};

function intersectMethods(rows: CartLineDisplay[]): FulfillmentMethod[] {
  if (rows.length === 0) return [];
  const common = new Set(rows[0].fulfillmentMethods);
  for (const row of rows.slice(1)) {
    const rowMethods = new Set(row.fulfillmentMethods);
    for (const method of common) {
      if (!rowMethods.has(method)) common.delete(method);
    }
  }
  // Canonical display order, not insertion order.
  return METHOD_ORDER.filter((method) => common.has(method));
}

function groupSubmittableByShop(rows: CartLineDisplay[]): ShopGroup[] {
  const groups = new Map<string, ShopGroup>();
  for (const row of rows) {
    if (!row.shopId) continue;
    const existing = groups.get(row.shopId);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(row.shopId, { shopId: row.shopId, shopName: row.shopName ?? "Unknown shop", rows: [row], availableMethods: [] });
    }
  }
  const result = Array.from(groups.values());
  for (const group of result) {
    group.availableMethods = intersectMethods(group.rows);
  }
  return result;
}

type Result =
  | { kind: "success"; orders: SubmittedOrder[]; shopNames: Record<string, string> }
  | { kind: "error"; message: string };

/**
 * Restrained order-review area on /cart -- not a multi-step checkout
 * wizard. Only rows get_my_cart currently marks submittable are ever
 * offered here; unavailable rows are shown above/below this card (by
 * AuthenticatedCartClient) and are never included in a submission or
 * silently dropped from view.
 *
 * Each shop group only ever offers the fulfillment methods every one of
 * its selected items actually supports (the intersection of their real
 * per-listing fulfillment_methods) -- never all four canonical methods
 * regardless of fit, which would let the buyer pick one guaranteed to
 * fail submit_cart_order's own FULFILLMENT_INVALID check. A group with no
 * common method disables the whole submission (this is one combined
 * multi-seller submission, not per-seller submissions, so a single
 * unresolvable group blocks the batch) rather than guessing or silently
 * dropping that seller's items.
 *
 * The success/error result is this component's own local state, kept
 * independent of `lines` -- so a submission that empties the cart still
 * leaves the confirmation visible instead of being replaced by the
 * generic "Your cart is empty" state the parent renders once lines is []
 * (see AuthenticatedCartClient, which mounts this component unconditionally
 * above that empty-state branch for exactly this reason).
 */
export function OrderReviewSubmit({ lines, onLinesChange }: Props) {
  const { removeItem } = useCart();
  const [fulfillmentChoices, setFulfillmentChoices] = useState<Record<string, FulfillmentMethod | undefined>>({});
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  if (lines.length === 0 && !result) return null;

  const submittableRows = lines.filter((line) => line.isSubmittable);
  const groups = groupSubmittableByShop(submittableRows);
  const hasUnavailable = submittableRows.length < lines.length;
  const hasNoCommonMethodGroup = groups.some((group) => group.availableMethods.length === 0);
  const allChosen = groups.length > 0 && !hasNoCommonMethodGroup && groups.every((group) => fulfillmentChoices[group.shopId]);
  const canSubmit = !isPending && allChosen;
  // Once a submission clears the entire cart, there is nothing left to
  // review -- keep only the confirmation, not a dangling "0 items
  // eligible" form underneath it.
  const showForm = !(result?.kind === "success" && lines.length === 0);

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsPending(true);
    setResult(null);

    const shopNames = Object.fromEntries(groups.map((group) => [group.shopId, group.shopName]));
    const outcome = await submitCartOrder({ rows: submittableRows, fulfillmentChoices });

    if (outcome.ok) {
      for (const listingId of outcome.submittedListingIds) removeItem(listingId);
      setResult({ kind: "success", orders: outcome.orders, shopNames });
      setFulfillmentChoices({});
    } else {
      setResult({ kind: "error", message: ORDER_ERROR_MESSAGES[outcome.code] });
    }

    // Always reconcile against server truth after an attempt -- covers
    // both "remove the rows that were actually submitted" (success) and
    // "reflect whatever changed" (failure) with one mechanism, rather than
    // manually guessing the new state client-side.
    const refreshed = await refreshMyCart();
    if (!refreshed.hadError) {
      onLinesChange(refreshed.lines);
    }

    setIsPending(false);
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface p-4 sm:p-5">
      {result?.kind === "success" && (
        <div role="status" className="mb-4 rounded-[10px] border border-border bg-canvas p-3">
          <p className="text-sm font-semibold text-ink">
            Order submitted successfully. {result.orders.length} {result.orders.length === 1 ? "order was" : "orders were"}{" "}
            created for {result.orders.length} seller{result.orders.length === 1 ? "" : "s"}.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
            {result.orders.map((order) => (
              <li key={order.orderId}>
                {order.orderPublicCode} — {result.shopNames[order.shopId] ?? "Seller"} — {order.itemCount} item
                {order.itemCount === 1 ? "" : "s"} — {formatPriceFromCents(order.totalCents)}
              </li>
            ))}
          </ul>
          <Link
            href="/orders"
            className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            View orders
          </Link>
        </div>
      )}

      {result?.kind === "error" && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {result.message}
        </p>
      )}

      {showForm && (
        <>
          {groups.length > 0 ? (
            <>
              <p className="text-sm font-semibold text-ink">
                {submittableRows.length} item{submittableRows.length === 1 ? "" : "s"} ready to submit
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                Items from different sellers will be created as separate orders. You&apos;ll arrange delivery or meetup
                details directly with each seller after submitting.
              </p>
              {hasUnavailable && (
                <p className="mt-1 text-xs text-ink-muted">
                  Unavailable items above won&apos;t be included and will stay in your cart.
                </p>
              )}

              <div className="mt-3 space-y-3">
                {groups.map((group) => (
                  <div key={group.shopId} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                    {group.availableMethods.length > 0 ? (
                      <label htmlFor={`fulfillment-${group.shopId}`} className="text-sm text-ink">
                        {group.shopName} ({group.rows.length} item{group.rows.length === 1 ? "" : "s"})
                      </label>
                    ) : (
                      <span className="text-sm text-ink">
                        {group.shopName} ({group.rows.length} item{group.rows.length === 1 ? "" : "s"})
                      </span>
                    )}
                    {group.availableMethods.length > 0 ? (
                      <select
                        id={`fulfillment-${group.shopId}`}
                        value={fulfillmentChoices[group.shopId] ?? ""}
                        onChange={(event) =>
                          setFulfillmentChoices((prev) => ({
                            ...prev,
                            [group.shopId]: (event.target.value || undefined) as FulfillmentMethod | undefined,
                          }))
                        }
                        className="h-10 rounded-[10px] border border-border bg-canvas px-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <option value="">Choose a method</option>
                        {group.availableMethods.map((method) => (
                          <option key={method} value={method}>
                            {FULFILLMENT_LABELS[method]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p role="alert" className="max-w-xs text-xs text-danger sm:text-right">
                        These items don&apos;t share a common delivery or pickup method and can&apos;t be submitted together
                        right now.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {hasNoCommonMethodGroup && (
                <p className="mt-3 text-xs text-ink-muted">
                  Resolve the highlighted seller above (e.g. remove an item) before submitting.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-secondary">No items in your cart can be submitted right now.</p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={isPending}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-[10px] bg-brand-action text-sm font-semibold text-brand-action-text hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {isPending ? "Submitting…" : "Submit Order"}
          </button>
        </>
      )}
    </div>
  );
}
