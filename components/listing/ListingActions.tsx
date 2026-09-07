"use client";

import { useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { cn } from "@/lib/cn";
import type { ListingStatus } from "@/lib/marketplace/listing-detail";

type Props = {
  listingId: string;
  publicCode: string;
  availableQuantity: number;
  status: ListingStatus;
  isInquiryOnly: boolean;
  isAuthenticated: boolean;
  /** Safe internal path to return to after sign-in (see
   * lib/auth/safe-redirect.ts) -- this listing's own canonical route. */
  next: string;
};

const UNAVAILABLE_NOTES: Partial<Record<ListingStatus, string>> = {
  reserved: "This item is currently reserved.",
  sold: "This item has already been sold.",
  archived: "This listing is archived and no longer available.",
};

/**
 * Add to Cart is now real (set_cart_item_quantity / local guest cart, see
 * components/cart/AddToCartButton.tsx) -- a guest adds directly, no auth
 * gate, per PRD S20.1. Message Seller remains the existing honest
 * "coming soon" placeholder gated behind sign-in for a guest -- messaging
 * itself is out of scope for the Cart module.
 */
export function ListingActions({
  listingId,
  publicCode,
  availableQuantity,
  status,
  isInquiryOnly,
  isAuthenticated,
  next,
}: Props) {
  const isAvailable = status === "available";
  const unavailableNote = UNAVAILABLE_NOTES[status];
  const [isMessageGateOpen, setIsMessageGateOpen] = useState(false);

  const buttonBaseClass = "h-12 flex-1 rounded-[10px] px-5 text-sm font-semibold";

  return (
    <div className="mt-5 space-y-2.5">
      {!isAvailable && unavailableNote && (
        <p className="text-sm font-medium text-ink-secondary">{unavailableNote}</p>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        {!isInquiryOnly && isAvailable && (
          <AddToCartButton
            listingId={listingId}
            publicCode={publicCode}
            availableQuantity={availableQuantity}
            className="flex-1"
          />
        )}

        <button
          type="button"
          disabled={isAuthenticated}
          aria-disabled={isAuthenticated ? "true" : undefined}
          onClick={isAuthenticated ? undefined : () => setIsMessageGateOpen(true)}
          className={cn(
            buttonBaseClass,
            "border border-border bg-surface text-ink",
            isAuthenticated ? "cursor-not-allowed opacity-60" : "hover:bg-canvas",
          )}
        >
          Message Seller
        </button>
      </div>

      <p className="text-xs text-ink-muted">Messaging is coming soon.</p>

      {isMessageGateOpen && (
        <AuthGate
          title="Sign in to message this seller"
          reason="Create a free account to message sellers directly."
          next={next}
          onClose={() => setIsMessageGateOpen(false)}
        />
      )}
    </div>
  );
}
