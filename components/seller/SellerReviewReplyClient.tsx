"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { upsertReviewReply, UPSERT_REVIEW_REPLY_ERROR_MESSAGES } from "@/lib/reviews/review-reply-actions";
import type { InteractionBlockedPresentation } from "@/lib/moderation/interpret-interaction-blocked";

const REPLY_MAX_LENGTH = 1000;

/** Carries an optional restriction presentation whenever a genuine
 * upsertReviewReply() failure returns one. */
type ReplyError = { message: string; restriction?: InteractionBlockedPresentation };

type Props = {
  reviewId: string;
  initialReplyBody: string | null;
  canWriteReply: boolean;
};

/**
 * Compact reply control -- add (no reply yet), edit (within the reply's own
 * 7-day window), or a plain read-only reply once that window closes.
 * There is no delete action anywhere: upsert_review_reply has no delete
 * path, per the locked "seller cannot delete reply" rule.
 */
export function SellerReviewReplyClient({ reviewId, initialReplyBody, canWriteReply }: Props) {
  const router = useRouter();
  const errorId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState(initialReplyBody ?? "");
  const [error, setError] = useState<ReplyError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasReply = initialReplyBody !== null;
  const bodyTooLong = body.length > REPLY_MAX_LENGTH;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError({ message: "Please write a reply before submitting." });
      return;
    }
    if (bodyTooLong) return;

    setIsSubmitting(true);
    const result = await upsertReviewReply(reviewId, trimmed);
    setIsSubmitting(false);

    if (!result.ok) {
      setError({ message: UPSERT_REVIEW_REPLY_ERROR_MESSAGES[result.code], restriction: result.restriction });
      return;
    }

    setIsEditing(false);
    router.refresh();
  }

  if (hasReply && !isEditing) {
    return (
      <div className="mt-3 rounded-[10px] bg-canvas p-3">
        <p className="text-xs font-semibold text-ink-secondary">Your reply</p>
        <p className="mt-1 text-sm text-ink">{initialReplyBody}</p>
        {canWriteReply ? (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="mt-2 text-sm font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Edit reply
          </button>
        ) : (
          <p className="mt-2 text-xs text-ink-muted">The 7-day edit window for this reply has closed.</p>
        )}
      </div>
    );
  }

  if (!canWriteReply) {
    return null;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2" noValidate>
      <label htmlFor="reply-body" className="text-xs font-semibold text-ink-secondary">
        {hasReply ? "Edit your reply" : "Reply to this review"}
      </label>
      <textarea
        id="reply-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        aria-describedby={errorId}
        aria-invalid={bodyTooLong || Boolean(error)}
        className="w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        placeholder="Thank the buyer or add context."
      />
      <p id={errorId} className={`text-xs ${bodyTooLong ? "text-danger" : "text-ink-muted"}`}>
        {bodyTooLong ? `Please shorten your reply to ${REPLY_MAX_LENGTH} characters or fewer.` : `${body.length}/${REPLY_MAX_LENGTH}`}
      </p>
      {error && (
        <>
          <p className="text-sm text-danger">{error.message}</p>
          {error.restriction && (
            <>
              <p className="mt-1 text-sm text-danger">{error.restriction.message}</p>
              <p className="mt-1 text-sm text-danger">
                <Link href={error.restriction.href} className="font-semibold underline underline-offset-2 hover:no-underline">
                  {error.restriction.ctaLabel}
                </Link>
              </p>
            </>
          )}
        </>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-9 rounded-[10px] bg-brand-action px-3 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Submit reply"}
        </button>
        {hasReply && (
          <button
            type="button"
            onClick={() => {
              setIsEditing(false);
              setBody(initialReplyBody ?? "");
              setError(null);
            }}
            className="h-9 rounded-[10px] border border-border px-3 text-sm font-medium text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
