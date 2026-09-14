"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  body: string;
  primaryLabel: string;
  pendingPrimaryLabel: string;
  secondaryLabel: string;
  isPending: boolean;
  errorMessage?: string | null;
  onPrimaryConfirm: () => void;
  /** Fired by the secondary button -- either "Open Messages" (navigates
   * away, never touches order status) or "Not Yet" (simply closes). Which
   * one is passed in is entirely the caller's decision; this component
   * has no opinion on what the secondary action actually does. */
  onSecondaryAction: () => void;
  onClose: () => void;
};

/**
 * Seller fulfillment-transition confirmation/instruction modal (P1 task):
 * shown before mark_order_ready or mark_order_handed_over_or_shipped is
 * ever called, so a seller cannot advance a fulfillment stage by reflexively
 * tapping the outer action button without reading what that status actually
 * represents in the real world. Deliberately a new, small component rather
 * than an extra ConfirmDialog mode: ConfirmDialog's API (confirmLabel +
 * cancelLabel, an optional required-note textarea, one destructive/one
 * neutral visual style) has no notion of a secondary action that performs a
 * real navigation (Open Messages) as opposed to a plain dismiss (Not Yet or
 * the close affordances) -- bending it to cover both would make its API
 * more confusing for its own five existing call sites, which is exactly the
 * "if it would become awkward" case this task's own instructions call out.
 *
 * Same accessible-overlay pattern as ConfirmDialog.tsx (role=dialog,
 * aria-modal, focus trap, Escape-to-close, visible close button, backdrop
 * click closes) -- copied rather than imported/shared because the two
 * components' bodies diverge enough (no note field here; a fixed
 * instructional body string instead) that sharing a base would need its own
 * new abstraction for a two-caller need, which is not smaller than just
 * repeating this modest amount of interaction boilerplate. Every close path
 * (X, Escape, backdrop, and the secondary button in its "Not Yet" role)
 * calls onClose/onSecondaryAction only -- none of them ever calls
 * onPrimaryConfirm, so a seller can never advance the status by dismissing
 * the modal.
 */
export function SellerFulfillmentTransitionModal({
  title,
  body,
  primaryLabel,
  pendingPrimaryLabel,
  secondaryLabel,
  isPending,
  errorMessage,
  onPrimaryConfirm,
  onSecondaryAction,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={isPending ? undefined : onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="seller-fulfillment-transition-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="seller-fulfillment-transition-title" className="text-base font-semibold text-ink">
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

          <p className="mt-1.5 text-sm text-ink-secondary">{body}</p>

          {errorMessage && <p className="mt-3 text-sm text-danger">{errorMessage}</p>}

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onPrimaryConfirm}
              disabled={isPending}
              className="flex h-11 items-center justify-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isPending ? pendingPrimaryLabel : primaryLabel}
            </button>
            <button
              type="button"
              onClick={onSecondaryAction}
              disabled={isPending}
              className="flex h-11 items-center justify-center rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              {secondaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
