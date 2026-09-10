import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getConversationContext } from "@/lib/messaging/get-conversation-context";
import { getConversationMessages } from "@/lib/messaging/get-conversation-messages";
import { getConversationBlockState } from "@/lib/messaging/get-conversation-block-state";
import { ConversationDetailClient } from "@/components/messaging/ConversationDetailClient";
import type { MessagesCursor } from "@/lib/messaging/get-conversation-messages";

const MESSAGES_LIMIT = 30;

type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { conversationId } = await params;
  void conversationId;
  return { title: "Messages | Preshopps" };
}

/**
 * Authenticated only. get_conversation_context (0046) scopes every result
 * to a caller who is actually a participant -- a conversation the caller
 * does not participate in, or a nonexistent id, both resolve to zero rows,
 * mapped to the same notFound(), so a direct URL to someone else's
 * conversation behaves identically to "not found" (never a distinguishing
 * 403/permission error that would confirm the conversation exists).
 *
 * conversationId is the raw conversation UUID -- conversations have no
 * public-safe code (unlike orders/listings), and this route is never
 * publicly discoverable or shared outside its two participants (unlike an
 * order receipt), so using the id directly here is the documented
 * fallback per this task's own routing instruction. It is never rendered
 * as visible text anywhere in the UI.
 */
export default async function ConversationDetailPage({ params }: PageProps) {
  const { conversationId } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/messages/${conversationId}`)}`);
  }

  const contextResult = await getConversationContext(conversationId);

  if (contextResult.status === "not_found") {
    notFound();
  }

  if (contextResult.status === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this conversation right now.</p>
      </div>
    );
  }

  const [messagesResult, blockStateResult] = await Promise.all([
    getConversationMessages(conversationId, MESSAGES_LIMIT),
    getConversationBlockState(conversationId),
  ]);

  async function loadEarlierAction(id: string, cursor: MessagesCursor) {
    "use server";
    return getConversationMessages(id, MESSAGES_LIMIT, cursor);
  }

  if (messagesResult.hadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this conversation right now.</p>
      </div>
    );
  }

  // get_conversation_block_state uses the exact same participant-
  // resolution logic as get_conversation_context (0072's own header), so
  // a "found" contextResult should always pair with a "found" block
  // state too; a soft fallback (block/unblock simply unavailable this
  // load) is kept only for the structurally-shouldn't-happen case,
  // rather than failing the whole conversation view over it.
  const blockState = blockStateResult.status === "found" ? blockStateResult.state : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <ConversationDetailClient
        context={contextResult.context}
        initialMessages={messagesResult.messages}
        initialCursor={messagesResult.nextCursor}
        loadEarlier={loadEarlierAction}
        otherPartyId={blockState?.otherPartyId ?? ""}
        initialIsBlocked={blockState?.isBlockedByViewer ?? false}
      />
    </div>
  );
}
