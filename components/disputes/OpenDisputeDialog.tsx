"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { DisputeImagePicker } from "@/components/disputes/DisputeImagePicker";

type Props = {
  isPending: boolean;
  errorMessage?: string | null;
  onSubmit: (reason: string, explanation: string, imagePaths: string[]) => void;
  onClose: () => void;
  uploaderUserId: string;
  orderId: string;
};

const REASON_MAX_LENGTH = 200;
const EXPLANATION_MAX_LENGTH = 2000;

/**
 * Dispute creation form (PRD 34.2: reason, short explanation, up to 3
 * images). Same accessible-overlay pattern as every other dialog in this
 * codebase (role=dialog, aria-modal, focus trap, Escape-to-close, focus
 * return, visible close button). The no-escrow/no-automated-refund
 * disclaimer (this task's own explicit UX instruction) is shown directly
 * in the form, not hidden behind a separate confirmation step, so it is
 * seen before submission rather than after.
 */
export function OpenDisputeDialog({ isPending, errorMessage, onSubmit, onClose, uploaderUserId, orderId }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState("");
  const [explanation, setExplanation] = useState("");
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const canSubmit = reason.trim().length > 0 && explanation.trim().length > 0 && !isUploadingImages && !isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(reason.trim(), explanation.trim(), imagePaths);
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={isPending ? undefined : onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-dispute-dialog-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="open-dispute-dialog-title" className="text-base font-semibold text-ink">
              Open a dispute
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              disabled={isPending}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <p className="mt-1.5 text-xs text-ink-muted">
            Preshopps records and reviews disputes, but does not hold funds or issue automated refunds in MVP. Buyer and seller
            coordinate payment and fulfillment directly.
          </p>

          <div className="mt-3">
            <label htmlFor="dispute-reason" className="text-xs font-medium text-ink-secondary">
              Reason
            </label>
            <input
              id="dispute-reason"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={REASON_MAX_LENGTH}
              placeholder="e.g. Item never arrived"
              className="mt-1 h-11 w-full rounded-[10px] border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>

          <div className="mt-3">
            <label htmlFor="dispute-explanation" className="text-xs font-medium text-ink-secondary">
              Explanation
            </label>
            <textarea
              id="dispute-explanation"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              maxLength={EXPLANATION_MAX_LENGTH}
              rows={4}
              placeholder="What happened?"
              className="mt-1 w-full rounded-[10px] border border-border bg-canvas p-2.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>

          <div className="mt-3">
            <DisputeImagePicker
              uploaderUserId={uploaderUserId}
              orderId={orderId}
              onPathsChange={setImagePaths}
              onUploadingChange={setIsUploadingImages}
            />
          </div>

          {errorMessage && <p className="mt-3 text-sm text-danger">{errorMessage}</p>}

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex h-11 items-center justify-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isPending ? "Submitting…" : "Submit dispute"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="flex h-11 items-center justify-center rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
