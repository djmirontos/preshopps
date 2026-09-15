"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  /** Disabled while a sensitive request is in flight -- mirrors
   * ConfirmDialog's own isPending-disables-close convention, so a user
   * can't dismiss the dialog mid-request and lose track of whether a
   * password/email change actually went through. */
  isClosable?: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * Generic accessible modal shell for the three Security actions --
 * same overlay/focus-trap/Escape/focus-return pattern as
 * components/seller/ConfirmDialog.tsx (role=dialog, aria-modal, focus
 * trap, previously-focused element restored on unmount), but with a
 * free-form body instead of ConfirmDialog's fixed title/description/
 * single-textarea/confirm-cancel shape -- Change Email and Change
 * Password both need multiple fields and, for password, a multi-step
 * flow, which ConfirmDialog's shape can't express. "Sign out other
 * devices" still reuses ConfirmDialog itself unchanged, since its
 * plain title/description/confirm/cancel shape already fits.
 */
export function SecurityDialog({ title, isClosable = true, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isClosable) onClose();
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
  }, [onClose, isClosable]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={isClosable ? onClose : undefined} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="security-dialog-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="security-dialog-title" className="text-base font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              disabled={!isClosable}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
