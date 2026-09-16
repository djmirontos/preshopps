"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Archive, ArchiveRestore, MailOpen, Package, UserCheck, UserX, Volume2, VolumeX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import { containsExternalLink } from "@/lib/messaging/detect-link";
import { sendMessage, SEND_MESSAGE_ERROR_MESSAGES } from "@/lib/messaging/send-message";
import { appendMessageIfNew, insertMessageInOrder } from "@/lib/messaging/message-list";
import { getLatestConversationMessages } from "@/lib/messaging/get-latest-conversation-messages";
import { handleComposerKeyDown } from "@/lib/messaging/composer-keydown";
import {
  markConversationRead,
  markConversationReadIfUnread,
  markConversationUnread,
  setConversationArchived,
  setConversationMuted,
} from "@/lib/messaging/conversation-state";
import { blockUser, unblockUser, BLOCK_USER_ERROR_MESSAGES, UNBLOCK_USER_ERROR_MESSAGES } from "@/lib/messaging/block-actions";
import { useRefreshUnreadMessageCount } from "@/components/notifications/NotificationsProvider";
import { ReportButton } from "@/components/moderation/ReportButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { ConversationMessage, MessagesCursor } from "@/lib/messaging/get-conversation-messages";

/** Raw public.messages row shape, exactly as Realtime's postgres_changes
 * INSERT payload.new delivers it -- no is_mine (that's an RPC-computed
 * field derived from auth.uid(), never present on the raw table row). */
type RawMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

const MAX_MESSAGE_LENGTH = 4000;

/** @supabase/realtime-js's own RealtimeClient.channel(topic) deliberately
 * REUSES an existing channel object whenever one with the same topic
 * string is still present in its internal registry, and
 * RealtimeClient.removeChannel() is async -- so a base topic keyed only
 * on conversationId (e.g. `messages:${conversationId}`) can, under a
 * fast enough remount/re-run (React Strict Mode's dev-only double-invoke
 * of every effect on mount being the common real-world trigger), collide
 * with the previous effect invocation's channel before its own async
 * teardown has actually removed it from that registry -- and calling
 * `.on('postgres_changes', ...)` on that reused, already-joining/joined
 * object throws "cannot add `postgres_changes` callbacks for
 * realtime:<topic> after `subscribe()`." This counter makes every single
 * invocation's topic globally unique (module-level, not a per-instance
 * ref, so this holds even across two ConversationThread instances that
 * happen to share a conversation id at once), which removes the
 * collision by construction rather than trying to win the race against
 * removeChannel's own network round trip. The topic string carries no
 * server-side meaning of its own -- the DB-level filter
 * (conversation_id=eq.${conversationId}) is what actually scopes which
 * rows a channel receives -- so appending a sequence number here changes
 * nothing about what any channel is allowed to see. */
let nextRealtimeChannelSequence = 0;
function nextRealtimeChannelTopic(baseTopic: string): string {
  nextRealtimeChannelSequence += 1;
  return `${baseTopic}:${nextRealtimeChannelSequence}`;
}

/** How close to the bottom (in px of remaining scroll distance) still
 * counts as "already reading the latest messages" -- close enough that
 * an incoming message should pull the view down with it, rather than the
 * viewer having to notice and scroll manually. Comfortably more than one
 * message bubble's height, so ordinary sub-pixel/rounding scroll noise
 * near the bottom never gets misread as "scrolled away". */
const NEAR_BOTTOM_THRESHOLD_PX = 120;

type LoadEarlierResult = {
  messages: ConversationMessage[];
  hadError: boolean;
  nextCursor: MessagesCursor | null;
};

type Props = {
  context: ConversationContext;
  initialMessages: ConversationMessage[];
  initialCursor: MessagesCursor | null;
  loadEarlier: (conversationId: string, cursor: MessagesCursor) => Promise<LoadEarlierResult>;
  /** The other participant's own profile id, resolved server-side by
   * get_conversation_block_state (0072) -- never guessed/typed client-side. */
  otherPartyId: string;
  initialIsBlocked: boolean;
  /** Hides the "← Back to Messages" link -- there is no dedicated
   * messages route to return to from inside the floating desktop panel
   * (FloatingChatPanel), which is this prop's only current caller.
   * Defaults to false, matching the full-page route's original markup
   * exactly. */
  hideBackLink?: boolean;
  /** Hides the avatar+name identity block -- the floating panel shows
   * its own compact name in its own chrome header instead, so repeating
   * it here would be a duplicate. The per-conversation icon controls
   * (mute/archive/mark-unread/block/report) still render either way.
   * Defaults to false. */
  hideIdentityHeader?: boolean;
  /** True while the floating panel housing this thread is minimized.
   * This thread keeps running (its Realtime subscription stays live and
   * incoming messages still append to the list) regardless -- only the
   * mark-read side effects are suppressed while true, per this slice's
   * "minimized panel must not auto-mark incoming messages read"
   * requirement. Has no effect on the full-page route, which never
   * passes this prop (defaults to false, i.e. today's exact behavior). */
  isMinimized?: boolean;
  /** Fired for every new, live-appended message that is NOT the viewer's
   * own -- i.e. every message that would otherwise trigger a mark-read.
   * The floating panel uses this to light its minimized-state unread
   * indicator; the full-page route has no use for it and never passes
   * it. */
  onIncomingMessage?: () => void;
  /** Rendered first inside the header's icon-button row, before the
   * existing mute/archive/mark-unread/block/report controls -- the
   * floating panel injects its own Minimize/Close buttons here so there
   * is exactly one header row, never two. */
  headerActions?: ReactNode;
};

