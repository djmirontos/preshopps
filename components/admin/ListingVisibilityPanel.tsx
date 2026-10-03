"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import {
  getListingHideState,
  hideListing,
  unhideListing,
  GET_LISTING_HIDE_STATE_ERROR_MESSAGES,
  HIDE_LISTING_ERROR_MESSAGES,
  UNHIDE_LISTING_ERROR_MESSAGES,
  UNHIDE_NOTE_MAX_LENGTH,
} from "@/lib/admin/listing-hide-actions";
import type { GetListingHideStateResult } from "@/lib/admin/listing-hide-actions";

type Props = {
  listingId: string;
};

/** Four distinct states: a successful read of a null timestamp is "visible",
 * a timestamp is "hidden", LISTING_NOT_FOUND is "missing", and anything else
 * is a read failure. A read failure never falls back to "visible". An
 * unconfirmed mutation also lands in readError, labelled "Recheck", because
 * it cannot prove whether the change committed. */
type VisibilityState =
  | { kind: "loading" }
  | { kind: "readError"; message: string; actionLabel: "Retry" | "Recheck" }
  | { kind: "missing" }
  | { kind: "visible" }
  | { kind: "hidden"; hiddenAt: string };

function toVisibilityState(result: GetListingHideStateResult): VisibilityState {
  if (!result.ok) {
    if (result.code === "LISTING_NOT_FOUND") return { kind: "missing" };
    return { kind: "readError", message: GET_LISTING_HIDE_STATE_ERROR_MESSAGES[result.code], actionLabel: "Retry" };
  }
  return result.hiddenAt === null ? { kind: "visible" } : { kind: "hidden", hiddenAt: result.hiddenAt };
}

export function ListingVisibilityPanel({ listingId }: Props) {
  const [state, setState] = useState<VisibilityState>({ kind: "loading" });
  const [isPending, setIsPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState(false);
  const [confirmUnhide, setConfirmUnhide] = useState(false);
  const [unhideNote, setUnhideNote] = useState("");
  // State updates are async, so a ref is what actually blocks a second
  // click that lands before the disabled attribute re-renders.
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    getListingHideState(listingId).then((result) => {
      if (active) setState(toVisibilityState(result));
    });
    return () => {
      active = false;
    };
  }, [listingId]);

  function handleRetry() {
    setState({ kind: "loading" });
    getListingHideState(listingId).then((result) => setState(toVisibilityState(result)));
  }

  function handleMutationFailure(code: string, message: string) {
    if (code === "LISTING_NOT_FOUND") {
      setConfirmHide(false);
      setConfirmUnhide(false);
      setState({ kind: "missing" });
      return;
    }
    if (code === "UNKNOWN") {
      // The change may have committed. Drop the mutation controls until a
      // fresh read confirms the listing's actual state.
      setConfirmHide(false);
      setConfirmUnhide(false);
      setUnhideNote("");
      setState({ kind: "readError", message, actionLabel: "Recheck" });
      return;
    }
    setMutationError(message);
  }

  async function handleHide(reason: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPending(true);
    setNotice(null);
    setMutationError(null);

    const result = await hideListing(listingId, reason);
    inFlight.current = false;
    setIsPending(false);

    if (!result.ok) {
      handleMutationFailure(result.code, HIDE_LISTING_ERROR_MESSAGES[result.code]);
      return;
    }

    setConfirmHide(false);
    setState({ kind: "hidden", hiddenAt: result.hiddenAt });
    setNotice(result.wasAlreadyHidden ? "Listing was already hidden. No change made." : "Listing hidden.");
  }

  async function handleUnhide() {
    if (inFlight.current) return;
    const trimmed = unhideNote.trim();
    // Same trimmed, code-point count the RPC uses for char_length.
    if (Array.from(trimmed).length > UNHIDE_NOTE_MAX_LENGTH) return;

    inFlight.current = true;
    setIsPending(true);
    setNotice(null);
    setMutationError(null);

    const result = await unhideListing(listingId, trimmed === "" ? null : trimmed);
    inFlight.current = false;
    setIsPending(false);

    if (!result.ok) {
      handleMutationFailure(result.code, UNHIDE_LISTING_ERROR_MESSAGES[result.code]);
      return;
    }

    setConfirmUnhide(false);
    setUnhideNote("");
    setState({ kind: "visible" });
    setNotice(result.wasAlreadyVisible ? "Listing was already visible. No change made." : "Listing unhidden.");
  }

  const unhideNoteTooLong = Array.from(unhideNote.trim()).length > UNHIDE_NOTE_MAX_LENGTH;

  return (
    <div className="rounded-[14px] border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Listing visibility</h2>

      {state.kind === "loading" && <p className="mt-2 text-xs text-ink-muted">Checking visibility…</p>}

      {state.kind === "readError" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-danger">{state.message}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="h-8 shrink-0 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas"
          >
            {state.actionLabel}
          </button>
        </div>
      )}

      {state.kind === "missing" && <p className="mt-2 text-xs text-ink-muted">This listing no longer exists.</p>}

      {state.kind === "visible" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <Badge tone="neutral">Visible</Badge>
          <button
            type="button"
            onClick={() => setConfirmHide(true)}
            disabled={isPending}
            className="h-9 shrink-0 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
          >
            Hide listing
          </button>
        </div>
      )}

      {state.kind === "hidden" && (
        <div className="mt-2 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <Badge tone="brand">Hidden by admin</Badge>
              <p className="mt-1 text-xs text-ink-muted">Hidden {formatOrderDate(state.hiddenAt)}</p>
            </div>
            {!confirmUnhide && (
              <button
                type="button"
                onClick={() => {
                  setMutationError(null);
                  setConfirmUnhide(true);
                }}
                disabled={isPending}
                className="h-9 shrink-0 rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
              >
                Unhide listing
              </button>
            )}
          </div>

          {confirmUnhide && (
            <div className="space-y-2 rounded-[10px] bg-canvas p-3">
              <p className="text-xs text-ink-secondary">Unhide this listing? It becomes publicly visible again. A note is optional.</p>
              <label htmlFor="unhide-listing-note" className="text-xs font-medium text-ink-secondary">
                Note (optional)
              </label>
              <textarea
                id="unhide-listing-note"
                value={unhideNote}
                onChange={(event) => setUnhideNote(event.target.value)}
                disabled={isPending}
                rows={3}
                className="w-full rounded-[10px] border border-border bg-surface p-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              {unhideNoteTooLong && (
                <p className="text-xs text-danger">Please keep the note to {UNHIDE_NOTE_MAX_LENGTH} characters or fewer.</p>
              )}
              {mutationError && <p className="text-xs text-danger">{mutationError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleUnhide()}
                  disabled={isPending || unhideNoteTooLong}
                  className="h-9 flex-1 rounded-[8px] bg-brand-action px-3 text-xs font-semibold text-brand-action-text hover:brightness-95 disabled:opacity-60"
                >
                  {isPending ? "Please wait…" : "Unhide Listing"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmUnhide(false);
                    setUnhideNote("");
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

      {confirmHide && state.kind === "visible" && (
        <ConfirmDialog
          title="Hide this listing?"
          description="The listing will be hidden from public browsing. Your reason is kept in the admin audit log."
          confirmLabel="Hide Listing"
          destructive
          noteLabel="Reason"
          isPending={isPending}
          errorMessage={mutationError}
          onConfirm={(reason) => void handleHide(reason)}
          onClose={() => {
            setConfirmHide(false);
            setMutationError(null);
          }}
        />
      )}
    </div>
  );
}
