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
 *
 * Display-reconciliation fix (LAUNCH UX S1.2): upsert_review_reply's own
 * result never returns the saved body text (only reviewId/timestamps -- see
 * lib/reviews/review-reply-actions.ts), and router.refresh() is asynchronous,
 * so the read-only "Your reply" view previously rendered straight from the
 * initialReplyBody PROP, which stays stale until that refresh's server
 * round-trip actually resolves. That produced two real bugs: first-time Add
 * looked completely unchanged (same form, same typed text, Submit
 * re-enabled) with zero visible confirmation until the refresh landed; and
 * Edit could briefly show the OLD reply text right after a successful save,
 * reading as if the edit had failed or reverted. confirmedBody now holds the
 * exact string just sent to the RPC -- set only on a confirmed `result.ok`,
 * never on validation or mutation failure -- and is shown immediately in
 * that same read-only view in place of the stale prop. The RPC's own
 * normalization (0034_reviews_security_and_rpcs.sql's
 * `nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
 * '')`) only trims leading/trailing whitespace -- exactly what `body.trim()`
 * below already does client-side before sending -- so the trimmed value sent
 * to the RPC is already byte-identical to what the server actually stores;
 * there is no separate "server-confirmed body" field to prefer over it.
 *
 * The reviewId reset below follows React's own documented "adjusting state
 * when a prop changes" pattern (comparing the new prop against a mirrored
 * piece of state, and calling setState conditionally directly in the render
 * body) rather than a useEffect -- deliberately, so a props change and its
 * corresponding reset are applied in the SAME render/commit, never leaving
 * an intermediate render where a stale value briefly paired with a
 * brand-new review's props would actually get committed to the DOM.
 *
 * confirmedBody is cleared only once the incoming initialReplyBody prop
 * actually EQUALS it -- never merely because the prop changed to something
 * else. This specifically defends against successive saves on the same
 * review resolving out of order: each save's own router.refresh() is an
 * independent async round-trip, and an OLDER call's response can arrive
 * AFTER a NEWER save has already confirmed locally (e.g. two edits made in
 * quick succession, where the first save's refresh is still in flight when
 * the second is submitted). If clearing were keyed on "the prop changed at
 * all," that late, stale intermediate value would regress the display back
 * to it. Keying it on an exact match instead makes any such stale/
 * out-of-order delivery a no-op -- it simply doesn't equal what's currently
 * confirmed, so it's ignored, and the display stays pinned to the newer
 * value until a prop genuinely carrying that same value eventually arrives.
 */
export function SellerReviewReplyClient({ reviewId, initialReplyBody, canWriteReply }: Props) {
  const router = useRouter();
  const errorId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState(initialReplyBody ?? "");
  const [error, setError] = useState<ReplyError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** The exact trimmed text of the most recent CONFIRMED successful save for
   * THIS review, held only until the server's own refreshed prop catches up.
   * Never set on failure -- see handleSubmit's success-only assignment. */
  const [confirmedBody, setConfirmedBody] = useState<string | null>(null);
  /** Mirrors reviewId as last seen, purely so the reset branch below can
   * detect an actual review CHANGE rather than reset on every render. */
  const [prevReviewId, setPrevReviewId] = useState(reviewId);

  if (reviewId !== prevReviewId) {
    // A DIFFERENT review's props landing on this same mounted instance
    // (e.g. a future list context reusing this component without a `key`
    // change) must never keep showing a previous review's draft, error, or
    // just-confirmed reply text -- full reset.
    setPrevReviewId(reviewId);
    setBody(initialReplyBody ?? "");
    setIsEditing(false);
    setError(null);
    setIsSubmitting(false);
    setConfirmedBody(null);
  } else if (initialReplyBody === confirmedBody && confirmedBody !== null) {
    // The incoming prop must actually MATCH what we already locally
    // confirmed before it's trusted to replace it -- not merely "changed
    // from whatever it was before." router.refresh() calls from two
    // successive saves on the same review can resolve out of order (the
    // OLDER call's server round-trip finishing after the newer one's own
    // DB write and refresh have already landed), and a stale intermediate
    // value arriving late must never be allowed to regress the display back
    // to it. Comparing against confirmedBody itself, rather than "did the
    // prop change at all," makes any such stale/out-of-order delivery a
    // no-op: it simply doesn't match what's currently confirmed, so it's
    // ignored, and displayedReplyBody stays pinned to the newer value until
    // a prop genuinely carrying that same newer value eventually arrives.
    setConfirmedBody(null);
  }

  // The current, reconciled reply text: a just-confirmed save takes
  // priority over the possibly-stale server prop until that prop itself
  // catches up (see above), after which confirmedBody is cleared and this
  // falls back to initialReplyBody automatically.
  const displayedReplyBody = confirmedBody ?? initialReplyBody;
  const hasReply = displayedReplyBody !== null;
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

    setConfirmedBody(trimmed);
    setIsEditing(false);
    router.refresh();
  }

  if (hasReply && !isEditing) {
    return (
      <div className="mt-3 rounded-[10px] bg-canvas p-3">
        <p className="text-xs font-semibold text-ink-secondary">Your reply</p>
        <p className="mt-1 text-sm text-ink">{displayedReplyBody}</p>
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
              setBody(displayedReplyBody ?? "");
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
