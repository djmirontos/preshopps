"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  publishListing,
  acceptSellerPolicies,
  PUBLISH_LISTING_ERROR_MESSAGES,
  ACCEPT_SELLER_POLICIES_ERROR_MESSAGES,
} from "@/lib/seller/listing-actions";
import { SellerPolicyConsentDialog } from "@/components/seller/SellerPolicyConsentDialog";
import type { MyListingStatus } from "@/lib/seller/get-my-listing";

type Props = {
  listingId: string;
  /** Only a Draft listing can be published (PRD 10.6) -- publish_listing
   * itself is the authoritative gate (LISTING_NOT_DRAFT), but the button is
   * hidden outright for a non-draft status so a seller is never invited to
   * take an action the backend would just reject. */
  status: MyListingStatus;
  /** True whenever ListingForm's own textual/details state has unsaved
   * changes against its last-saved baseline (see ListingForm's own
   * onDirtyChange comment). Publishing while dirty would publish stale
   * server data, so Publish is disabled with a clear message instead --
   * no autosave, no silent Save-then-Publish. */
  isDirty: boolean;
};

/**
 * Publish button for the seller Draft edit page. Kept entirely separate
 * from ListingForm's own Save Draft (different RPC, different semantics:
 * update_listing's partial patch vs publish_listing's strict, authoritative
 * completeness boundary) -- this component never calls update_listing and
 * never mutates ListingForm's own state.
 *
 * Reactive seller-policy-acceptance flow (locked UX decision, not a
 * pre-read): the first publish_listing call is always attempted directly.
 * Only if it returns SELLER_POLICIES_NOT_ACCEPTED does the consent dialog
 * appear; accepting immediately retries the exact same publish_listing
 * call once. This file never reads or caches acceptance state up front.
 */
export function PublishListingButton({ listingId, status, isDirty }: Props) {
  const router = useRouter();
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  if (status !== "draft") {
    return null;
  }

  async function handlePublishClick() {
    if (isDirty || isPublishing) return;

    setIsPublishing(true);
    setPublishError(null);

    const result = await publishListing(listingId);
    setIsPublishing(false);

    if (result.ok) {
      router.push(`/item/${result.publicCode}`);
      return;
    }

    if (result.code === "SELLER_POLICIES_NOT_ACCEPTED") {
      setShowConsent(true);
      return;
    }

    setPublishError(PUBLISH_LISTING_ERROR_MESSAGES[result.code]);
  }

  async function handleAcceptAndPublish() {
    setIsAccepting(true);
    setConsentError(null);

    const acceptResult = await acceptSellerPolicies();
    if (!acceptResult.ok) {
      setIsAccepting(false);
      setConsentError(ACCEPT_SELLER_POLICIES_ERROR_MESSAGES[acceptResult.code]);
      return;
    }

    const publishResult = await publishListing(listingId);
    setIsAccepting(false);

    if (publishResult.ok) {
      setShowConsent(false);
      router.push(`/item/${publishResult.publicCode}`);
      return;
    }

    // Acceptance itself succeeded -- the retry failed for some other, now
    // real reason (e.g. a completeness gap discovered only now). Resolve
    // the consent dialog and surface the actual publish error on the main
    // action, rather than looping back into the dialog again.
    setShowConsent(false);
    setPublishError(PUBLISH_LISTING_ERROR_MESSAGES[publishResult.code]);
  }

  function handleCancelConsent() {
    if (isAccepting) return;
    setShowConsent(false);
    setConsentError(null);
  }

  return (
    <div>
      {isDirty && <p className="mb-2 text-xs text-ink-muted">Save your Draft changes before publishing.</p>}
      {publishError && <p className="mb-2 text-sm text-danger">{publishError}</p>}

      <button
        type="button"
        onClick={() => void handlePublishClick()}
        disabled={isDirty || isPublishing}
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
