"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

type Props = {
  isPending: boolean;
  errorMessage?: string | null;
  onAccept: () => void;
  onClose: () => void;
};

/**
 * Focused consent gate shown reactively when publish_listing returns
 * SELLER_POLICIES_NOT_ACCEPTED (PRD 5.5) -- same accessible-overlay pattern
 * as ConfirmDialog.tsx (role=dialog, aria-modal, focus trap, Escape-to-close,
 * focus return, visible close button), adapted with a required checkbox
 * instead of a required textarea. No new modal framework/dependency.
 *
 * Marketplace Rules and Prohibited Items Policy now link to their real
 * pages (/marketplace-rules, /prohibited-items), opened in a new tab so a
 * seller mid-publish doesn't lose their in-progress form state.
 * accept_seller_policies (0058) is unchanged -- still idempotent, still
 * combines both policies under one acceptance timestamp, so this remains a
 * single checkbox, not two independent toggles.
 */
export function SellerPolicyConsentDialog({ isPending, errorMessage, onAccept, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(false);

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

  const canAccept = checked && !isPending;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={isPending ? undefined : onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="seller-policy-consent-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="seller-policy-consent-title" className="text-base font-semibold text-ink">
              Accept seller policies
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

          <p className="mt-1.5 text-sm text-ink-secondary">Before publishing your first listing, please review and accept both policies below.</p>

          <label className="mt-3 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <span>
              I have read and agree to the{" "}
              <Link
                href="/marketplace-rules"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Marketplace Rules
              </Link>{" "}
              and the{" "}
              <Link
                href="/prohibited-items"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Prohibited Items Policy
              </Link>
              .
            </span>
          </label>

          {errorMessage && <p className="mt-3 text-sm text-danger">{errorMessage}</p>}

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onAccept}
              disabled={!canAccept}
              className="flex h-11 items-center justify-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isPending ? "Please wait…" : "Accept & Publish"}
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
