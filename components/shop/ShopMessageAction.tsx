"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { AuthGate } from "@/components/auth/AuthGate";
import { ComposeMessageDialog } from "@/components/messaging/ComposeMessageDialog";
import { useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";
import { startConversation, START_CONVERSATION_ERROR_MESSAGES } from "@/lib/messaging/start-conversation";
import { isDesktopViewport } from "@/lib/ui/viewport";

type Props = {
  shopId: string;
  shopSlug: string;
  isAuthenticated: boolean;
  isOwnShop: boolean;
};

/**
 * Restrained "Message Seller" action for the shop page (PRD 25.1's general
 * shop inquiry, distinct from a listing-linked conversation). Hidden
 * entirely for the shop's own owner. Guest gets the existing AuthGate;
 * an authenticated non-owner gets the same compose-and-send flow as
 * ListingActions, calling start_conversation with no p_listing_id.
 */
export function ShopMessageAction({ shopId, shopSlug, isAuthenticated, isOwnShop }: Props) {
  const router = useRouter();
  const { openConversation } = useFloatingMessenger();
  const [isMessageGateOpen, setIsMessageGateOpen] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  if (isOwnShop) return null;

  async function handleSend(body: string) {
    setIsSending(true);
    setSendError(null);

    const result = await startConversation(shopId, body);
    setIsSending(false);

    if (!result.ok) {
      setSendError(START_CONVERSATION_ERROR_MESSAGES[result.code]);
      return;
    }

    setIsComposeOpen(false);
    // Desktop: open the floating chat panel right where the conversation
    // was just started, no navigation away from this shop page. Mobile
    // has no floating panel, so it keeps the original full-page route
    // navigation.
    if (isDesktopViewport()) {
      openConversation(result.conversationId);
    } else {
      router.push(`/messages/${result.conversationId}`);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (isAuthenticated ? setIsComposeOpen(true) : setIsMessageGateOpen(true))}
        className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border px-3 text-sm font-medium text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        Message Seller
      </button>

      {isMessageGateOpen && (
        <AuthGate
          title="Sign in to message this seller"
          reason="Create a free account to message sellers directly."
          next={`/shop/${shopSlug}`}
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
    </>
  );
}
