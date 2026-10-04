"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import {
  getAdminReviewState,
  removeReview,
  restoreReview,
  GET_ADMIN_REVIEW_STATE_ERROR_MESSAGES,
  REMOVE_REVIEW_ERROR_MESSAGES,
  RESTORE_REVIEW_ERROR_MESSAGES,
  REVIEW_MODERATION_TEXT_MAX_LENGTH,
} from "@/lib/admin/review-moderation-actions";
import type { GetAdminReviewStateResult } from "@/lib/admin/review-moderation-actions";

type Props = {
  reviewId: string;
};

/** A successful read with null removed_at is "visible"; a timestamp is
 * "removed"; REVIEW_NOT_FOUND is "missing"; anything else is a read error.
 * An unconfirmed mutation also lands in readError ("Recheck"), because it
 * cannot prove whether the change committed. */
type ReviewPanelState =
  | { kind: "loading" }
  | { kind: "readError"; message: string; actionLabel: "Retry" | "Recheck" }
  | { kind: "missing" }
  | { kind: "visible" }
  | { kind: "removed"; removedAt: string; publicMessage: string | null; privateNote: string | null };

function toPanelState(result: GetAdminReviewStateResult): ReviewPanelState {
  if (!result.ok) {
    if (result.code === "REVIEW_NOT_FOUND") return { kind: "missing" };
    return { kind: "readError", message: GET_ADMIN_REVIEW_STATE_ERROR_MESSAGES[result.code], actionLabel: "Retry" };
  }
  const { state } = result;
  if (state.removedAt === null) return { kind: "visible" };
  return {
    kind: "removed",
    removedAt: state.removedAt,
    publicMessage: state.removalPublicMessage,
    privateNote: state.removalPrivateNote,
  };
}

