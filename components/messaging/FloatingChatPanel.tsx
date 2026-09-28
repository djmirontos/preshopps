"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Minus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";
import { useUnreadMessageCount } from "@/components/notifications/NotificationsProvider";
import { ConversationThread } from "@/components/messaging/ConversationThread";
import { ConversationsListClient } from "@/components/messaging/ConversationsListClient";
import { loadConversationForPanel, loadEarlierMessagesForPanel } from "@/lib/messaging/load-conversation-for-panel";
import { loadConversationsForMessagingCenter, loadMoreConversationsForMessagingCenter } from "@/lib/messaging/load-conversations-for-messaging-center";
import { Tooltip } from "@/components/ui/Tooltip";
import type { LoadConversationForPanelResult } from "@/lib/messaging/load-conversation-for-panel";
import type { GetMyConversationsResult } from "@/lib/messaging/get-my-conversations";

type ThreadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "ready"; data: Extract<LoadConversationForPanelResult, { status: "found" }> };

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; data: GetMyConversationsResult; generation: number };

type Props = {
  /** Gates the entire persistent launcher/messaging center -- messaging
   * is sign-in-only, and unlike the previous single-conversation panel
   * (which never rendered anything for a guest simply because nothing
   * guest-reachable could ever set an open conversation), the launcher
   * below is now unconditionally visible while browsing, so it needs its
   * own explicit guard the same way NotificationsProvider already
   * receives isAuthenticated/userId from the root layout. */
  isAuthenticated: boolean;
};

/**
 * Desktop-only (`lg` and up) persistent messaging center, mounted once at
 * the root layout alongside FloatingMessengerProvider. A marketplace-
 * style (Shopee-like in concept, not in styling) two-column upgrade of
 * the previous single-conversation floating panel:
 *
 * - Collapsed: a compact "Messages" launcher pill stays at the bottom-
 *   right at all times while signed in and browsing, showing the same
 *   authoritative unread-conversation count the header/mobile nav badges
 *   already use (useUnreadMessageCount()) -- always accurate with no
 *   extra local tracking, since that count already updates continuously
 *   via NotificationsProvider's own Realtime subscription regardless of
 *   whether this panel is open, collapsed, or which conversation (if
 *   any) is selected.
 * - Expanded: a left conversation list (reusing ConversationsListClient,
 *   the exact same component/query the full `/messages` page uses, fed
 *   by its own small Server Action below rather than a second inbox
 *   implementation) and a right pane rendering ConversationThread for
 *   whichever conversation is selected -- reusing the exact same
 *   send/Realtime/mark-read logic the full-page route and the previous
 *   panel both already used, so there is still exactly one messaging
 *   implementation in this app.
 *
 * Both the list and the selected thread stay mounted continuously once
 * loaded -- minimizing only hides the expanded chrome with CSS (`hidden`),
 * it never unmounts either. That keeps the selected thread's Realtime
 * subscription alive while collapsed (so it's current when reopened, and
 * so it correctly never auto-marks a message read while collapsed --
 * ConversationThread's own isMinimized prop, driven by !isOpen here,
 * already handles that unchanged), and keeps the conversation list
 * reacting to the same shared new_message notification signal it always
 * has, regardless of whether the center is currently visible.
 */
