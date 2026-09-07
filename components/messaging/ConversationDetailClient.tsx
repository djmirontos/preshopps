"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, MailOpen, Package, Volume2, VolumeX } from "lucide-react";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import { containsExternalLink } from "@/lib/messaging/detect-link";
import { sendMessage, SEND_MESSAGE_ERROR_MESSAGES } from "@/lib/messaging/send-message";
import {
  markConversationReadIfUnread,
  markConversationUnread,
  setConversationArchived,
  setConversationMuted,
} from "@/lib/messaging/conversation-state";
import type { ConversationContext } from "@/lib/messaging/get-conversation-context";
import type { ConversationMessage, MessagesCursor } from "@/lib/messaging/get-conversation-messages";

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
export function ConversationDetailClient({ context, initialMessages, initialCursor, loadEarlier }: Props) {
  const [isArchived, setIsArchived] = useState(context.isArchived);
  const [isMuted, setIsMuted] = useState(context.isMuted);
  const [markedUnreadFeedback, setMarkedUnreadFeedback] = useState(false);

  const [messages, setMessages] = useState(initialMessages);
  const [earlierCursor, setEarlierCursor] = useState(initialCursor);
  const [loadEarlierFailed, setLoadEarlierFailed] = useState(false);
  const [isLoadingEarlier, startLoadEarlier] = useTransition();

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Mark-read-on-open: fires at most once per conversationId per mount --
  // the ref (not just the dependency array) also guards against React
  // Strict Mode's dev-only double-invoke, which would otherwise trigger a
  // second read+maybe-write for the same open. markConversationReadIfUnread
  // itself performs zero writes when the conversation is already read, so
  // this is never a "repeated unnecessary write" even if the check reruns.
  const markedReadForRef = useRef<string | null>(null);
  useEffect(() => {
    if (markedReadForRef.current === context.conversationId) return;
    markedReadForRef.current = context.conversationId;
    void markConversationReadIfUnread(context.conversationId);
  }, [context.conversationId]);

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

    setMessages((prev) => [...prev, { messageId: result.messageId, isMine: true, body: trimmed, createdAt: result.createdAt }]);
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
          </div>
        </div>

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
        {context.canSend ? (
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
    </div>
  );
}
