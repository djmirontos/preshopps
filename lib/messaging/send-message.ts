import { createClient } from "@/lib/supabase/client";

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

export type SendMessageErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "CONVERSATION_NOT_FOUND"
  | "NOT_CONVERSATION_PARTICIPANT"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "CONVERSATION_STATE_INVALID";

const SEND_MESSAGE_ERROR_CODES: ReadonlySet<string> = new Set<SendMessageErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "CONVERSATION_NOT_FOUND",
  "NOT_CONVERSATION_PARTICIPANT",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "CONVERSATION_STATE_INVALID",
]);

export const SEND_MESSAGE_ERROR_MESSAGES: ErrorMap<SendMessageErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "You can't send messages in this conversation.",
  CONVERSATION_NOT_FOUND: "This conversation could not be found.",
  NOT_CONVERSATION_PARTICIPANT: "You don't have permission to send messages here.",
  MESSAGE_EMPTY: "Please enter a message.",
  MESSAGE_TOO_LONG: "Messages can be up to 4000 characters.",
  CONVERSATION_STATE_INVALID: "Something went wrong. Please try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type SendMessageResult =
  | { ok: true; messageId: string; createdAt: string }
  | { ok: false; code: SendMessageErrorCode | "UNKNOWN" };

type SendMessageRpcRow = { message_id: string; conversation_id: string; message_created_at: string };

/**
 * Thin client wrapper around the existing public.send_message RPC (0031,
 * unchanged). Only conversation_id + body are ever sent -- sender is
 * derived from auth.uid() inside the RPC, never supplied by the client.
 */
export async function sendMessage(conversationId: string, body: string): Promise<SendMessageResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("send_message", {
      p_conversation_id: conversationId,
      p_body: body,
    });

    if (error) {
      console.error("send_message RPC failed:", error.message);
      return { ok: false, code: toErrorCode((error as { details?: string }).details) };
    }

    const row = ((data ?? []) as SendMessageRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, messageId: row.message_id, createdAt: row.message_created_at };
  } catch (err) {
    console.error("send_message RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

function toErrorCode(detail: string | undefined): SendMessageErrorCode | "UNKNOWN" {
  return detail && SEND_MESSAGE_ERROR_CODES.has(detail) ? (detail as SendMessageErrorCode) : "UNKNOWN";
}
