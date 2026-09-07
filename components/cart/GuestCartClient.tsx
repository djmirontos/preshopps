"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";
import { CartRow, type CartRowViewModel } from "@/components/cart/CartRow";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { readGuestCart, writeGuestCart, type GuestCartLine } from "@/lib/cart/guest-cart-storage";
import { hydrateGuestCartLines, type HydratedGuestCartLine } from "@/lib/cart/hydrate-guest-cart-client";
import { isGuestLineSubmittable, guestUnavailableReason, labelForUnavailableReason } from "@/lib/cart/unavailable-labels";

type ShopGroup = {
  shopId: string;
  shopName: string;
  rows: HydratedGuestCartLine[];
};

function groupByShop(lines: HydratedGuestCartLine[]): ShopGroup[] {
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

function submittableSubtotalCents(rows: HydratedGuestCartLine[]): number {
  return rows.filter(isGuestLineSubmittable).reduce((sum, row) => sum + (row.priceCents ?? 0) * row.quantity, 0);
}

/** formatPriceFromCents(0) renders "Free" -- correct for an actually free
 * listing, but misleading for a group whose only items are unavailable
 * (their real price is simply excluded from the sum, not zero) -- shown
 * as "—" instead so it never reads as "this costs nothing". */
function formatSubtotal(rows: HydratedGuestCartLine[]): string {
  if (!rows.some(isGuestLineSubmittable)) return "—";
  return formatPriceFromCents(submittableSubtotalCents(rows));
}

/**
 * Guest /cart body. Guest cart storage only ever holds
 * {listingId, publicCode, quantity} (lib/cart/guest-cart-storage.ts), so
 * this component hydrates fresh display data client-side via
 * hydrateGuestCartLines on mount, then treats the hydrated result as the
 * editable row list -- every mutation re-persists {listingId, publicCode,
 * quantity} back to localStorage and updates the shared CartProvider so
 * the header badge and any listing-detail Add to Cart button stay in
 * sync, exactly like the authenticated cart.
 */
export function GuestCartClient() {
  const { setQuantity: setSharedQuantity, removeItem: removeSharedItem } = useCart();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [lines, setLines] = useState<HydratedGuestCartLine[]>([]);

  useEffect(() => {
    let cancelled = false;

    // Always routed through the same promise chain (hydrateGuestCartLines
    // on an empty array just resolves to [] immediately, with no RPC
    // calls) so every setState call here happens inside a .then()/.catch()
    // callback rather than synchronously in the effect body.
    hydrateGuestCartLines(readGuestCart())
      .then((hydrated) => {
        if (cancelled) return;
        setLines(hydrated);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to hydrate guest cart:", err instanceof Error ? err.message : err);
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function persist(nextLines: HydratedGuestCartLine[]) {
    setLines(nextLines);
    writeGuestCart(
      nextLines.map((line): GuestCartLine => ({ listingId: line.listingId, publicCode: line.publicCode, quantity: line.quantity })),
    );
  }

  function handleIncrement(line: HydratedGuestCartLine) {
    const nextQuantity = line.quantity + 1;
    persist(lines.map((l) => (l.listingId === line.listingId ? { ...l, quantity: nextQuantity } : l)));
    setSharedQuantity(line.listingId, line.publicCode, nextQuantity);
  }

  function handleDecrement(line: HydratedGuestCartLine) {
    const nextQuantity = Math.max(1, line.quantity - 1);
    persist(lines.map((l) => (l.listingId === line.listingId ? { ...l, quantity: nextQuantity } : l)));
    setSharedQuantity(line.listingId, line.publicCode, nextQuantity);
  }

  function handleRemove(line: HydratedGuestCartLine) {
    persist(lines.filter((l) => l.listingId !== line.listingId));
    removeSharedItem(line.listingId);
  }

  if (status === "loading") {
    return <p className="text-sm text-ink-secondary">Loading your cart…</p>;
  }

  if (status === "error") {
    return <p className="text-sm text-ink-secondary">Unable to load your cart right now.</p>;
  }

  if (lines.length === 0) {
    return (
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
    );
  }

  const groups = groupByShop(lines);
  const overallSubtotal = formatSubtotal(lines);

  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-muted">Sign in to keep this cart saved to your account.</p>

      {groups.map((group) => (
        <div key={group.shopId} className="rounded-[14px] border border-border bg-surface p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink">{group.shopName}</p>
          <div className="mt-2 divide-y divide-divider">
            {group.rows.map((line) => {
              const viewModel: CartRowViewModel = {
                listingId: line.listingId,
                href: line.found ? `/item/${line.publicCode}` : null,
                title: line.title,
                imageUrl: line.imageUrl,
                quantity: line.quantity,
                unitPriceCents: line.priceCents,
                availableQuantity: line.availableQuantity,
                isUnavailable: !isGuestLineSubmittable(line),
                unavailableLabel: labelForUnavailableReason(guestUnavailableReason(line)),
              };
              return (
                <CartRow
                  key={line.listingId}
                  row={viewModel}
                  onIncrement={() => handleIncrement(line)}
                  onDecrement={() => handleDecrement(line)}
                  onRemove={() => handleRemove(line)}
                />
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

      {/* Order submission requires an account (PRD/AGENTS.md: guests may
          build/view a cart but not submit an order) -- the primary action
          here leads to sign-in rather than attempting any submission, and
          never auto-creates an account. next=/cart is a fixed, known-safe
          internal path, not user input. */}
      <div className="rounded-[14px] border border-border bg-surface p-4 text-center sm:p-5">
        <p className="text-sm text-ink-secondary">Sign in to submit your order.</p>
        <Link
          href={`/sign-in?next=${encodeURIComponent("/cart")}`}
          className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Sign in to Checkout
        </Link>
      </div>
    </div>
  );
}
