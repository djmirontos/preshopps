"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/moderation/report-actions";

type Props = {
  title: string;
  isPending: boolean;
  errorMessage?: string | null;
  onSubmit: (reason: ReportReason, description: string | null) => void;
  onClose: () => void;
};

const REASONS = Object.keys(REPORT_REASON_LABELS) as ReportReason[];

/**
 * Same accessible-overlay pattern as every other dialog in this codebase
 * (ConfirmDialog/AuthGate/SellerPolicyConsentDialog): role=dialog,
 * aria-modal, focus trap, Escape-to-close, focus return, visible close
 * button. Reason + optional description only -- exactly PRD 31's own
 * report shape, nothing else collected.
 */
export function ReportDialog({ title, isPending, errorMessage, onSubmit, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [description, setDescription] = useState("");

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

  const canSubmit = reason !== "" && !isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(reason, description.trim().length > 0 ? description.trim() : null);
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={isPending ? undefined : onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-dialog-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="report-dialog-title" className="text-base font-semibold text-ink">
              {title}
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

          <div className="mt-3">
            <label htmlFor="report-reason" className="text-xs font-medium text-ink-secondary">
              Reason
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as ReportReason)}
              className="mt-1 h-11 w-full rounded-[10px] border border-border bg-canvas px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <option value="">Choose a reason</option>
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {REPORT_REASON_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label htmlFor="report-description" className="text-xs font-medium text-ink-secondary">
              Details <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="report-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-1 w-full rounded-[10px] border border-border bg-canvas p-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
              {isPending ? "Submitting…" : "Submit report"}
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
