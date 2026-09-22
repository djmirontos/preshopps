"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  publishListing,
  acceptSellerPolicies,
  PUBLISH_LISTING_ERROR_MESSAGES,
  ACCEPT_SELLER_POLICIES_ERROR_MESSAGES,
} from "@/lib/seller/listing-actions";
import { notifySuccess } from "@/lib/notifications/toast";
import { SellerPolicyConsentDialog } from "@/components/seller/SellerPolicyConsentDialog";
import type { InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";

type PublishError = { message: string; restriction?: InteractionBlockedPresentation };

type Props = {
  /** True once the CURRENT form state and photos satisfy every
   * publish_listing completeness rule the sibling ListingForm/
   * ListingImagesPicker components mirror (see CreateListingWorkspace's
   * own comment for how the two signals are combined). Rendered and
   * enabled from page load -- never gated on a draft already existing or
   * on Save Draft having been clicked first. */
  canPublish: boolean;
  /** Ensures exactly one draft/listing id exists (creating one from
   * current seller-entered values if this is the very first persisted
   * action for this listing) and persists every current unsaved form
   * value to it -- i.e. does exactly what Save Draft does, without
   * requiring the seller to click it first. Resolves to the listing id to
   * publish, or null on failure (a client-side field error, now visible
   * inline on the form, or a failed create/update RPC call, surfaced via
   * the form's own existing error state). */
  ensureAndPersist: () => Promise<string | null>;
};

/**
 * Publish action for the initial Create Listing page. Deliberately a
 * separate component from the edit page's own PublishListingButton rather
 * than a shared/generalized one: that component's contract (a required,
 * already-real listingId, gated on isDirty) is confirmed working and must
 * not change, and this page's own requirement -- rendering unconditionally
 * before any draft exists, gated on live form+photo completeness instead
 * of "no unsaved changes," and ensuring+persisting a draft just before
 * publishing -- is different enough to warrant its own small component
 * instead of bending PublishListingButton's props to cover both shapes.
 * The actual publish_listing call and the reactive seller-policy consent
 * dialog below are intentionally identical in behavior to
 * PublishListingButton's own (same RPCs, same retry-once-after-consent
 * flow) -- duplicated rather than shared, since coupling the two pages'
 * button components together for a handful of lines isn't worth the
 * cross-page risk.
 */
export function CreateListingPublishButton({ canPublish, ensureAndPersist }: Props) {
  const router = useRouter();
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<PublishError | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [pendingListingId, setPendingListingId] = useState<string | null>(null);

  async function handlePublishClick() {
    if (!canPublish || isPublishing) return;

    setIsPublishing(true);
    setPublishError(null);

    const listingId = await ensureAndPersist();
    if (!listingId) {
      setIsPublishing(false);
      setPublishError({ message: "Couldn't save your listing. Please try again." });
      return;
    }

    const result = await publishListing(listingId);
    setIsPublishing(false);

    if (result.ok) {
      notifySuccess("Listing published");
      router.push(`/item/${result.publicCode}`);
      return;
    }

    if (result.code === "SELLER_POLICIES_NOT_ACCEPTED") {
      setPendingListingId(listingId);
      setShowConsent(true);
      return;
    }

    setPublishError({ message: PUBLISH_LISTING_ERROR_MESSAGES[result.code], restriction: result.restriction });
  }

  async function handleAcceptAndPublish() {
    if (!pendingListingId) return;
    setIsAccepting(true);
    setConsentError(null);

    const acceptResult = await acceptSellerPolicies();
    if (!acceptResult.ok) {
      setIsAccepting(false);
      setConsentError(ACCEPT_SELLER_POLICIES_ERROR_MESSAGES[acceptResult.code]);
      return;
    }

    const publishResult = await publishListing(pendingListingId);
    setIsAccepting(false);

    if (publishResult.ok) {
      setShowConsent(false);
      notifySuccess("Listing published");
      router.push(`/item/${publishResult.publicCode}`);
      return;
    }

    // Acceptance itself succeeded -- the retry failed for some other, now
    // real reason (e.g. a completeness gap discovered only now). Resolve
    // the consent dialog and surface the actual publish error on the main
    // action, rather than looping back into the dialog again.
    setShowConsent(false);
    setPublishError({ message: PUBLISH_LISTING_ERROR_MESSAGES[publishResult.code], restriction: publishResult.restriction });
  }

  function handleCancelConsent() {
    if (isAccepting) return;
    setShowConsent(false);
    setConsentError(null);
  }

  return (
    <div>
      {publishError && (
        <div className="mb-2">
          <p className="text-sm text-danger">{publishError.message}</p>
          {publishError.restriction && (
            <p className="mt-1 text-sm text-danger">
              {publishError.restriction.message}{" "}
              <Link href={publishError.restriction.href} className="font-semibold underline underline-offset-2 hover:no-underline">
                {publishError.restriction.ctaLabel}
              </Link>
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handlePublishClick()}
        disabled={!canPublish || isPublishing}
        className="h-11 w-full rounded-[10px] bg-brand-action px-5 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
      >
        {isPublishing ? "Publishing…" : "Publish Listing"}
      </button>

      {showConsent && (
        <SellerPolicyConsentDialog
          isPending={isAccepting}
          errorMessage={consentError}
          onAccept={() => void handleAcceptAndPublish()}
          onClose={handleCancelConsent}
        />
      )}
    </div>
  );
}
