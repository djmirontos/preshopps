"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, MailOpen, Package, UserCheck, UserX, Volume2, VolumeX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import { containsExternalLink } from "@/lib/messaging/detect-link";
import { sendMessage, SEND_MESSAGE_ERROR_MESSAGES } from "@/lib/messaging/send-message";
import { appendMessageIfNew } from "@/lib/messaging/message-list";
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
};

/**
 * Focused conversation-detail component: header identity + listing
 * context, message history with a "Load earlier" cursor page, the
 * composer, and the three compact per-conversation state controls
 * (archive, mute, mark unread) -- all driven by direct
 * conversation_user_states updates (lib/messaging/conversation-state.ts),
 * per the backend's own locked "no toggle RPCs" design. Sending goes
 * through the existing send_message RPC only; a confirmed response is
 * appended (no optimistic temp-message reconciliation, kept simple per
 * instruction). No image/file attachments, no rich text, no edit/delete --
 * messages are immutable, matching PRD 25.4.
 */
export function ConversationDetailClient({ context, initialMessages, initialCursor, loadEarlier, otherPartyId, initialIsBlocked }: Props) {
  const [isArchived, setIsArchived] = useState(context.isArchived);
  const [isMuted, setIsMuted] = useState(context.isMuted);
  const [markedUnreadFeedback, setMarkedUnreadFeedback] = useState(false);

  const [isBlocked, setIsBlocked] = useState(initialIsBlocked);
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false);
  const [isBlockPending, setIsBlockPending] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [messages, setMessages] = useState(initialMessages);
  const [earlierCursor, setEarlierCursor] = useState(initialCursor);
  const [loadEarlierFailed, setLoadEarlierFailed] = useState(false);
  const [isLoadingEarlier, startLoadEarlier] = useTransition();

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const refreshUnreadMessageCount = useRefreshUnreadMessageCount();

  // Mark-read-on-open: fires at most once per conversationId per mount --
  // the ref (not just the dependency array) also guards against React
  // Strict Mode's dev-only double-invoke, which would otherwise trigger a
  // second read+maybe-write for the same open. markConversationReadIfUnread
  // itself performs zero writes when the conversation is already read, so
  // this is never a "repeated unnecessary write" even if the check reruns.
  // The Messages badge is always recalculated afterward (authoritative,
  // from the server) rather than guessed locally -- opening this one
  // conversation says nothing by itself about how many *other*
  // conversations are still unread.
  const markedReadForRef = useRef<string | null>(null);
  useEffect(() => {
    if (markedReadForRef.current === context.conversationId) return;
    markedReadForRef.current = context.conversationId;
    void markConversationReadIfUnread(context.conversationId).then(() => refreshUnreadMessageCount());
  }, [context.conversationId, refreshUnreadMessageCount]);

  // Realtime: one channel per open conversation, filtered server-side to
  // this conversation_id only (RLS re-validates participation regardless).
  // Mounts when this thread mounts/changes, cleanly unsubscribes on
  // unmount or conversationId change -- never a second channel left
  // dangling for a previous conversation. otherPartyId is used (rather
  // than fetching the viewer's own id) to derive isMine: a conversation
  // has exactly two participants, so any sender that isn't otherPartyId
  // is, by construction, the viewer.
  //
  // Deliberately does NOT await supabase.auth.getSession() before
  // subscribing, unlike NotificationsProvider's own equivalent channel
  // (see its file for the session-race bug that guard fixes there).
  // Considered and rejected here: this component only ever mounts once a
  // user has already navigated into a specific conversation -- by
  // construction, several authenticated round trips (the page's own
  // getAuthUser() gate, get_conversation_context, get_conversation_
  // messages, get_conversation_block_state) have already completed
  // first, so the browser client's session has always had ample time to
  // hydrate before this effect ever runs; live testing confirms this
  // channel already receives INSERT events correctly. NotificationsProvider
  // mounts at the very first paint of the entire app instead, with no such
  // guarantee, which is why it actually needed the fix. Adding an await
  // here would turn a synchronous subscribe into an async one for a path
  // that isn't broken -- a real (if small) risk to a proven-working
  // channel for no measurable benefit -- so it is intentionally left as-is.
  useEffect(() => {
    const conversationId = context.conversationId;

    // Matches every other Supabase-touching call in this codebase
    // (send-message.ts, conversation-state.ts, etc.): never let a client
    // construction/subscription failure throw uncaught and take down the
    // whole thread -- worst case, this conversation simply has no live
    // updates for this mount, same as before Realtime existed.
    try {
      const supabase = createClient();
      const channel = supabase
        .channel(`messages:${conversationId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            const row = payload.new as RawMessageRow;
            if (row.conversation_id !== conversationId) return;

            const isMine = row.sender_id !== otherPartyId;
            let wasNew = false;
            setMessages((prev) => {
              const next = appendMessageIfNew(prev, { messageId: row.id, isMine, body: row.body, createdAt: row.created_at });
              wasNew = next !== prev;
              return next;
            });

            // The thread is open and visible -- this is purely local
            // last_read_at bookkeeping (never a "seen" signal surfaced to
            // the other participant, per canon's no-read-receipts rule).
            // The Messages badge is recalculated afterward from the
            // server (authoritative), not decremented/incremented by
            // guesswork here.
            if (wasNew && !isMine) {
              void markConversationRead(conversationId).then(() => refreshUnreadMessageCount());
            }
          },
        )
        .subscribe();

      return () => {
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

    setMessages((prev) => appendMessageIfNew(prev, { messageId: result.messageId, isMine: true, body: trimmed, createdAt: result.createdAt }));
    setDraft("");
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
    <div>
      <div className="border-b border-divider pb-3">
        <Link href="/messages" className="text-sm text-ink-secondary hover:text-ink">
          ← Back to Messages
        </Link>

        <div className="mt-2 flex items-center justify-between gap-3">
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

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleToggleMute}
              aria-label={isMuted ? "Unmute conversation" : "Mute conversation"}
              aria-pressed={isMuted}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {isMuted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={handleToggleArchive}
              aria-label={isArchived ? "Unarchive conversation" : "Archive conversation"}
              aria-pressed={isArchived}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {isArchived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={handleMarkUnread}
              aria-label="Mark as unread"
              disabled={markedUnreadFeedback}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            >
              <MailOpen className="h-4 w-4" aria-hidden="true" />
            </button>
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

      <div className="py-4">
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

      <div className="border-t border-divider pt-3">
        {effectiveCanSend ? (
          <div className="flex items-end gap-2">
            <label htmlFor="message-composer" className="sr-only">
              Message
            </label>
            <textarea
              id="message-composer"
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={2}
              placeholder="Write a message…"
              className="min-h-[44px] flex-1 resize-none rounded-[10px] border border-border bg-canvas p-2.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || draft.trim().length === 0}
              className="flex h-11 shrink-0 items-center justify-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60"
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
