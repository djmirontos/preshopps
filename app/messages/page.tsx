import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Inbox } from "lucide-react";
import { getAuthUser } from "@/lib/auth/session";
import { getMyConversations } from "@/lib/messaging/get-my-conversations";
import { ConversationsListClient } from "@/components/messaging/ConversationsListClient";
import type { ConversationsCursor } from "@/lib/messaging/get-my-conversations";

export const metadata = { title: "Messages | Preshopps" };

const CONVERSATIONS_LIMIT = 20;

type PageProps = {
  searchParams: Promise<{ view?: string }>;
};

/**
 * Authenticated-only, exactly like /orders and /seller/orders:
 * getAuthUser() runs before any conversation data is fetched, so a guest
 * never triggers get_my_conversations. One inbox combines conversations
 * the user started (buyer role) and conversations sent to their own shop
 * (seller role) -- get_my_conversations (0046) already unions both. The
 * Archived view is a separate query (p_archived=true), not a client-side
 * filter, to keep cursor pagination correct.
 *
 * Deliberately deferred for this first pass (reported, not silently
 * dropped): inbox search and separate All/Unread filter tabs (PRD 25.7).
 * Unread state is already visible per-row; a full metadata search adds
 * meaningful scope this task's own compactness instruction argues against
 * for a first pass.
 */
export default async function MessagesPage({ searchParams }: PageProps) {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/messages")}`);
  }

  const { view } = await searchParams;
  const showingArchived = view === "archived";

  const result = await getMyConversations(CONVERSATIONS_LIMIT, undefined, showingArchived);

  async function loadMoreAction(cursor: ConversationsCursor) {
    "use server";
    return getMyConversations(CONVERSATIONS_LIMIT, cursor, showingArchived);
  }

  /** Targeted first-page refetch, triggered client-side when a new_message
   * notification arrives while this list is mounted (see
   * ConversationsListClient) -- reuses this same view's own
   * showingArchived scope, never a full page reload. */
  async function refreshFirstPageAction() {
    "use server";
    return getMyConversations(CONVERSATIONS_LIMIT, undefined, showingArchived);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">Messages</h1>
        <Link
          href={showingArchived ? "/messages" : "/messages?view=archived"}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border px-3 text-xs font-semibold text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {showingArchived ? (
            <>
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
              Back to inbox
            </>
          ) : (
            <>
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              Archived
            </>
          )}
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">
        {showingArchived ? "Archived conversations." : "Conversations with buyers and sellers."}
      </p>

      <div className="mt-6">
        <ConversationsListClient
          initialConversations={result.conversations}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
          refreshFirstPage={refreshFirstPageAction}
          showingArchived={showingArchived}
        />
      </div>
    </div>
  );
}
