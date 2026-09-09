"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth/AuthGate";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { ComposeMessageDialog } from "@/components/messaging/ComposeMessageDialog";
import { ReportButton } from "@/components/moderation/ReportButton";
import { startConversation, START_CONVERSATION_ERROR_MESSAGES } from "@/lib/messaging/start-conversation";
import { cn } from "@/lib/cn";
import type { ListingStatus } from "@/lib/marketplace/listing-detail";

type Props = {
  listingId: string;
  publicCode: string;
  shopId: string;
  availableQuantity: number;
  status: ListingStatus;
  isInquiryOnly: boolean;
  isAuthenticated: boolean;
  /** True when the viewer owns the shop this listing belongs to -- the
   * Message Seller action is never shown in that case, per this module's
   * "cannot message oneself" rule (the backend also structurally rejects
   * it, but the UI never offers a misleading action either). */
  isOwnListing: boolean;
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
 * Add to Cart is real (set_cart_item_quantity / local guest cart, see
 * components/cart/AddToCartButton.tsx) -- a guest adds directly, no auth
 * gate, per PRD S20.1. Message Seller is now real too: an authenticated
 * non-owner opens a compose dialog that calls start_conversation (finding
 * or reusing the canonical listing conversation, per PRD 25.2) and
 * navigates to it; a guest still gets the existing AuthGate.
 */
export function ListingActions({
  listingId,
  publicCode,
  shopId,
  availableQuantity,
  status,
  isInquiryOnly,
  isAuthenticated,
  isOwnListing,
  next,
}: Props) {
  const router = useRouter();
  const isAvailable = status === "available";
  const unavailableNote = UNAVAILABLE_NOTES[status];
  const [isMessageGateOpen, setIsMessageGateOpen] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const buttonBaseClass = "h-12 flex-1 rounded-[10px] px-5 text-sm font-semibold";

  async function handleSend(body: string) {
    setIsSending(true);
    setSendError(null);

    const result = await startConversation(shopId, body, listingId);
    setIsSending(false);

    if (!result.ok) {
      setSendError(START_CONVERSATION_ERROR_MESSAGES[result.code]);
      return;
    }

    router.push(`/messages/${result.conversationId}`);
  }

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

        {!isOwnListing && (
          <button
            type="button"
            onClick={() => (isAuthenticated ? setIsComposeOpen(true) : setIsMessageGateOpen(true))}
            className={cn(buttonBaseClass, "border border-border bg-surface text-ink hover:bg-canvas")}
          >
            Message Seller
          </button>
        )}
      </div>

      {isMessageGateOpen && (
        <AuthGate
          title="Sign in to message this seller"
          reason="Create a free account to message sellers directly."
          next={next}
          onClose={() => setIsMessageGateOpen(false)}
        />
      )}

      {isComposeOpen && (
        <ComposeMessageDialog
          title="Message Seller"
          isPending={isSending}
          errorMessage={sendError}
          onSend={handleSend}
          onClose={() => setIsComposeOpen(false)}
        />
      )}

      <ReportButton
        targetType="listing"
        targetId={listingId}
        targetLabel="listing"
        isAuthenticated={isAuthenticated}
        hidden={isOwnListing}
        next={next}
      />
    </div>
  );
}