/**
 * The actual conversation UI -- header identity + listing context,
 * message history with a "Load earlier" cursor page, the composer, and
 * the per-conversation state controls (archive, mute, mark unread,
 * block/unblock, report). Extracted out of (and still the sole
 * implementation behind) ConversationDetailClient, the full-page
 * `/messages/[conversationId]` route's own component, so the floating
 * desktop panel (FloatingChatPanel) reuses this exact same send/Realtime/
 * mark-read logic instead of a second copy -- there is exactly one
 * messaging implementation in this app, powering both surfaces.
 *
 * Sending goes through the existing send_message RPC only; a confirmed
 * response is appended (no optimistic temp-message reconciliation, kept
 * simple per instruction). No image/file attachments, no rich text, no
 * edit/delete -- messages are immutable, matching PRD 25.4.
 */
export function ConversationThread({
  context,
  initialMessages,
  initialCursor,
  loadEarlier,
  otherPartyId,
  initialIsBlocked,
  hideBackLink = false,
  hideIdentityHeader = false,
  isMinimized = false,
  onIncomingMessage,
  headerActions,
}: Props) {
  const [isArchived, setIsArchived] = useState(context.isArchived);
  const [isMuted, setIsMuted] = useState(context.isMuted);
  const [markedUnreadFeedback, setMarkedUnreadFeedback] = useState(false);

  const [isBlocked, setIsBlocked] = useState(initialIsBlocked);
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false);
  const [isBlockPending, setIsBlockPending] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [messages, setMessages] = useState(initialMessages);
  // Every message id currently known to this thread (initial page, "Load
  // earlier" pages, the viewer's own sent messages, and every Realtime
  // INSERT already accepted) -- kept synchronized with `messages` by
  // adding to it at each of those exact same call sites, synchronously,
  // the moment an id is known there. This is what the Realtime handler
  // below now consults (and updates) to decide whether an incoming id is
  // genuinely new, BEFORE ever calling setMessages -- see that handler's
  // own comment for why deciding this from inside the setMessages updater
  // itself (the previous `let wasNew = false; setMessages(prev => {...
  // wasNew = ...}); if (wasNew)` pattern) was not safe. appendMessageIfNew/
  // messageId remains the sole, authoritative render-level dedupe --
  // this ref only ever decides which side effects to schedule, never
  // whether a message renders.
  const seenMessageIdsRef = useRef<Set<string>>(new Set(initialMessages.map((message) => message.messageId)));
  const [earlierCursor, setEarlierCursor] = useState(initialCursor);
  const [loadEarlierFailed, setLoadEarlierFailed] = useState(false);
  const [isLoadingEarlier, startLoadEarlier] = useTransition();

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const refreshUnreadMessageCount = useRefreshUnreadMessageCount();

  // Scroll behavior -- see the three effects and the realtime handler
  // below for how these are used together. messagesContainerRef is the
  // one scrollable region for the whole thread (see its own element
  // below); isNearBottomRef tracks the viewer's own scroll position
  // without triggering a re-render (updated on every scroll event, and
  // reset to a known value on mount/restore); pendingScrollRef is a
  // one-shot flag set by "an action that should snap to the latest
  // message" (sending, or an incoming message that arrived while already
  // near the bottom) and consumed by the effect that reacts to `messages`
  // changing -- a "Load earlier" prepend never sets this flag, so it
  // never causes an unexpected jump to the bottom.
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const pendingScrollRef = useRef(false);

  function scrollMessagesToBottom() {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
  }

  // A. Initial open: snap to the latest message once this thread mounts
  // for a given conversation. Runs after the initial messages have
  // already committed to the DOM (useLayoutEffect, not useEffect, so
  // there's no visible flash of the top of the list before the snap),
  // so scrollHeight already reflects the real content height.
  // FloatingChatPanel force-remounts a fresh ConversationThread instance
  // (via key={conversationId}) whenever the open conversation changes, so
  // this also covers "switching to a different conversation" the same
  // way a full-page navigation does.
  useLayoutEffect(() => {
    isNearBottomRef.current = true;
    scrollMessagesToBottom();
  }, [context.conversationId]);

  // B & C. Follow to the latest message after sending, or after an
  // incoming Realtime message that arrived while the viewer was already
  // near the bottom (both set pendingScrollRef -- see handleSend and the
  // Realtime handler below). Deliberately keyed on `messages` rather than
  // a dedicated "scroll request" counter, so this needs no extra state;
  // gated by the flag so a "Load earlier" prepend (which never sets it)
  // is a no-op here, never an unexpected jump to the bottom.
  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    scrollMessagesToBottom();
  }, [messages]);

  // D. Restoring from minimized: while the floating panel's chrome is
  // hidden (display:none), the browser does not apply scrollTop changes
  // to it, so a message that arrived while minimized (see the Realtime
  // handler below) may not have actually moved the real scroll position
  // even though isNearBottomRef was already true. Re-snap once visible
  // again, but only when the viewer was near the bottom to begin with --
  // if they had deliberately scrolled up to read older messages before
  // minimizing, isNearBottomRef stayed false the whole time and this is a
  // no-op, so there is no jarring re-scroll and no loop (this effect
  // never itself changes isMinimized, so it cannot retrigger itself). On
  // the full-page route isMinimized is always false, so this only ever
  // runs once, on mount, redundantly with effect A above.
  useLayoutEffect(() => {
    if (isMinimized) return;
    if (isNearBottomRef.current) scrollMessagesToBottom();
  }, [isMinimized]);

  // Mark-read-on-open/restore: fires whenever this thread becomes visible
  // (isMinimized is false), at most once per "visible session" -- the ref
  // resets the moment isMinimized flips true, so restoring from minimized
  // re-marks (and re-reconciles the authoritative count) exactly like a
  // fresh open would, satisfying "restored panel reconciles read state"
  // without doing it redundantly while nothing has changed. On the
  // full-page route isMinimized is always false, so this behaves exactly
  // like the original mount-only effect (marks once per conversationId).
  // markConversationReadIfUnread itself performs zero writes when the
  // conversation is already read, so this is never a "repeated
  // unnecessary write" even on React Strict Mode's dev-only double-invoke.
  // The Messages badge is always recalculated afterward (authoritative,
  // from the server) rather than guessed locally -- opening this one
  // conversation says nothing by itself about how many *other*
  // conversations are still unread.
  const markedForVisibleSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (isMinimized) {
      markedForVisibleSessionRef.current = null;
      return;
    }
    if (markedForVisibleSessionRef.current === context.conversationId) return;
    markedForVisibleSessionRef.current = context.conversationId;
    void markConversationReadIfUnread(context.conversationId).then(() => refreshUnreadMessageCount());
  }, [context.conversationId, isMinimized, refreshUnreadMessageCount]);

  // Realtime: one channel per open conversation, filtered server-side to
  // this conversation_id only (RLS re-validates participation regardless).
  // Mounts when this thread mounts/changes, cleanly unsubscribes on
  // unmount or conversationId change -- never a second channel left
  // dangling for a previous conversation. Deliberately stays subscribed
  // regardless of isMinimized (the floating panel keeps this component
  // mounted the whole time a conversation is open, only hiding its
  // container visually while minimized) -- a minimized chat must still
  // receive live messages so the thread is current when restored, and so
  // onIncomingMessage can still light the panel's unread indicator.
  // otherPartyId is used (rather than fetching the viewer's own id) to
  // derive isMine: a conversation has exactly two participants, so any
  // sender that isn't otherPartyId is, by construction, the viewer.
  //
  // Deliberately does NOT await supabase.auth.getSession() before
  // subscribing, unlike NotificationsProvider's own equivalent channel
  // (see its file for the session-race bug that guard fixes there).
  // Considered and rejected here: this component only ever mounts once a
  // user has already navigated into (or opened the floating panel for) a
  // specific conversation -- by construction, several authenticated round
  // trips (the page's own getAuthUser() gate / the floating panel's own
  // server-action load, get_conversation_context, get_conversation_
  // messages, get_conversation_block_state) have already completed
  // first, so the browser client's session has always had ample time to
  // hydrate before this effect ever runs; live testing confirms this
  // channel already receives INSERT events correctly. NotificationsProvider
  // mounts at the very first paint of the entire app instead, with no such
  // guarantee, which is why it actually needed the fix. Adding an await
  // here would turn a synchronous subscribe into an async one for a path
  // that isn't broken -- a real (if small) risk to a proven-working
  // channel for no measurable benefit -- so it is intentionally left as-is.
  // isMinimized and onIncomingMessage are read through a ref (updated
  // every render, below) rather than depended on directly here -- the
  // floating panel's minimize/restore toggling, and any new
  // onIncomingMessage closure identity from its own re-renders, must
  // never tear down and recreate this channel. A resubscribe is not just
  // wasteful: it opens a real gap where an incoming message could be
  // missed between unsubscribe and the new channel's SUBSCRIBED state.
  // refreshUnreadMessageCount is NotificationsProvider's own stable
  // (empty-deps useCallback) function identity, so keeping it in the
  // dependency array below never causes a resubscribe either.
  //
  // Bug fix (hands-on QA): the channel topic below is built via
  // nextRealtimeChannelTopic(), not a plain `messages:${conversationId}`
  // string -- see that function's own doc comment (top of file) for why
  // a topic keyed only on conversationId let two effect invocations
  // (React Strict Mode's dev-only double-invoke on mount being the
  // common trigger) unknowingly collide on the exact same underlying,
  // already-subscribed channel object, throwing "cannot add
  // `postgres_changes` callbacks... after `subscribe()`." on the second
  // invocation. This was never about calling `.on()` after `.subscribe()`
  // on any ONE channel (the two have always been chained correctly, in
  // order, below) -- it was a channel-identity collision one level up.
  const latestRef = useRef({ isMinimized, onIncomingMessage });
  useEffect(() => {
    latestRef.current = { isMinimized, onIncomingMessage };
  });

  useEffect(() => {
    const conversationId = context.conversationId;
    // Guards the async reconciliation fetch below against this exact
    // effect invocation having already been cleaned up (unmount, or a
    // conversationId change) by the time it resolves -- a plain closure
    // flag, not a ref, so it is automatically scoped to (and reset fresh
    // for) each effect invocation/channel, with no risk of a stale fetch
    // from an OLD conversationId writing into a NEW one's state.
    let cancelled = false;
    // In-flight guard for reconcileMissedMessages below (task's own
    // "reconciliationInFlightRef or equivalent" -- a closure variable is
    // the equivalent here, for the same per-invocation-scoping reason as
    // `cancelled`). Not required for correctness on its own --
    // seenMessageIdsRef already makes a redundant/overlapping fetch's
    // result a harmless no-op -- purely to avoid launching a second
    // wasted network round trip while one is already pending.
    let reconciliationInFlight = false;
    // Coalescing flag for the race a plain in-flight guard alone leaves
    // open: reconnect #1 starts fetch A; the channel drops and rejoins
    // AGAIN while A is still running; without this flag that second
    // request would simply be dropped by the in-flight guard above, and
    // any message that arrived only during the second outage (i.e. after
    // A had already read the DB) could stay missing until some later
    // reconnect or a full reload. Set whenever a reconnect wants to
    // reconcile but a fetch is already running; consulted once that
    // fetch's own finally block clears reconciliationInFlight, so at most
    // one additional fetch ever runs afterward regardless of how many
    // reconnects requested one while the first was in flight (coalesced
    // into a single follow-up, not one per request).
    let reconciliationPending = false;
    // Distinguishes the very first successful SUBSCRIBED (no reconciliation
    // -- there is nothing to catch up on for a fresh mount) from a LATER
    // SUBSCRIBED that follows a genuine interruption (CHANNEL_ERROR/
    // TIMED_OUT after having already subscribed once) -- confirmed by
    // reading realtime-js/@supabase/phoenix's own source that an automatic
    // rejoin reuses the exact same channel/joinPush and re-invokes this
    // exact same status callback with SUBSCRIBED again, so no second
    // .subscribe() call or new channel is ever needed to observe this.
    let hasSubscribedOnce = false;
    let experiencedDisconnectAfterSubscribe = false;

    // Matches every other Supabase-touching call in this codebase
    // (send-message.ts, conversation-state.ts, etc.): never let a client
    // construction/subscription failure throw uncaught and take down the
    // whole thread -- worst case, this conversation simply has no live
    // updates for this mount, same as before Realtime existed.
    try {
      const supabase = createClient();

      // Reconnect reconciliation (additive to, never a replacement for,
      // the live postgres_changes handler below): realtime-js's own
      // rejoin mechanism does not replay postgres_changes events missed
      // while a channel was disconnected, so a genuine reconnect (see
      // the .subscribe() status callback below for exactly what counts
      // as one, as opposed to the very first SUBSCRIBED) triggers a
      // single fetch of the current newest page and merges anything
      // this thread doesn't already know about. Client-only per the
      // locked P1 decision -- get_conversation_messages has no forward/
      // "since" cursor, so this is bounded to the newest 30 messages, a
      // documented, accepted MVP limitation (an outage longer than that
      // self-heals on the next full reload/reopen).
      async function reconcileMissedMessages() {
        if (reconciliationInFlight) {
          // Don't drop this request -- remember it instead, so the
          // messages it would have caught up on aren't silently missed
          // (see reconciliationPending's own header comment above).
          reconciliationPending = true;
          return;
        }
        reconciliationInFlight = true;

        try {
          const result = await getLatestConversationMessages(conversationId);
          if (cancelled) return;

          if (!result.ok) {
            // Silent stale preservation + internal log only, matching
            // every other background read failure in this codebase
            // (handleLoadEarlier, etc.) -- messages/earlierCursor/
            // seenMessageIdsRef are all left completely untouched, no
            // raw backend error surfaced, and the channel itself is
            // never torn down or resubscribed over this. The viewer
            // never asked for this catch-up, so there is no inline
            // error either -- the next successful reconnect (or a
            // manual reload, which always does a fully correct SSR
            // fetch) naturally retries it.
            console.error("Realtime reconciliation fetch failed -- preserving current messages.");
            return;
          }

          // seenMessageIdsRef decides which fetched messages are
          // genuinely missing locally -- the render-level dedupe below is
          // now insertMessageInOrder, not appendMessageIfNew, for exactly
          // one reason: a message missed during the outage can be
          // *older* than a live message that already arrived and
          // rendered while this fetch was still pending (Realtime keeps
          // delivering on this same channel/binding throughout). Blindly
          // appending it after that newer live message would render the
          // conversation out of chronological order -- confirmed
          // reproducible with the exact M0/A/B scenario in this file's
          // own tests. insertMessageInOrder still dedupes by messageId
          // (a no-op for anything already present) -- this ref only ever
          // decides which messages/side effects this batch actually needs
          // to act on; appendMessageIfNew remains untouched and correct
          // for the live handler and handleSend below, where the newly
          // arrived/sent message is always, by construction, the newest
          // thing that has ever existed.
          const newMessages = result.messages.filter((message) => !seenMessageIdsRef.current.has(message.messageId));
          if (newMessages.length === 0) return;

          // Captured before merging -- same "was the viewer already near
          // the bottom" signal the live handler captures before its own
          // append, evaluated once for the whole batch rather than once
          // per reconciled message.
          const wasNearBottom = isNearBottomRef.current;

          for (const message of newMessages) seenMessageIdsRef.current.add(message.messageId);
          setMessages((prev) => {
            let next = prev;
            for (const message of newMessages) next = insertMessageInOrder(next, message);
            return next;
          });

          // Batch version of the live handler's own `wasNearBottom ||
          // isMine` scroll check -- reconciliation is semantically a
          // batch of live incoming messages arriving at once, so the
          // same per-message gating logic applies, just evaluated once
          // for the batch instead of once per message.
          if (wasNearBottom || newMessages.some((message) => message.isMine)) {
            pendingScrollRef.current = true;
          }

          const hasIncomingNotMine = newMessages.some((message) => !message.isMine);
          if (hasIncomingNotMine) {
            latestRef.current.onIncomingMessage?.();

            // Same isMinimized gate as the live handler: a minimized
            // panel must not silently mark messages the viewer hasn't
            // actually seen as read, even though its unread indicator
            // (onIncomingMessage, above) still lights.
            if (!latestRef.current.isMinimized) {
              void markConversationRead(conversationId).then(() => refreshUnreadMessageCount());
            }
          }
        } catch (err) {
          if (!cancelled) console.error("Realtime reconciliation fetch threw:", err instanceof Error ? err.message : err);
        } finally {
          reconciliationInFlight = false;
          // Run exactly one additional reconciliation if one was
          // requested while this fetch was running -- on success OR
          // failure (a failed fetch A must not swallow a reconnect that
          // arrived during it; the messages B would catch up on are
          // still missing). Cleared before the recursive call so a
          // request arriving during THAT run queues its own single
          // follow-up rather than being silently coalesced away.
          // `cancelled` (unmount/conversationId change) takes precedence
          // over any queued request -- never start new work for a torn-
          // down effect invocation.
          if (reconciliationPending && !cancelled) {
            reconciliationPending = false;
            void reconcileMissedMessages();
          }
        }
      }

      // See this effect's own header comment above for why this must be
      // globally unique per invocation, not just per conversationId.
      const channel = supabase
        .channel(nextRealtimeChannelTopic(`messages:${conversationId}`))
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const row = payload.new as RawMessageRow;
            if (row.conversation_id !== conversationId) return;

            const isMine = row.sender_id !== otherPartyId;
            // Captured before the append below changes scrollHeight --
            // this is "was the viewer already near the bottom", the
            // signal that decides whether this specific message should
            // pull the view down with it (Requirement C: never force a
            // viewer back down who deliberately scrolled up to read
            // older messages).
            const wasNearBottom = isNearBottomRef.current;

            // Decided synchronously, BEFORE setMessages is ever called --
            // NOT by mutating a variable inside the setMessages updater
            // and reading it back on the next line (the previous `let
            // wasNew = false; setMessages(prev => {...; wasNew = next !==
            // prev; ...}); if (wasNew)` pattern). That pattern assumed the
            // updater always runs synchronously and finishes before this
            // line executes -- true only for the FIRST update React has
            // pending for this hook since its last render; a second
            // Realtime INSERT callback firing before any render flushes
            // (proven reproducible: see this file's own
            // ConversationThread-realtime.test.tsx) finds this hook
            // already has a pending update, so its updater is queued for
            // the real render instead of run eagerly -- leaving that
            // second call's own `wasNew` still false at the moment this
            // exact check ran, even though the message is correctly
            // appended once React actually renders. Checking (and
            // immediately marking) seenMessageIdsRef here instead has no
            // such dependency: two callback invocations firing back-to-
            // back in the same tick still execute this line in order, as
            // plain synchronous JS, each one seeing exactly what the
            // previous one just recorded.
            const isNewMessage = !seenMessageIdsRef.current.has(row.id);
            seenMessageIdsRef.current.add(row.id);

            // appendMessageIfNew/messageId remains the sole, authoritative
            // render-level dedupe -- unchanged, and never weakened by the
            // ref above, which only ever decides which side effects (below)
            // to schedule.
            setMessages((prev) => appendMessageIfNew(prev, { messageId: row.id, isMine, body: row.body, createdAt: row.created_at }));

            if (isNewMessage && (wasNearBottom || isMine)) {
              // isMine covers the (harmless, already-deduped) case where
              // this Realtime echo of the viewer's own just-sent message
              // arrives before handleSend's own local append -- either
              // way the view should be at the bottom for the viewer's
              // own message regardless of where they'd scrolled to.
              pendingScrollRef.current = true;
            }

            if (isNewMessage && !isMine) {
              latestRef.current.onIncomingMessage?.();

              // The thread is open/live -- this is purely local
              // last_read_at bookkeeping (never a "seen" signal surfaced
              // to the other participant, per canon's no-read-receipts
              // rule). Suppressed while minimized: a minimized panel must
              // not silently mark a message the user hasn't actually seen
              // as read. The Messages badge is recalculated afterward
              // from the server (authoritative), not decremented/
              // incremented by guesswork here.
              if (!latestRef.current.isMinimized) {
                void markConversationRead(conversationId).then(() => refreshUnreadMessageCount());
              }
            }
          },
        )
        // Status visibility (unchanged) plus reconnect-triggered
        // reconciliation (additive). Logging still matches
        // NotificationsProvider's own equivalent .subscribe() callback
        // exactly (same two statuses, same generic err?.message ?? status
        // logging, no conversation id/message content) -- this still does
        // not resubscribe or refetch anything itself: realtime-js already
        // manages its own rejoin attempts internally (confirmed via its
        // own source -- the same channel/joinPush is reused, so this exact
        // callback fires again on its own after a rejoin), this purely
        // reacts to that. SUBSCRIBED and CLOSED are still never logged,
        // exactly like NotificationsProvider -- CLOSED fires on every
        // normal unmount/conversationId-change cleanup, not just a real
        // failure, so it must never trigger reconciliation either.
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("Realtime message subscription failed:", err?.message ?? status);
            if (hasSubscribedOnce) experiencedDisconnectAfterSubscribe = true;
            return;
          }
          if (status === "SUBSCRIBED") {
            if (hasSubscribedOnce && experiencedDisconnectAfterSubscribe) {
              experiencedDisconnectAfterSubscribe = false;
              void reconcileMissedMessages();
            }
            hasSubscribedOnce = true;
          }
          // CLOSED: no log (see comment above), no reconciliation trigger
          // -- intentionally falls through and does nothing.
        });

      return () => {
        cancelled = true;
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.error("Realtime message subscription failed to start:", err instanceof Error ? err.message : err);
      return undefined;
    }
  }, [context.conversationId, otherPartyId, refreshUnreadMessageCount]);

  const identityName = context.viewerRole === "seller" ? context.otherPartyDisplayName : context.shopName;

  function handleLoadEarlier() {
    if (!earlierCursor) return;
    setLoadEarlierFailed(false);
    startLoadEarlier(async () => {
      const result = await loadEarlier(context.conversationId, earlierCursor);
      if (result.hadError) {
        setLoadEarlierFailed(true);
        return;
      }
      for (const message of result.messages) seenMessageIdsRef.current.add(message.messageId);
      setMessages((prev) => [...result.messages, ...prev]);
      setEarlierCursor(result.nextCursor);
    });
  }

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH || isSending) return;

    setIsSending(true);
    setSendError(null);

    const result = await sendMessage(context.conversationId, trimmed);
    setIsSending(false);

    if (!result.ok) {
      setSendError(SEND_MESSAGE_ERROR_MESSAGES[result.code]);
      return;
    }

    // Marked as seen synchronously, right here, so a Realtime echo of this
    // exact send (in either arrival order relative to this RPC response)
    // is correctly recognized as already-known -- see seenMessageIdsRef's
    // own header comment above.
    seenMessageIdsRef.current.add(result.messageId);
    setMessages((prev) => appendMessageIfNew(prev, { messageId: result.messageId, isMine: true, body: trimmed, createdAt: result.createdAt }));
    setDraft("");
    // Requirement B: always follow the viewer's own just-sent message to
    // the bottom, regardless of where they'd scrolled to -- consumed by
    // the effect above the next time `messages` changes.
    isNearBottomRef.current = true;
    pendingScrollRef.current = true;
  }

  async function handleToggleArchive() {
    const next = !isArchived;
    setIsArchived(next);
    const result = await setConversationArchived(context.conversationId, next);
    if (!result.ok) setIsArchived(!next);
  }

  async function handleToggleMute() {
    const next = !isMuted;
    setIsMuted(next);
    const result = await setConversationMuted(context.conversationId, next);
    if (!result.ok) setIsMuted(!next);
  }

  async function handleMarkUnread() {
    const result = await markConversationUnread(context.conversationId);
    if (result.ok) setMarkedUnreadFeedback(true);
  }

  /** Block requires confirmation (a consequential, cross-cutting PRD 30
   * action); Unblock is direct, matching this component's own existing
   * mute/archive toggles. Both trust the RPC's own confirmed result as
   * authoritative -- never optimistic-only -- so effectiveCanSend below
   * only ever reflects a server-confirmed block state change. */
  async function handleConfirmBlock() {
    setIsBlockPending(true);
    setBlockError(null);

    const result = await blockUser(otherPartyId);
    setIsBlockPending(false);

    if (!result.ok) {
      setBlockError(BLOCK_USER_ERROR_MESSAGES[result.code]);
      return;
    }

    setIsBlockConfirmOpen(false);
    setIsBlocked(true);
  }

  async function handleUnblock() {
    setIsBlockPending(true);
    setBlockError(null);

    const result = await unblockUser(otherPartyId);
    setIsBlockPending(false);

    if (!result.ok) {
      setBlockError(UNBLOCK_USER_ERROR_MESSAGES[result.code]);
      return;
    }

    setIsBlocked(false);
  }

  const otherPartyLabel = context.viewerRole === "seller" ? "buyer" : "seller";
  // context.canSend is get_conversation_context's own page-load snapshot
  // (bidirectional block + restriction check, per 0046); combining it with
  // the viewer's own just-confirmed block action keeps the composer's
  // availability authoritative without a full page refresh. send_message
  // remains the sole real enforcement point regardless, per 0046's own
  // documented "UI convenience only" design.
  const effectiveCanSend = context.canSend && !isBlocked;

  return (
    // A plain flex column filling whatever height the caller gives it --
    // height:100% against an unbounded ancestor (nothing special done by
    // the full-page route) computes to auto per the CSS spec, so this
    // degrades to today's plain block layout there; ConversationDetailClient
    // and FloatingChatPanel each separately provide a real bounded height
    // (see their own comments) so the messages region below can actually
    // scroll internally instead of the whole page having to.
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-divider pb-3">
        {!hideBackLink && (
          <Link href="/messages" className="text-sm text-ink-secondary hover:text-ink">
            ← Back to Messages
          </Link>
        )}

        <div className={cn("flex items-center gap-3", hideIdentityHeader ? "justify-end" : "justify-between", !hideBackLink && "mt-2")}>
          {!hideIdentityHeader && (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas">
                {(context.viewerRole === "seller" ? context.otherPartyAvatarUrl : context.shopLogoUrl) ? (
                  <Image
                    src={(context.viewerRole === "seller" ? context.otherPartyAvatarUrl : context.shopLogoUrl)!}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                ) : (
                  <Package className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                )}
              </span>
              <h1 className="truncate text-lg font-bold text-ink">
                {context.viewerRole === "initiator" ? (
                  <Link href={`/shop/${context.shopSlug}`} className="hover:underline">
                    {identityName}
                  </Link>
                ) : (
                  identityName
                )}
              </h1>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <Tooltip label={isMuted ? "Unmute conversation" : "Mute conversation"}>
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={isMuted ? "Unmute conversation" : "Mute conversation"}
                aria-pressed={isMuted}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {isMuted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            </Tooltip>
            <Tooltip label={isArchived ? "Unarchive conversation" : "Archive conversation"}>
              <button
                type="button"
                onClick={handleToggleArchive}
                aria-label={isArchived ? "Unarchive conversation" : "Archive conversation"}
                aria-pressed={isArchived}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {isArchived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
              </button>
            </Tooltip>
            <Tooltip label="Mark as unread">
              <button
                type="button"
                onClick={handleMarkUnread}
                aria-label="Mark as unread"
                disabled={markedUnreadFeedback}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
              >
                <MailOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label={isBlocked ? `Unblock this ${otherPartyLabel}` : `Block this ${otherPartyLabel}`}>
              <button
                type="button"
                onClick={() => (isBlocked ? void handleUnblock() : setIsBlockConfirmOpen(true))}
                disabled={isBlockPending}
                aria-label={isBlocked ? `Unblock this ${otherPartyLabel}` : `Block this ${otherPartyLabel}`}
                aria-pressed={isBlocked}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
              >
                {isBlocked ? <UserCheck className="h-4 w-4" aria-hidden="true" /> : <UserX className="h-4 w-4" aria-hidden="true" />}
              </button>
            </Tooltip>
            <ReportButton
              targetType="conversation"
              targetId={context.conversationId}
              targetLabel="conversation"
              isAuthenticated={true}
              next={`/messages/${context.conversationId}`}
              iconOnly
            />
          </div>
        </div>

        {blockError && !isBlockConfirmOpen && <p className="mt-2 text-right text-xs text-danger">{blockError}</p>}

        {context.listingId && (
          <Link
            href={`/item/${context.listingPublicCode}`}
            className="mt-3 flex items-center gap-2.5 rounded-[10px] border border-border bg-canvas p-2 hover:border-brand-link"
          >
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[8px] bg-divider">
              {context.listingImageUrl ? (
                <Image src={context.listingImageUrl} alt="" fill sizes="36px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Package className="h-4 w-4 text-ink-muted/60" aria-hidden="true" />
                </div>
              )}
            </span>
            <span className="truncate text-xs font-medium text-ink-secondary">{context.listingTitle}</span>
          </Link>
        )}
      </div>

      {/* The one scrollable region for the whole thread -- see the three
          scroll effects and the Realtime handler above for how initial
          load, sending, incoming messages, and minimize/restore all keep
          this pinned to the latest message unless the viewer has
          deliberately scrolled up. min-h-0 is required for a flex child
          to be allowed to shrink below its content size at all (the
          default min-height:auto would otherwise make overflow-y-auto a
          no-op inside a flex column). */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        data-testid="messages-scroll-container"
        className="min-h-0 flex-1 overflow-y-auto py-4"
      >
        {earlierCursor && (
          <div className="mb-3 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={handleLoadEarlier}
              disabled={isLoadingEarlier}
              className="rounded-[10px] border border-border bg-surface px-4 py-2 text-xs font-semibold text-ink hover:border-brand-link disabled:opacity-60"
            >
              {isLoadingEarlier ? "Loading…" : "Load earlier messages"}
            </button>
            {loadEarlierFailed && <p className="text-xs text-danger">Unable to load earlier messages.</p>}
          </div>
        )}

        <ul className="space-y-2.5">
          {messages.map((message) => (
            <li key={message.messageId} className={message.isMine ? "flex justify-end" : "flex justify-start"}>
              <div className="max-w-[80%] sm:max-w-[70%]">
                <div
                  className={
                    message.isMine
                      ? "rounded-[14px] rounded-br-sm bg-brand-action px-3.5 py-2 text-sm text-brand-action-text"
                      : "rounded-[14px] rounded-bl-sm border border-border bg-surface px-3.5 py-2 text-sm text-ink"
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                </div>
                {containsExternalLink(message.body) && (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    External link — open carefully. Preshopps does not verify third-party websites.
                  </p>
                )}
                <p className={message.isMine ? "mt-0.5 text-right text-[11px] text-ink-muted" : "mt-0.5 text-[11px] text-ink-muted"}>
                  {formatMessageTimestamp(message.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="shrink-0 border-t border-divider pt-3 pb-4">
        {effectiveCanSend ? (
          <div className="flex items-end gap-1.5">
            <label htmlFor="message-composer" className="sr-only">
              Message
            </label>
            <textarea
              id="message-composer"
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              onKeyDown={(event) => handleComposerKeyDown(event, () => void handleSend())}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={2}
              placeholder="Write a message…"
              className="min-h-[44px] flex-1 resize-none rounded-[10px] border border-border bg-canvas p-2.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || draft.trim().length === 0}
              className="flex h-11 shrink-0 items-center justify-center rounded-[10px] bg-brand-action px-3 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isSending ? "Sending…" : "Send"}
            </button>
          </div>
        ) : (
          <p className="rounded-[10px] border border-border bg-canvas p-3 text-center text-sm text-ink-secondary">
            You can&apos;t send messages in this conversation.
          </p>
        )}
        {sendError && <p className="mt-2 text-sm text-danger">{sendError}</p>}
      </div>

      {isBlockConfirmOpen && (
        <ConfirmDialog
          title={`Block this ${otherPartyLabel}?`}
          description="You won't be able to message each other or start new order requests. Your existing message history stays visible to you both."
          confirmLabel="Block"
          destructive
          isPending={isBlockPending}
          errorMessage={blockError}
          onConfirm={() => void handleConfirmBlock()}
          onClose={() => setIsBlockConfirmOpen(false)}
        />
      )}
    </div>
  );
}
