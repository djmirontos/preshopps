"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/auth/AuthGate";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { ComposeMessageDialog } from "@/components/messaging/ComposeMessageDialog";
import { ReportButton } from "@/components/moderation/ReportButton";
import { useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";
import { startConversation, START_CONVERSATION_ERROR_MESSAGES } from "@/lib/messaging/start-conversation";
import { isDesktopViewport } from "@/lib/ui/viewport";
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
   * "cannot message oneself" rule, and Add to Cart is replaced with a
   * disabled "Your listing" button (set_cart_item_quantity's own
   * CANNOT_BUY_OWN_LISTING check is the authoritative backend guard; the
   * UI never offers a misleading action either). */
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
  const { openConversation } = useFloatingMessenger();
  const isAvailable = status === "available";
  const unavailableNote = UNAVAILABLE_NOTES[status];
  const [isMessageGateOpen, setIsMessageGateOpen] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // w-full (not flex-1) below `sm`: these two buttons are direct flex
  // items of the flex-col/sm:flex-row row below, and in a *column* flex
  // container flex-1's flex-basis:0% applies along the height axis --
  // competing with this shared h-12, and with no vertical padding to
  // give the button any intrinsic content height beyond its text's own
  // line-height, that fight was exactly what made "Message Seller" (and,
  // identically, the disabled "Your listing" button, which shares this
  // same class) render far shorter than the intended 44-48px touch target
  // on mobile. AddToCartButton never hit this because its own h-12
  // button lives inside a plain, unheighted wrapper div -- that div, not
  // the button itself, is the actual flex item, so its explicit height
  // was never in the running for a flex-basis override.
  // sm:w-auto sm:flex-1 restores the exact previous (correct, unaffected)
  // desktop behavior once the layout switches to a row at `sm` --
  // flex-basis:0% there applies to width, which never conflicted with
  // h-12 in the first place.
  const buttonBaseClass = "h-12 w-full sm:w-auto sm:flex-1 rounded-[10px] px-5 text-sm font-semibold";

  async function handleSend(body: string) {
    setIsSending(true);
    setSendError(null);

    const result = await startConversation(shopId, body, listingId);
    setIsSending(false);

    if (!result.ok) {
      setSendError(START_CONVERSATION_ERROR_MESSAGES[result.code]);
      return;
    }

    setIsComposeOpen(false);
    // Desktop: open the floating chat panel right where the conversation
    // was just started, no navigation away from this listing. Mobile has
    // no floating panel (see Part 1's own scope), so it keeps the
    // original full-page route navigation.
    if (isDesktopViewport()) {
      openConversation(result.conversationId);
    } else {
      router.push(`/messages/${result.conversationId}`);
    }
  }

  return (
    <div className="mt-5 space-y-2.5">
      {!isAvailable && unavailableNote && (
        <p className="text-sm font-medium text-ink-secondary">{unavailableNote}</p>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        {!isInquiryOnly && isAvailable && (
          isOwnListing ? (
            <button
              type="button"
              disabled
              className={cn(buttonBaseClass, "cursor-not-allowed bg-divider text-ink-muted")}
            >
              Your listing
            </button>
          ) : (
            <AddToCartButton
              listingId={listingId}
              publicCode={publicCode}
              availableQuantity={availableQuantity}
              className="flex-1"
            />
          )
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
