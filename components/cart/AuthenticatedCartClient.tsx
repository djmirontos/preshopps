"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useCart } from "@/components/cart/CartProvider";
import { CartRow, type CartRowViewModel } from "@/components/cart/CartRow";
import { OrderReviewSubmit } from "@/components/cart/OrderReviewSubmit";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { labelForUnavailableReason } from "@/lib/cart/unavailable-labels";
import type { CartLineDisplay } from "@/lib/cart/get-my-cart";

type Props = {
  initialLines: CartLineDisplay[];
  hadError: boolean;
};

type ShopGroup = {
  shopId: string;
  shopName: string;
  rows: CartLineDisplay[];
};

function groupByShop(lines: CartLineDisplay[]): ShopGroup[] {
  const groups = new Map<string, ShopGroup>();
  for (const line of lines) {
    const key = line.shopId ?? `unknown:${line.listingId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(line);
    } else {
      groups.set(key, { shopId: key, shopName: line.shopName ?? "Unknown shop", rows: [line] });
    }
  }
  return Array.from(groups.values());
}

/** Only rows the buyer could actually proceed with count toward a
 * subtotal -- a sold/reserved/paused row still shows its own last-known
 * line price for reference (handled in CartRow), but is excluded here so
 * the displayed total reflects what could really be submitted. */
function submittableSubtotalCents(rows: CartLineDisplay[]): number {
  return rows.filter((row) => row.isSubmittable).reduce((sum, row) => sum + (row.priceCents ?? 0) * row.quantity, 0);
}

/** formatPriceFromCents(0) renders "Free" -- correct for an actually free
 * listing, but misleading for a group whose only items are unavailable
 * (their real price is simply excluded from the sum, not zero) -- shown
 * as "—" instead so it never reads as "this costs nothing". */
function formatSubtotal(rows: CartLineDisplay[]): string {
  if (!rows.some((row) => row.isSubmittable)) return "—";
  return formatPriceFromCents(submittableSubtotalCents(rows));
}

/**
 * Authenticated /cart body. Mutations call the same set_cart_item_quantity/
 * remove_cart_item RPCs as everywhere else in this module, with optimistic
 * update + rollback on failure -- both on this component's own row list
 * (what's rendered) and on the shared CartProvider (what the header badge
 * and any open listing-detail Add to Cart button read).
 */
export function AuthenticatedCartClient({ initialLines, hadError }: Props) {
  const { setQuantity: setSharedQuantity, removeItem: removeSharedItem } = useCart();
  const [lines, setLines] = useState(initialLines);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ listingId: string; message: string } | null>(null);

  if (hadError) {
    return <p className="text-sm text-ink-secondary">Unable to load your cart right now.</p>;
  }

  async function applyQuantity(line: CartLineDisplay, nextQuantity: number) {
    setRowError(null);
    setBusyId(line.listingId);
    const previousQuantity = line.quantity;

    setLines((prev) => prev.map((l) => (l.listingId === line.listingId ? { ...l, quantity: nextQuantity } : l)));
    setSharedQuantity(line.listingId, line.publicCode, nextQuantity);

    const supabase = createClient();
    const { error } = await supabase.rpc("set_cart_item_quantity", {
      p_listing_id: line.listingId,
      p_quantity: nextQuantity,
    });

    if (error) {
      console.error("set_cart_item_quantity failed:", error.message);
      setLines((prev) => prev.map((l) => (l.listingId === line.listingId ? { ...l, quantity: previousQuantity } : l)));
      setSharedQuantity(line.listingId, line.publicCode, previousQuantity);
      setRowError({ listingId: line.listingId, message: "Couldn't update quantity. Please try again." });
    }
    setBusyId(null);
  }

  async function handleRemove(line: CartLineDisplay) {
    setRowError(null);
    setBusyId(line.listingId);
    const previousLines = lines;

    setLines((prev) => prev.filter((l) => l.listingId !== line.listingId));
    removeSharedItem(line.listingId);

    const supabase = createClient();
    const { error } = await supabase.rpc("remove_cart_item", { p_listing_id: line.listingId });

    if (error) {
      console.error("remove_cart_item failed:", error.message);
      setLines(previousLines);
      setSharedQuantity(line.listingId, line.publicCode, line.quantity);
      setRowError({ listingId: line.listingId, message: "Couldn't remove this item. Please try again." });
    }
    setBusyId(null);
  }

  const groups = groupByShop(lines);
  const overallSubtotal = formatSubtotal(lines);

  return (
    <div className="space-y-6">
      {/* Mounted unconditionally (not inside the lines.length === 0 branch
          below) so its own success/error state survives a submission that
          empties the cart entirely -- see OrderReviewSubmit's own comment. */}
      <OrderReviewSubmit lines={lines} onLinesChange={setLines} />

      {lines.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
          <p className="text-sm font-medium text-ink">Your cart is empty.</p>
          <p className="mt-1 text-sm text-ink-muted">Items you add will appear here.</p>
          <Link
            href="/search"
            className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            Browse listings
          </Link>
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.shopId} className="rounded-[14px] border border-border bg-surface p-4 sm:p-5">
              <p className="text-sm font-semibold text-ink">{group.shopName}</p>
              <div className="mt-2 divide-y divide-divider">
                {group.rows.map((row) => {
                  const viewModel: CartRowViewModel = {
                    listingId: row.listingId,
                    href: row.publicCode ? `/item/${row.publicCode}` : null,
                    title: row.title,
                    imageUrl: row.imageUrl,
                    quantity: row.quantity,
                    unitPriceCents: row.priceCents,
                    availableQuantity: row.availableQuantity,
                    isUnavailable: !row.isSubmittable,
                    unavailableLabel: labelForUnavailableReason(row.unavailableReason),
                  };
                  return (
                    <div key={row.listingId}>
                      <CartRow
                        row={viewModel}
                        isBusy={busyId === row.listingId}
                        onIncrement={() => applyQuantity(row, row.quantity + 1)}
                        onDecrement={() => applyQuantity(row, row.quantity - 1)}
                        onRemove={() => handleRemove(row)}
                      />
                      {rowError?.listingId === row.listingId && (
                        <p role="alert" className="pb-2 text-xs text-danger">
                          {rowError.message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-between border-t border-divider pt-3 text-sm">
                <span className="text-ink-secondary">Subtotal</span>
                <span className="font-semibold tabular-nums text-ink">{formatSubtotal(group.rows)}</span>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-[14px] border border-border bg-canvas p-4 sm:p-5">
            <span className="text-sm font-semibold text-ink">Item subtotal</span>
            <span className="text-lg font-bold tabular-nums text-ink">{overallSubtotal}</span>
          </div>
        </>
      )}
    </div>
  );
}