export function FloatingChatPanel({ isAuthenticated }: Props) {
  const { isOpen, selectedConversationId, openMessenger, minimize, close, closeConversation } = useFloatingMessenger();
  const unreadMessageCount = useUnreadMessageCount();

  const [threadState, setThreadState] = useState<ThreadState | null>(null);
  const loadedThreadForRef = useRef<string | null>(null);

  const [listState, setListState] = useState<ListState | null>(null);
  const listLoadedRef = useRef(false);
  /** Monotonically increasing per-fetch generation -- every call to
   * fetchConversationList (the initial open below, or the return-to-list
   * refresh further down) captures its own number before awaiting, and
   * only applies its result if it is still the LATEST request by the
   * time it resolves. Without this, an older, slower fetch (e.g. the
   * initial open's own request, still in flight) could resolve AFTER a
   * newer refresh and silently overwrite it with stale data. */
  const listFetchGenerationRef = useRef(0);

  function fetchConversationList() {
    const generation = ++listFetchGenerationRef.current;
    setListState({ status: "loading" });
    loadConversationsForMessagingCenter()
      .then((result) => {
        if (listFetchGenerationRef.current !== generation) return;
        // The generation also becomes ConversationsListClient's own React
        // `key` below -- required, not cosmetic. That component only ever
        // reads its initialConversations prop once, as its own useState
        // seed; a later prop change alone is silently ignored by design
        // (see its own file), so without a changing key here, a SECOND
        // successful fetch's genuinely new data would never actually
        // reach the screen even though this state update itself is
        // correct. A fresh generation forces a fresh mount, which is safe
        // here specifically because a data refresh (not a minimize/
        // reopen-visibility change) is the only thing that ever changes
        // it -- see this file's own top comment on why staying mounted
        // across minimize/reopen is unaffected by this.
        setListState({ status: "ready", data: result, generation });
      })
      .catch((err) => {
        if (listFetchGenerationRef.current !== generation) return;
        console.error("Failed to load messaging center conversation list:", err instanceof Error ? err.message : err);
        setListState({ status: "error" });
      });
  }

  // Right pane: (re)load whenever the selected conversation changes.
  useEffect(() => {
    if (!selectedConversationId) {
      loadedThreadForRef.current = null;
      return;
    }
    if (loadedThreadForRef.current === selectedConversationId) return;
    loadedThreadForRef.current = selectedConversationId;
    setThreadState({ status: "loading" });

    let cancelled = false;
    void loadConversationForPanel(selectedConversationId).then((result) => {
      if (cancelled) return;
      setThreadState(result.status === "found" ? { status: "ready", data: result } : { status: result.status });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId]);

  // Left pane: (re)loads the conversation list every time the center is
  // opened, not just the very first time -- listLoadedRef resets the
  // moment the center closes (mirroring ConversationThread's own
  // markedForVisibleSessionRef pattern for its analogous mark-read-on-
  // open/restore effect), so it still fetches at most once per open
  // session, never on every render.
  //
  // A single "fetch once, ever" attempt (the previous version of this
  // effect) can go silently stale: a genuinely successful, empty result
  // fetched on an early open is trusted forever afterward, even once
  // real conversations exist -- there is no other path that ever
  // refetches it. ConversationsListClient's own live refresh only fires
  // on a new_message notification (a genuinely new incoming message);
  // Mark as Unread is a plain client-side conversation_user_states
  // update, not send_message, so it creates no notification and can
  // never trigger that refresh on its own. Confirmed this is the same
  // underlying query as the full /messages page (getMyConversations with
  // an identical limit and showArchived=false) -- so any discrepancy
  // between the two surfaces is a timing/staleness issue, not a
  // filtering difference: reopening now re-fetches fresh, matching how
  // the full page already re-fetches on every visit.
  useEffect(() => {
    if (!isOpen) {
      listLoadedRef.current = false;
      return;
    }
    if (listLoadedRef.current) return;
    listLoadedRef.current = true;
    fetchConversationList();
  }, [isOpen]);

  // Left pane: also refresh when RETURNING to the list from a selected
  // conversation while the panel stays open the whole time -- e.g. Mark
  // as Unread's own closeConversation(), which clears
  // selectedConversationId without ever touching isOpen. The effect
  // above (keyed on isOpen) cannot catch this: isOpen never changes here,
  // so it never re-runs. Fires only on the specific "had a selection, now
  // has none" transition -- never on the initial mount (previous and
  // current start equal, see the ref's own initial value), never when
  // opening straight into a conversation (null -> an id is the opposite
  // direction), and never merely from swapping to a different selected
  // conversation (id -> a different id is still non-null). This is
  // deliberately independent of listLoadedRef -- it always refreshes on
  // this exact transition regardless of whether the initial load has
  // already happened.
  const previousSelectedIdRef = useRef<string | null>(selectedConversationId);
  useEffect(() => {
    const previousSelectedId = previousSelectedIdRef.current;
    previousSelectedIdRef.current = selectedConversationId;
    if (!isOpen) return;
    if (previousSelectedId && !selectedConversationId) {
      fetchConversationList();
    }
  }, [selectedConversationId, isOpen]);

  if (!isAuthenticated) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 hidden lg:block">
      {/* Collapsed launcher -- always present for a signed-in viewer;
          only ever hidden via CSS while the center is open, never
          unmounted, so there is always a way back into messaging. */}
      <button
        type="button"
        onClick={openMessenger}
        aria-label={unreadMessageCount > 0 ? `Messages, ${unreadMessageCount} unread` : "Messages"}
        className={cn(
          "flex h-14 items-center gap-2 rounded-full border border-border bg-surface px-5 shadow-lg hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          isOpen && "hidden",
        )}
      >
        <MessageCircle className="h-5 w-5 text-ink-secondary" aria-hidden="true" />
        <span className="text-sm font-semibold text-ink">Messages</span>
        {unreadMessageCount > 0 && (
          <span
            aria-hidden="true"
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-action px-1.5 text-xs font-semibold leading-none text-brand-action-text"
          >
            {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
          </span>
        )}
      </button>

      {/* Expanded messaging center -- hidden (not unmounted) while
          collapsed; see this file's own top comment for why the
          conversation list and the selected thread both keep running
          underneath either way. Width: ~800px on large screens (within
          the approved 720-850px target), capped against the viewport so
          it never overflows a narrower desktop window. Height: 75% of
          the viewport, capped at 600px so it doesn't become excessive on
          very tall monitors. */}
      <div
        className={cn(
          "flex h-[75vh] max-h-[600px] w-[800px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[14px] border border-border bg-surface shadow-xl",
          !isOpen && "hidden",
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-divider px-4">
          <span className="text-sm font-semibold text-ink">Messages</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip label="Minimize">
              <button
                type="button"
                onClick={minimize}
                aria-label="Minimize messaging center"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="Close">
              <button
                type="button"
                onClick={close}
                aria-label="Close messaging center"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left column: conversation list, ~280px (within the approved
              260-320px target). Reuses ConversationsListClient as-is --
              its own row click already calls openConversation() on
              desktop, its own new_message-driven refresh already keeps
              it live, and its own empty/in-band-hadError states already
              cover both cases once a result has actually loaded. This
              panel's own "error" status above is a different failure
              mode -- the initial fetch itself rejecting -- which
              ConversationsListClient never sees at all since it isn't
              mounted yet at that point. */}
          <div className="flex w-[280px] shrink-0 flex-col border-r border-divider">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {listState === null || listState.status === "loading" ? (
                <p className="p-2 text-sm text-ink-secondary">Loading conversations…</p>
              ) : listState.status === "error" ? (
                <p className="p-2 text-sm text-ink-secondary">Unable to load your messages right now.</p>
              ) : (
                <ConversationsListClient
                  key={listState.generation}
                  initialConversations={listState.data.conversations}
                  initialHadError={listState.data.hadError}
                  initialCursor={listState.data.nextCursor}
                  loadMore={loadMoreConversationsForMessagingCenter}
                  refreshFirstPage={loadConversationsForMessagingCenter}
                  showingArchived={false}
                />
              )}
            </div>
          </div>

          {/* Right column: the selected thread, or an empty state when
              nothing has been selected yet -- never auto-selecting a
              conversation on its own. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {!selectedConversationId && (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="text-sm text-ink-secondary">Select a conversation</p>
              </div>
            )}

            {selectedConversationId && threadState?.status === "loading" && (
              <p className="p-4 text-sm text-ink-secondary">Loading conversation…</p>
            )}

            {selectedConversationId && threadState?.status === "error" && (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="text-sm text-ink-secondary">Unable to load this conversation right now.</p>
              </div>
            )}

            {selectedConversationId && threadState?.status === "not_found" && (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="text-sm text-ink-secondary">This conversation is no longer available.</p>
              </div>
            )}

            {selectedConversationId && threadState?.status === "ready" && (
              <div className="flex min-h-0 flex-1 flex-col px-3">
                <ConversationThread
                  key={threadState.data.context.conversationId}
                  context={threadState.data.context}
                  initialMessages={threadState.data.initialMessages}
                  initialCursor={threadState.data.initialCursor}
                  loadEarlier={loadEarlierMessagesForPanel}
                  otherPartyId={threadState.data.otherPartyId}
                  initialIsBlocked={threadState.data.initialIsBlocked}
                  hideBackLink
                  isMinimized={!isOpen}
                  onMarkedUnreadSuccess={closeConversation}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
