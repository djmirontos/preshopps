"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** When set, renders a required textarea (e.g. a cancellation reason or
   * review note) whose value is passed to onConfirm. */
  noteLabel?: string;
  isPending: boolean;
  errorMessage?: string | null;
  onConfirm: (note: string) => void;
  onClose: () => void;
};

/**
 * Small reusable confirmation dialog for destructive/consequential seller
 * actions -- same accessible-overlay pattern as AuthGate.tsx (role=dialog,
 * aria-modal, focus trap, Escape-to-close, focus return, visible close
 * button). No new modal framework/dependency introduced, per section 8's
 * explicit instruction.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  noteLabel,
  isPending,
  errorMessage,
  onConfirm,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState("");

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

  const noteRequired = Boolean(noteLabel);
  const canConfirm = !isPending && (!noteRequired || note.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={isPending ? undefined : onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="confirm-dialog-title" className="text-base font-semibold text-ink">
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

          <p className="mt-1.5 text-sm text-ink-secondary">{description}</p>

          {noteLabel && (
            <div className="mt-3">
              <label htmlFor="confirm-dialog-note" className="text-xs font-medium text-ink-secondary">
                {noteLabel}
              </label>
              <textarea
                id="confirm-dialog-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
                rows={3}
                className="mt-1 w-full rounded-[10px] border border-border bg-canvas p-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
          )}

          {errorMessage && <p className="mt-3 text-sm text-danger">{errorMessage}</p>}

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => onConfirm(note.trim())}
              disabled={!canConfirm}
              className={
                destructive
                  ? "flex h-11 items-center justify-center rounded-[10px] bg-danger px-4 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
                  : "flex h-11 items-center justify-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
              }
            >
              {isPending ? "Please wait…" : confirmLabel}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="flex h-11 items-center justify-center rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
