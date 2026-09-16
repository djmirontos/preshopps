import type { ConversationMessage } from "@/lib/messaging/get-conversation-messages";

/**
 * Stable message_id-based dedupe: appends `incoming` only if no message
 * with the same id already exists. Used identically by both the
 * RPC-confirmed send handler and the Realtime INSERT handler in
 * ConversationDetailClient, so whichever arrives first wins and the other
 * is a safe no-op -- never a timing assumption between the HTTP response
 * and the websocket event.
 */
export function appendMessageIfNew(messages: ConversationMessage[], incoming: ConversationMessage): ConversationMessage[] {
  if (messages.some((message) => message.messageId === incoming.messageId)) return messages;
  return [...messages, incoming];
}

/**
 * Inserts `incoming` at its correct chronological position -- createdAt
 * ascending, then messageId ascending as a deterministic tie-breaker for
 * equal timestamps -- rather than always at the end. A no-op (like
 * appendMessageIfNew) if a message with the same id already exists.
 *
 * appendMessageIfNew remains correct and unchanged for ordinary live
 * Realtime/send messages, which are by construction the newest thing that
 * has ever existed in the conversation at the moment they arrive. This
 * helper is for merging a BATCH whose relative arrival order does not
 * necessarily match chronological order -- specifically Realtime
 * reconnect reconciliation, where an older message missed during a
 * disconnect can be discovered only AFTER a newer live message has
 * already rendered (blindly appending it after that newer message would
 * render the conversation out of order).
 */
export function insertMessageInOrder(messages: ConversationMessage[], incoming: ConversationMessage): ConversationMessage[] {
  if (messages.some((message) => message.messageId === incoming.messageId)) return messages;

  const insertBeforeIndex = messages.findIndex((message) => {
    if (message.createdAt !== incoming.createdAt) return message.createdAt > incoming.createdAt;
    return message.messageId > incoming.messageId;
  });

  if (insertBeforeIndex === -1) return [...messages, incoming];
  return [...messages.slice(0, insertBeforeIndex), incoming, ...messages.slice(insertBeforeIndex)];
}
