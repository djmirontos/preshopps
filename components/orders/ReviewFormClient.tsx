"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { StarRatingInput } from "@/components/reviews/StarRatingInput";
import { ReviewImagePicker } from "@/components/orders/ReviewImagePicker";
import { createReview, updateReview, CREATE_REVIEW_ERROR_MESSAGES, UPDATE_REVIEW_ERROR_MESSAGES } from "@/lib/reviews/review-actions";
import { deleteUploadedImage } from "@/lib/image-processing/upload-image";

const BODY_MAX_LENGTH = 1000;

type Props = {
  mode: "create" | "edit";
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
 * Photos upload immediately on selection via ReviewImagePicker (against
 * the review-images bucket from 0048_media_storage_foundation.sql); Submit
 * is disabled while any photo is still compressing/uploading so a
 * half-finished upload can never be silently dropped from the review.
 * imagePaths always holds the exact set create_review/update_review should
 * receive (existing images kept + newly uploaded ones), reported by the
 * picker on every change.
 *
 * Orphan cleanup, both directions:
 * - Mutation FAILS: only storage objects that did not exist in
 *   initialImagePaths (i.e. uploaded this session) are best-effort
 *   deleted -- a previously-persisted image is never deleted just because
 *   a later edit attempt failed.
 * - Mutation SUCCEEDS (edit mode): any path that was in initialImagePaths
 *   but is no longer in the final saved set (removed or replaced by the
 *   buyer) is best-effort deleted AFTER the RPC confirms success -- never
 *   before, and never a path that's still part of the final saved set.
 *   deleteUploadedImage already never throws and its result is ignored
 *   here on purpose: a cleanup failure (e.g. a transient storage error)
 *   must never turn an already-successful review save into a visible
 *   failure -- it only leaves a harmless orphaned file, logged
 *   server-side by deleteUploadedImage itself, never surfaced to the user.
 */
export function ReviewFormClient({
  mode,
  buyerId,
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
  const [imagePaths, setImagePaths] = useState<string[]>(initialImagePaths);
  const [imagesUploading, setImagesUploading] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bodyTooLong = body.length > BODY_MAX_LENGTH;

  async function cleanUpNewlyUploadedImages(currentPaths: string[]) {
    const newPaths = currentPaths.filter((path) => !initialImagePaths.includes(path));
    await Promise.all(newPaths.map((path) => deleteUploadedImage(path)));
  }

  async function cleanUpRemovedPersistedImages(finalPaths: string[]) {
    const removedPaths = initialImagePaths.filter((path) => !finalPaths.includes(path));
    await Promise.all(removedPaths.map((path) => deleteUploadedImage(path)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    if (rating === null) {
      setRatingError("Please choose a star rating.");
      return;
    }
    setRatingError(null);

    if (bodyTooLong || imagesUploading) {
      return;
    }

    setIsSubmitting(true);
    const trimmedBody = body.trim();
    const bodyToSend = trimmedBody.length > 0 ? trimmedBody : null;

    if (mode === "create") {
      const result = await createReview(orderId, rating, bodyToSend, imagePaths);
      setIsSubmitting(false);
      if (!result.ok) {
        setSubmitError(CREATE_REVIEW_ERROR_MESSAGES[result.code]);
        await cleanUpNewlyUploadedImages(imagePaths);
        return;
      }
    } else {
      const result = await updateReview(reviewId as string, rating, bodyToSend, imagePaths);
      setIsSubmitting(false);
      if (!result.ok) {
        setSubmitError(UPDATE_REVIEW_ERROR_MESSAGES[result.code]);
        await cleanUpNewlyUploadedImages(imagePaths);
        return;
      }
    }

    // Best-effort only -- deleteUploadedImage itself never throws, but this
    // extra guard ensures a cleanup problem can never prevent the already-
    // successful save from navigating away normally (rule: cleanup failure
    // must not make a successfully saved review appear failed).
    try {
      await cleanUpRemovedPersistedImages(imagePaths);
    } catch (err) {
      console.error("Post-save review image cleanup threw:", err instanceof Error ? err.message : err);
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

      <ReviewImagePicker
        buyerId={buyerId}
        orderId={orderId}
        initialPaths={initialImagePaths}
        initialUrls={initialImageUrls}
        onPathsChange={setImagePaths}
        onUploadingChange={setImagesUploading}
      />

      {submitError && <p className="text-sm text-danger">{submitError}</p>}

      <button
        type="submit"
        disabled={isSubmitting || imagesUploading}
        className="h-11 w-full rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
      >
        {isSubmitting ? "Saving…" : imagesUploading ? "Uploading photos…" : mode === "create" ? "Submit review" : "Save changes"}
      </button>
    </form>
  );
}
