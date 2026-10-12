"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StarRatingInput } from "@/components/reviews/StarRatingInput";
import { ReviewImagePicker } from "@/components/orders/ReviewImagePicker";
import { createReview, updateReview, CREATE_REVIEW_ERROR_MESSAGES, UPDATE_REVIEW_ERROR_MESSAGES } from "@/lib/reviews/review-actions";
import { notifySuccess } from "@/lib/notifications/toast";
import type { InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";

const BODY_MAX_LENGTH = 1000;

/** Carries an optional restriction presentation whenever a genuine
 * createReview() or updateReview() failure returns one -- create mode can
 * confirm account_suspended or buyer_restricted; edit mode can confirm only
 * account_suspended (update_review deliberately never blocks editing for
 * buyer_restricted alone). Both branches propagate result.restriction
 * unchanged; only the wrapped RPC/array differs. */
type SubmitError = { message: string; restriction?: InteractionBlockedPresentation };

type Props = {
  mode: "create" | "edit";
  /** Unused since the pilot photo restriction (0118) removed the upload
   * control that needed it (ReviewImagePicker no longer uploads anything,
   * so it no longer needs the owner id to scope the upload path). Kept in
   * this type, rather than removed, only so existing call sites don't need
   * an unrelated prop-drop edit; never read in this component's body. */
  buyerId: string;
  orderId: string;
  orderPublicCode: string;
  reviewId?: string;
  initialRating?: number;
  initialBody?: string;
  initialImagePaths?: string[];
  initialImageUrls?: string[];
  purchasedItemTitles: string[];
};

/**
 * One form serves both create and edit -- the only difference is which RPC
 * wrapper is called and which initial values are prefilled. No product-
 * specific rating field: the purchased items are shown as read-only
 * context only, per the locked "seller-focused, not a product rating"
 * rule.
 *
 * PILOT RESTRICTION (0118_pilot_disable_new_review_photos.sql): photo
 * upload/removal is temporarily disabled. ReviewImagePicker is now a
 * read-only display of initialImagePaths/initialImageUrls -- it never
 * reports a change, so the exact same array is sent to create_review/
 * update_review on every submit. A create-mode review therefore always
 * submits zero photos (there is nothing to preserve yet); an edit-mode
 * review always resubmits its existing photos completely unchanged,
 * letting a buyer freely edit rating/text without being forced to touch
 * or lose them. There is no longer any upload/orphan-cleanup path in this
 * component -- nothing here can ever create or delete a Storage object.
 * Server-side, create_review/update_review independently reject any
 * genuinely new photo path with REVIEW_IMAGES_DISABLED; this component
 * hiding the picker is a UX convenience only, never the enforcement
 * boundary.
 *
 * Edit-mode confirmation: a successful update_review call fires exactly
 * one notifySuccess("Review updated") toast, right before the existing
 * navigation. Create mode is unchanged -- it keeps its existing
 * navigation-only confirmation (no toast).
 */
export function ReviewFormClient({
  mode,
  orderId,
  orderPublicCode,
  reviewId,
  initialRating,
  initialBody,
  initialImagePaths = [],
  initialImageUrls = [],
  purchasedItemTitles,
}: Props) {
  const router = useRouter();
  const ratingErrorId = useId();
  const bodyErrorId = useId();

  const [rating, setRating] = useState<number | null>(initialRating ?? null);
  const [body, setBody] = useState(initialBody ?? "");
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bodyTooLong = body.length > BODY_MAX_LENGTH;
  // Never changes after mount (the picker is read-only) -- always exactly
  // the set create_review/update_review should receive.
  const imagePaths = initialImagePaths;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    if (rating === null) {
      setRatingError("Please choose a star rating.");
      return;
    }
    setRatingError(null);

    if (bodyTooLong) {
      return;
    }

    setIsSubmitting(true);
    const trimmedBody = body.trim();
    const bodyToSend = trimmedBody.length > 0 ? trimmedBody : null;

    if (mode === "create") {
      const result = await createReview(orderId, rating, bodyToSend, imagePaths);
      if (!result.ok) {
        setSubmitError({ message: CREATE_REVIEW_ERROR_MESSAGES[result.code], restriction: result.restriction });
        setIsSubmitting(false);
        return;
      }
    } else {
      const result = await updateReview(reviewId as string, rating, bodyToSend, imagePaths);
      if (!result.ok) {
        setSubmitError({ message: UPDATE_REVIEW_ERROR_MESSAGES[result.code], restriction: result.restriction });
        setIsSubmitting(false);
        return;
      }
    }

    // Edit only -- create keeps its existing, unchanged navigation-only
    // confirmation. Fires only once updateReview() has already confirmed
    // success above, and always before the navigation below.
    if (mode === "edit") {
      notifySuccess("Review updated");
    }

    router.push(`/orders/${orderPublicCode}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
      {purchasedItemTitles.length > 0 && (
        <div>
          <p className="text-xs font-medium text-ink-muted">You bought</p>
          <p className="mt-0.5 text-sm text-ink">{purchasedItemTitles.join(", ")}</p>
        </div>
      )}

      <div>
        <StarRatingInput value={rating} onChange={(next) => { setRating(next); setRatingError(null); }} errorId={ratingErrorId} />
        {ratingError && (
          <p id={ratingErrorId} className="mt-1.5 text-sm text-danger">
            {ratingError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="review-body" className="text-sm font-medium text-ink">
          Your review <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          maxLength={BODY_MAX_LENGTH + 200}
          aria-describedby={bodyErrorId}
          aria-invalid={bodyTooLong}
          className="mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          placeholder="Share what buying from this seller was like."
        />
        <p id={bodyErrorId} className={`mt-1 text-xs ${bodyTooLong ? "text-danger" : "text-ink-muted"}`}>
          {bodyTooLong ? `Please shorten your review to ${BODY_MAX_LENGTH} characters or fewer.` : `${body.length}/${BODY_MAX_LENGTH}`}
        </p>
      </div>

      <ReviewImagePicker initialPaths={initialImagePaths} initialUrls={initialImageUrls} />

      {submitError && (
        <>
          <p className="text-sm text-danger">{submitError.message}</p>
          {submitError.restriction && (
            <>
              <p className="mt-1 text-sm text-danger">{submitError.restriction.message}</p>
              <p className="mt-1 text-sm text-danger">
                <Link href={submitError.restriction.href} className="font-semibold underline underline-offset-2 hover:no-underline">
                  {submitError.restriction.ctaLabel}
                </Link>
              </p>
            </>
          )}
        </>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-11 w-full rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
      >
        {isSubmitting ? "Saving…" : mode === "create" ? "Submit review" : "Save changes"}
      </button>
    </form>
  );
}
