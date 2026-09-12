"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { handleComposerKeyDown } from "@/lib/messaging/composer-keydown";

const MAX_MESSAGE_LENGTH = 4000;

type Props = {
  title: string;
  isPending: boolean;
  errorMessage?: string | null;
  onSend: (body: string) => void;
  onClose: () => void;
};

/**
 * Compact compose dialog used by both "Message Seller" (listing detail)
 * and "Message Shop" (shop page) -- the same accessible-overlay pattern as
 * ConfirmDialog/AuthGate (role=dialog, aria-modal, focus trap,
 * Escape-to-close, focus return, visible close button), tailored for
 * message composition (4000-char limit, plain textarea, Send) rather than
 * a generic confirm+note shape. Kept as its own small component rather
 * than overloading ConfirmDialog with messaging-specific concerns.
 *
 * This dialog always calls public.start_conversation on send (see
 * lib/messaging/start-conversation.ts) -- it is used identically whether
 * this is the very first message to this shop/listing (creates the
 * conversation) or a later one (reuses the existing thread), since that
 * find-or-create logic lives entirely in the RPC itself.
 */
export function ComposeMessageDialog({ title, isPending, errorMessage, onSend, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState("");

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

  const trimmed = body.trim();
  const canSend = !isPending && trimmed.length > 0 && trimmed.length <= MAX_MESSAGE_LENGTH;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={isPending ? undefined : onClose} aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="compose-message-title"
          tabIndex={-1}
          className="w-full max-w-sm rounded-[14px] bg-surface p-5 shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id="compose-message-title" className="text-base font-semibold text-ink">
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
            <label htmlFor="compose-message-body" className="sr-only">
              Message
            </label>
            <textarea
              id="compose-message-body"
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              onKeyDown={(event) =>
                handleComposerKeyDown(event, () => {
                  if (canSend) onSend(trimmed);
                })
              }
              maxLength={MAX_MESSAGE_LENGTH}
              rows={4}
              placeholder="Write a message…"
              className="w-full resize-none rounded-[10px] border border-border bg-canvas p-2.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>

          {errorMessage && <p className="mt-3 text-sm text-danger">{errorMessage}</p>}

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => onSend(trimmed)}
              disabled={!canSend}
              className="flex h-11 items-center justify-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isPending ? "Sending…" : "Send"}
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
