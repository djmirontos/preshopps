"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type Props = {
  /** How many units this specific Add to Cart click just added -- never the
   * listing's total cart quantity (which may already have been higher
   * before this click). AddToCartButton always adds exactly one unit per
   * click today, so this is always 1, but the modal reads it as a prop
   * rather than hardcoding "1" so it keeps describing the right thing if
   * that ever changes. */
  quantityAdded: number;
  /** Optional -- shown alongside a thumbnail when both are supplied.
   * Omitted entirely (no broken-image placeholder) if either is missing. */
  listingTitle?: string;
  listingImageUrl?: string;
  onViewCart: () => void;
  onClose: () => void;
};

/**
 * Compact success acknowledgment shown after Add to Cart actually succeeds
 * (P1 task) -- replaces the previous inline "N in cart" text under the
 * button, which tested as visually weak and gave no next-step guidance.
 * Same accessible-overlay pattern already established across this
 * codebase's other small dialogs (AuthGate, ConfirmDialog, the seller
 * fulfillment-transition modal): role=dialog, aria-modal, focus trap,
 * Escape-to-close, visible close button, backdrop click closes. Copied
 * rather than shared for the same reason those components each stayed
 * separate -- this one's body (an optional thumbnail+title row, a plain
 * "View Cart" navigation as the primary action rather than an in-modal
 * mutation) doesn't match any of their shapes closely enough to reuse
 * without bending an existing API for a single new caller.
 */
export function AddToCartSuccessModal({ quantityAdded, listingTitle, listingImageUrl, onViewCart, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

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

  const showThumbnail = Boolean(listingTitle && listingImageUrl);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-to-cart-success-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="add-to-cart-success-title" className="text-base font-semibold text-ink">
              Added to cart
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

          <p className="mt-1.5 text-sm text-ink-secondary">
            {quantityAdded} item{quantityAdded === 1 ? "" : "s"} added to your cart.
          </p>

          {showThumbnail && (
            <div className="mt-3 flex items-center gap-3 rounded-[10px] border border-border bg-canvas p-2.5">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[8px] bg-divider">
                <Image src={listingImageUrl as string} alt="" fill sizes="48px" className="object-cover" />
              </div>
              <p className="line-clamp-2 text-sm font-medium text-ink">{listingTitle}</p>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onViewCart}
              className="flex min-h-12 items-center justify-center rounded-[10px] bg-brand-action px-4 py-3 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              View Cart
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-12 items-center justify-center rounded-[10px] border border-border px-4 py-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Continue Shopping
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
