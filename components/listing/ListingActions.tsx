"use client";

import { useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { cn } from "@/lib/cn";
import type { ListingStatus } from "@/lib/marketplace/listing-detail";

type Props = {
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

type GateKind = "cart" | "message" | null;

const GATE_COPY: Record<Exclude<GateKind, null>, { title: string; reason: string }> = {
  cart: { title: "Sign in to add to cart", reason: "Create a free account to add items to your cart." },
  message: {
    title: "Sign in to message this seller",
    reason: "Create a free account to message sellers directly.",
  },
};

/**
 * A guest clicking Add to Cart or Message Seller sees the auth gate --
 * this is only auth interception, not real feature behavior. An
 * authenticated user still sees the existing disabled, honest "coming
 * soon" buttons (no cart/order/messaging backend exists yet, so nothing
 * here ever pretends an action succeeded).
 */
export function ListingActions({ status, isInquiryOnly, isAuthenticated, next }: Props) {
  const isAvailable = status === "available";
  const unavailableNote = UNAVAILABLE_NOTES[status];
  const [openGate, setOpenGate] = useState<GateKind>(null);

  const buttonBaseClass = "h-12 flex-1 rounded-[10px] px-5 text-sm font-semibold";

  return (
    <div className="mt-5 space-y-2.5">
      {!isAvailable && unavailableNote && (
        <p className="text-sm font-medium text-ink-secondary">{unavailableNote}</p>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        {!isInquiryOnly && isAvailable && (
          <button
            type="button"
            disabled={isAuthenticated}
            aria-disabled={isAuthenticated ? "true" : undefined}
            onClick={isAuthenticated ? undefined : () => setOpenGate("cart")}
            className={cn(
              buttonBaseClass,
              "bg-brand-hover text-white",
              isAuthenticated ? "cursor-not-allowed opacity-60" : "hover:brightness-95",
            )}
          >
            Add to Cart
          </button>
        )}

        <button
          type="button"
          disabled={isAuthenticated}
          aria-disabled={isAuthenticated ? "true" : undefined}
          onClick={isAuthenticated ? undefined : () => setOpenGate("message")}
          className={cn(
            buttonBaseClass,
            "border border-border bg-surface text-ink",
            isAuthenticated ? "cursor-not-allowed opacity-60" : "hover:bg-canvas",
          )}
        >
          Message Seller
        </button>
      </div>

      <p className="text-xs text-ink-muted">Cart and messaging are coming soon.</p>

      {openGate && (
        <AuthGate
          title={GATE_COPY[openGate].title}
          reason={GATE_COPY[openGate].reason}
          next={next}
          onClose={() => setOpenGate(null)}
        />
      )}
    </div>
  );
}
