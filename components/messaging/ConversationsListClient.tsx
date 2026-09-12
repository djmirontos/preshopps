"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { MessageCircle, Store, VolumeX } from "lucide-react";
import { formatMessageTimestamp } from "@/lib/messaging/format-message-time";
import { useLatestNotificationEvent } from "@/components/notifications/NotificationsProvider";
import type { ConversationSummary, ConversationsCursor } from "@/lib/messaging/get-my-conversations";

type LoadMoreResult = {
  conversations: ConversationSummary[];
  hadError: boolean;
  nextCursor: ConversationsCursor | null;
};

/** Debounce window for coalescing rapid new_message events into a single
 * refetch -- each new event resets this timer (see the effect below), so a
 * burst of incoming messages triggers exactly one refresh shortly after
 * the burst settles, not one per message. */
const REFRESH_DEBOUNCE_MS = 400;

type Props = {
  initialConversations: ConversationSummary[];
  initialHadError: boolean;
  initialCursor: ConversationsCursor | null;
  loadMore: (cursor: ConversationsCursor) => Promise<LoadMoreResult>;
  /** Targeted first-page refetch (no public.conversations subscription --
   * see the file-level comment) used whenever a new_message notification
   * arrives while this list is mounted. */
  refreshFirstPage: () => Promise<LoadMoreResult>;
  showingArchived: boolean;
};

/**
 * Same server-rendered-first-page + Load More shape as OrdersListClient/
 * SellerOrdersListClient -- cursor pagination on (last_message_at, id),
 * never OFFSET, per get_my_conversations (0046). public.conversations is
 * deliberately not in the Realtime publication and this component never
 * subscribes to it directly -- conversation-level liveness is instead
 * derived from the shared NotificationsProvider's own `new_message` signal
 * (every send_message call already inserts exactly one deduped
 * notification row in the same transaction), reusing that one channel
 * rather than opening a second websocket here.
 */
export function ConversationsListClient({ initialConversations, initialHadError, initialCursor, loadMore, refreshFirstPage, showingArchived }: Props) {
  const [conversations, setConversations] = useState(initialConversations);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const lastEvent = useLatestNotificationEvent();
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== "new_message") return;

    const timeoutId = setTimeout(() => {
      void refreshFirstPage().then((result) => {
        if (result.hadError) return;
        setConversations(result.conversations);
        setCursor(result.nextCursor);
      });
    }, REFRESH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [lastEvent, refreshFirstPage]);

  if (initialHadError) {
    return <p className="text-sm text-ink-secondary">Unable to load your messages right now.</p>;
  }

  if (conversations.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <MessageCircle className="mx-auto h-8 w-8 text-ink-muted/60" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-ink">{showingArchived ? "No archived conversations." : "No messages yet."}</p>
        {!showingArchived && <p className="mt-1 text-sm text-ink-muted">Messages with buyers and sellers will appear here.</p>}
      </div>
    );
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await loadMore(cursor);
      if (result.hadError) {
        setLoadMoreFailed(true);
        return;
      }
      setConversations((prev) => [...prev, ...result.conversations]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <ul className="space-y-2">
        {conversations.map((conversation) => {
          const identityName = conversation.viewerRole === "seller" ? conversation.otherPartyDisplayName : conversation.shopName;
          const avatarUrl = conversation.viewerRole === "seller" ? conversation.otherPartyAvatarUrl : conversation.shopLogoUrl;

          return (
            <li key={conversation.conversationId}>
              <Link
                href={`/messages/${conversation.conversationId}`}
                className="flex items-start gap-3 rounded-[14px] border border-border bg-surface p-3 hover:border-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:p-4"
              >
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas">
                  {avatarUrl ? (
                    <Image src={avatarUrl} alt="" fill sizes="44px" className="object-cover" />
                  ) : (
                    <Store className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={conversation.isUnread ? "truncate text-sm font-semibold text-ink" : "truncate text-sm font-medium text-ink"}>
                      {identityName}
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">{formatMessageTimestamp(conversation.lastMessageAt)}</span>
                  </div>

                  {conversation.listingTitle && (
                    <p className="mt-0.5 truncate text-xs text-ink-muted">Re: {conversation.listingTitle}</p>
                  )}

                  <div className="mt-1 flex items-center gap-1.5">
                    {conversation.isUnread && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-brand-action" aria-hidden="true" />
                    )}
                    <p className={conversation.isUnread ? "truncate text-sm font-medium text-ink" : "truncate text-sm text-ink-secondary"}>
                      {conversation.lastMessageIsMine ? "You: " : ""}
                      {conversation.lastMessagePreview}
                    </p>
                    {conversation.isMuted && <VolumeX className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-label="Muted" />}
                  </div>

                  {conversation.isUnread && <span className="sr-only"> (unread)</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-[10px] border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-link hover:text-brand-link disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more conversations right now.</p>}
        </div>
      )}
    </div>
  );
}
