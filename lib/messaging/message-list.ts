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
