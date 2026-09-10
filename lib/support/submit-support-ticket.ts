import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrapper around submit_support_ticket (0069) -- the four
 * canonical support categories PRD 43.1 lists verbatim, nothing more.
 * Identity is always derived server-side from auth.uid(); this wrapper
 * never sends a user id.
 */

export type SupportCategory = "general_inquiry" | "account_issue" | "order_dispute_issue" | "report_a_problem";

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  general_inquiry: "General inquiry",
  account_issue: "Account issue",
  order_dispute_issue: "Order/dispute issue",
  report_a_problem: "Report a problem",
};

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export type SubmitSupportTicketErrorCode = "NOT_AUTHENTICATED" | "INTERACTION_BLOCKED" | "MESSAGE_REQUIRED" | "MESSAGE_TOO_LONG";

const SUBMIT_SUPPORT_TICKET_ERROR_CODES: ReadonlySet<string> = new Set<SubmitSupportTicketErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "MESSAGE_REQUIRED",
  "MESSAGE_TOO_LONG",
]);

export const SUBMIT_SUPPORT_TICKET_ERROR_MESSAGES: ErrorMap<SubmitSupportTicketErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "Your account cannot submit support requests right now.",
  MESSAGE_REQUIRED: "Please describe your issue.",
  MESSAGE_TOO_LONG: "Please shorten your message.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type SubmitSupportTicketResult =
  | { ok: true; ticketId: string; createdAt: string }
  | { ok: false; code: SubmitSupportTicketErrorCode | "UNKNOWN" };

type SubmitSupportTicketRpcRow = { ticket_id: string; created_at: string };

export async function submitSupportTicket(category: SupportCategory, message: string): Promise<SubmitSupportTicketResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("submit_support_ticket", {
      p_category: category,
      p_message: message,
    });

    if (error) {
      console.error("submit_support_ticket RPC failed:", error.message);
      return { ok: false, code: toErrorCode<SubmitSupportTicketErrorCode>((error as { details?: string }).details, SUBMIT_SUPPORT_TICKET_ERROR_CODES) };
    }

    const row = ((data ?? []) as SubmitSupportTicketRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, ticketId: row.ticket_id, createdAt: row.created_at };
  } catch (err) {
    console.error("submit_support_ticket RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
