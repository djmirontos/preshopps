"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";
import { ConversationThread } from "@/components/messaging/ConversationThread";
import { loadConversationForPanel, loadEarlierMessagesForPanel } from "@/lib/messaging/load-conversation-for-panel";
import { Tooltip } from "@/components/ui/Tooltip";
import type { LoadConversationForPanelResult } from "@/lib/messaging/load-conversation-for-panel";

type PanelState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "ready"; data: Extract<LoadConversationForPanelResult, { status: "found" }> };

/**
 * Desktop-only (`lg` and up) floating Messenger-style chat panel, mounted
 * once at the root layout alongside FloatingMessengerProvider. Renders
 * nothing (`return null`) whenever no conversation is open -- the common
 * case on every page for every user who hasn't clicked a conversation.
 *
 * Data loading: each time the Provider's openConversationId changes, this
 * fetches conversation context/messages/block-state via the
 * loadConversationForPanel Server Action (lib/messaging/
 * load-conversation-for-panel.ts) -- the same authoritative, RLS-scoped
 * reads the full-page route already uses, just callable without a
 * navigation. Both the minimized pill and the expanded chrome share this
 * one fetch/state machine; toggling minimize/restore never refetches
 * (loadedForRef guards on conversationId only).
 *
 * Crucially, ConversationThread itself is mounted continuously for as
 * long as a conversation is open -- minimizing only hides its container
 * with CSS (`hidden`), it never unmounts the thread. That keeps its
 * Realtime subscription alive while minimized, which is what lets a
 * minimized chat still receive live messages (so it's current when
 * restored) and light the unread pill via onIncomingMessage, while
 * ConversationThread's own isMinimized prop separately suppresses the
 * mark-read side effects for exactly as long as it's minimized.
 */
export function FloatingChatPanel() {
  const { openConversationId, isMinimized, minimize, restore, close } = useFloatingMessenger();
  const [state, setState] = useState<PanelState | null>(null);
  const [hasUnreadWhileMinimized, setHasUnreadWhileMinimized] = useState(false);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!openConversationId) {
      // No setState here -- render already returns null the moment
      // openConversationId is falsy (below), regardless of whatever
      // `state` still holds, and the next open reliably overwrites it
      // via the branch below. Only the ref (safe to mutate in an effect)
      // needs resetting, so the next open's guard doesn't short-circuit.
      loadedForRef.current = null;
      return;
    }
    if (loadedForRef.current === openConversationId) return;
    loadedForRef.current = openConversationId;
    setState({ status: "loading" });
    setHasUnreadWhileMinimized(false);

    let cancelled = false;
    void loadConversationForPanel(openConversationId).then((result) => {
      if (cancelled) return;
      setState(result.status === "found" ? { status: "ready", data: result } : { status: result.status });
    });

    return () => {
      cancelled = true;
    };
  }, [openConversationId]);

  /** Restoring always clears the pill's unread indicator -- called
   * directly from the pill's own click handler (never a separate effect
   * reacting to isMinimized) so this stays a plain event response rather
   * than a setState-in-effect cascade. ConversationThread's own effects
   * separately handle the actual read-state reconciliation with the
   * server. */
  function handleRestore() {
    setHasUnreadWhileMinimized(false);
    restore();
  }

  if (!openConversationId || !state) return null;

  const panelName =
    state.status === "ready"
      ? (state.data.context.viewerRole === "seller" ? state.data.context.otherPartyDisplayName : state.data.context.shopName) ?? "Conversation"
      : "Conversation";

  return (
    // bottom-6/right-6 (24px each) -- both the minimized pill and the
    // expanded chrome below are children of this one positioned wrapper,
    // so they always share the exact same offset; nothing to keep in
    // sync separately when toggling minimize/restore.
    <div className="fixed bottom-6 right-6 z-40 hidden w-[360px] max-w-[calc(100vw-3rem)] lg:block">
      {/* Minimized pill -- the only visible element while isMinimized. */}
      <button
        type="button"
        onClick={handleRestore}
        aria-label={hasUnreadWhileMinimized ? `${panelName}, new message. Restore chat` : `Restore chat with ${panelName}`}
        className={cn(
          // Fully rounded + a full border on every side, not just the
          // top -- now that the panel floats clear of the bottom edge
          // (bottom-6 above) rather than sitting flush against it, a
          // missing bottom border/radius would look like a cut-off box.
          "flex h-12 w-full items-center gap-2 rounded-[14px] border border-border bg-surface px-4 shadow-lg hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          !isMinimized && "hidden",
        )}
      >
        {hasUnreadWhileMinimized && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-action" aria-hidden="true" />}
        <span className="truncate text-sm font-semibold text-ink">{panelName}</span>
      </button>

      {/* Expanded panel chrome -- hidden (not unmounted) while minimized;
          see this component's own file-level comment for why
          ConversationThread itself must keep running underneath either
          way. */}
      <div
        className={cn(
          // Same "fully rounded + full border" reasoning as the pill above.
          "flex max-h-[75vh] flex-col overflow-hidden rounded-[14px] border border-border bg-surface shadow-xl",
          isMinimized && "hidden",
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-divider px-3">
          <span className="min-w-0 truncate text-sm font-semibold text-ink">{panelName}</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip label="Minimize">
              <button
                type="button"
                onClick={minimize}
                aria-label="Minimize chat"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="Close">
              <button
                type="button"
                onClick={close}
                aria-label="Close chat"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* No overflow-y-auto here -- ConversationThread now owns its own
            internal scroll region (see its own file comment), so this is
            just the flex-column chain that gives it a real bounded
            height to fill (h-full) inside this chrome's own
            max-h-[75vh]. A second independently-scrolling ancestor here
            would fight with ConversationThread's own scroll handling. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {state.status === "loading" && <p className="p-4 text-sm text-ink-secondary">Loading conversation…</p>}

          {state.status === "error" && (
            <div className="p-4 text-center">
              <p className="text-sm text-ink-secondary">Unable to load this conversation right now.</p>
              <button type="button" onClick={close} className="mt-3 text-sm font-semibold text-brand-link">
                Close
              </button>
            </div>
          )}

          {state.status === "not_found" && (
            <div className="p-4 text-center">
              <p className="text-sm text-ink-secondary">This conversation is no longer available.</p>
              <button type="button" onClick={close} className="mt-3 text-sm font-semibold text-brand-link">
                Close
              </button>
            </div>
          )}

          {state.status === "ready" && (
            <div className="flex min-h-0 flex-1 flex-col px-3">
              <ConversationThread
                key={state.data.context.conversationId}
                context={state.data.context}
                initialMessages={state.data.initialMessages}
                initialCursor={state.data.initialCursor}
                loadEarlier={loadEarlierMessagesForPanel}
                otherPartyId={state.data.otherPartyId}
                initialIsBlocked={state.data.initialIsBlocked}
                hideBackLink
                hideIdentityHeader
                isMinimized={isMinimized}
                onIncomingMessage={() => {
                  if (isMinimized) setHasUnreadWhileMinimized(true);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