/** Code-point length, matching the RPC's char_length. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function ReviewVisibilityPanel({ reviewId }: Props) {
  const [state, setState] = useState<ReviewPanelState>({ kind: "loading" });
  const [isPending, setIsPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeMessage, setRemoveMessage] = useState("");
  const [removeNote, setRemoveNote] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [restoreNote, setRestoreNote] = useState("");
  // State updates are async, so a ref is what actually blocks a second
  // submission that lands before the disabled attribute re-renders.
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    getAdminReviewState(reviewId).then((result) => {
      if (active) setState(toPanelState(result));
    });
    return () => {
      active = false;
    };
  }, [reviewId]);

  function reload() {
    setState({ kind: "loading" });
    getAdminReviewState(reviewId).then((result) => setState(toPanelState(result)));
  }

  function closeForms() {
    setRemoveOpen(false);
    setRemoveMessage("");
    setRemoveNote("");
    setRestoreOpen(false);
    setRestoreMessage("");
    setRestoreNote("");
  }

  function handleMutationFailure(code: string, message: string) {
    if (code === "REVIEW_NOT_FOUND") {
      closeForms();
      setState({ kind: "missing" });
      return;
    }
    if (code === "UNKNOWN") {
      // The change may have committed. Drop the mutation controls until a
      // fresh read confirms the review's actual state.
      closeForms();
      setState({ kind: "readError", message, actionLabel: "Recheck" });
      return;
    }
    setMutationError(message);
  }

  const removeMessageTrimmed = removeMessage.trim();
  const removeNoteTrimmed = removeNote.trim();
  const removeMessageTooLong = codePointLength(removeMessageTrimmed) > REVIEW_MODERATION_TEXT_MAX_LENGTH;
  const removeNoteTooLong = codePointLength(removeNoteTrimmed) > REVIEW_MODERATION_TEXT_MAX_LENGTH;
  const canSubmitRemove = removeMessageTrimmed !== "" && !removeMessageTooLong && !removeNoteTooLong;

  const restoreMessageTrimmed = restoreMessage.trim();
  const restoreNoteTrimmed = restoreNote.trim();
  const restoreMessageTooLong = codePointLength(restoreMessageTrimmed) > REVIEW_MODERATION_TEXT_MAX_LENGTH;
  const restoreNoteTooLong = codePointLength(restoreNoteTrimmed) > REVIEW_MODERATION_TEXT_MAX_LENGTH;
  const canSubmitRestore = !restoreMessageTooLong && !restoreNoteTooLong;

  async function handleRemove() {
    if (inFlight.current || !canSubmitRemove) return;
    inFlight.current = true;
    setIsPending(true);
    setNotice(null);
    setMutationError(null);

    const result = await removeReview(reviewId, removeMessageTrimmed, removeNoteTrimmed === "" ? null : removeNoteTrimmed);
    inFlight.current = false;
    setIsPending(false);

    if (!result.ok) {
      handleMutationFailure(result.code, REMOVE_REVIEW_ERROR_MESSAGES[result.code]);
      return;
    }

    closeForms();
    if (result.wasAlreadyRemoved) {
      // The stored reason may differ from this submission, so re-read it.
      setNotice("Review was already removed. No change made.");
      reload();
      return;
    }
    setState({
      kind: "removed",
      removedAt: result.removedAt,
      publicMessage: removeMessageTrimmed,
      privateNote: removeNoteTrimmed === "" ? null : removeNoteTrimmed,
    });
    setNotice("Review removed.");
  }

  async function handleRestore() {
    if (inFlight.current || !canSubmitRestore) return;
    inFlight.current = true;
    setIsPending(true);
    setNotice(null);
    setMutationError(null);

    const result = await restoreReview(
      reviewId,
      restoreMessageTrimmed === "" ? null : restoreMessageTrimmed,
      restoreNoteTrimmed === "" ? null : restoreNoteTrimmed,
    );
    inFlight.current = false;
    setIsPending(false);

    if (!result.ok) {
      handleMutationFailure(result.code, RESTORE_REVIEW_ERROR_MESSAGES[result.code]);
      return;
    }

    closeForms();
    setState({ kind: "visible" });
    setNotice(result.wasAlreadyRestored ? "Review was already visible. No change made." : "Review restored.");
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Review visibility</h2>

      {state.kind === "loading" && <p className="mt-2 text-xs text-ink-muted">Checking review visibility…</p>}

      {state.kind === "readError" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-danger">{state.message}</p>
          <button
            type="button"
            onClick={reload}
            className="h-8 shrink-0 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas"
          >
            {state.actionLabel}
          </button>
        </div>
      )}

      {state.kind === "missing" && <p className="mt-2 text-xs text-ink-muted">This review no longer exists.</p>}

      {state.kind === "visible" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <Badge tone="neutral">Visible</Badge>
          {!removeOpen && (
            <button
              type="button"
              onClick={() => {
                setMutationError(null);
                setRemoveOpen(true);
              }}
              disabled={isPending}
              className="h-9 shrink-0 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
            >
              Remove review
            </button>
          )}
        </div>
      )}

      {state.kind === "visible" && removeOpen && (
        <div className="mt-2 space-y-2 rounded-[10px] bg-canvas p-3">
          <p className="text-xs text-ink-secondary">
            Removing hides this review from the app, recalculates the seller&rsquo;s rating and trusted-seller status, and notifies the
            buyer with the reason below. The image files stay publicly reachable by URL.
          </p>
          <label htmlFor="review-remove-message" className="text-xs font-medium text-ink-secondary">
            Reason shown to the buyer (required)
          </label>
          <textarea
            id="review-remove-message"
            value={removeMessage}
            onChange={(event) => setRemoveMessage(event.target.value)}
            disabled={isPending}
            rows={3}
            className="w-full rounded-[10px] border border-border bg-surface p-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          <label htmlFor="review-remove-note" className="text-xs font-medium text-ink-secondary">
            Private admin note (optional, never shown to the buyer)
          </label>
          <textarea
            id="review-remove-note"
            value={removeNote}
            onChange={(event) => setRemoveNote(event.target.value)}
            disabled={isPending}
            rows={2}
            className="w-full rounded-[10px] border border-border bg-surface p-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {removeMessageTooLong && (
            <p className="text-xs text-danger">Please keep the reason to {REVIEW_MODERATION_TEXT_MAX_LENGTH} characters or fewer.</p>
          )}
          {removeNoteTooLong && (
            <p className="text-xs text-danger">Please keep the private note to {REVIEW_MODERATION_TEXT_MAX_LENGTH} characters or fewer.</p>
          )}
          {mutationError && <p className="text-xs text-danger">{mutationError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={isPending || !canSubmitRemove}
              className="h-9 flex-1 rounded-[8px] bg-brand-action px-3 text-xs font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
            >
              {isPending ? "Please wait…" : "Confirm removal"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRemoveOpen(false);
                setRemoveMessage("");
                setRemoveNote("");
                setMutationError(null);
              }}
              disabled={isPending}
              className="h-9 flex-1 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.kind === "removed" && (
        <div className="mt-2 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Badge tone="brand">Removed</Badge>
              <p className="mt-1 text-xs text-ink-muted">Removed {formatOrderDate(state.removedAt)}</p>
              {state.publicMessage && <p className="mt-2 text-xs text-ink-secondary">Reason shown to the buyer: {state.publicMessage}</p>}
              {state.privateNote && <p className="mt-1 text-xs text-ink-secondary">Private admin note: {state.privateNote}</p>}
            </div>
            {!restoreOpen && (
              <button
                type="button"
                onClick={() => {
                  setMutationError(null);
                  setRestoreOpen(true);
                }}
                disabled={isPending}
                className="h-9 shrink-0 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
              >
                Restore review
              </button>
            )}
          </div>

          {restoreOpen && (
            <div className="space-y-2 rounded-[10px] bg-canvas p-3">
              <p className="text-xs text-ink-secondary">
                Restoring makes this review visible again and notifies the buyer. Images removed individually are not affected.
              </p>
              <label htmlFor="review-restore-message" className="text-xs font-medium text-ink-secondary">
                Message to the buyer (optional)
              </label>
              <textarea
                id="review-restore-message"
                value={restoreMessage}
                onChange={(event) => setRestoreMessage(event.target.value)}
                disabled={isPending}
                rows={2}
                className="w-full rounded-[10px] border border-border bg-surface p-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <label htmlFor="review-restore-note" className="text-xs font-medium text-ink-secondary">
                Private admin note (optional, never shown to the buyer)
              </label>
              <textarea
                id="review-restore-note"
                value={restoreNote}
                onChange={(event) => setRestoreNote(event.target.value)}
                disabled={isPending}
                rows={2}
                className="w-full rounded-[10px] border border-border bg-surface p-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              {(restoreMessageTooLong || restoreNoteTooLong) && (
                <p className="text-xs text-danger">Please keep each field to {REVIEW_MODERATION_TEXT_MAX_LENGTH} characters or fewer.</p>
              )}
              {mutationError && <p className="text-xs text-danger">{mutationError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleRestore()}
                  disabled={isPending || !canSubmitRestore}
                  className="h-9 flex-1 rounded-[8px] bg-brand-action px-3 text-xs font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
                >
                  {isPending ? "Please wait…" : "Confirm restore"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRestoreOpen(false);
                    setRestoreMessage("");
                    setRestoreNote("");
                    setMutationError(null);
                  }}
                  disabled={isPending}
                  className="h-9 flex-1 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="mt-2 text-xs text-ink-secondary">
          {notice}
        </p>
      )}
    </div>
  );
}
