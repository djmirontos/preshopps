import { createClient } from "@/lib/supabase/server";
import type { SupportCategory } from "@/lib/support/submit-support-ticket";

/**
 * Row shape exactly matching public.get_admin_support_tickets' RETURNS
 * TABLE (0070_admin_support_ticket_rpcs.sql).
 */
export type GetAdminSupportTicketsRow = {
  ticket_id: string;
  category: SupportCategory;
  message: string;
  user_id: string;
  user_display_name: string;
  created_at: string;
};

export type AdminSupportTicketSummary = {
  ticketId: string;
  category: SupportCategory;
  message: string;
  userId: string;
  userDisplayName: string;
  createdAt: string;
};

export type AdminSupportTicketsCursor = {
  createdAt: string;
  id: string;
};

export type GetAdminSupportTicketsResult = {
  tickets: AdminSupportTicketSummary[];
  hadError: boolean;
  /** True specifically when the RPC rejected the caller as not an admin --
   * distinguished from a generic error so the page can show a clean
   * not-found state instead of a "try again" message. */
  notAdmin: boolean;
  nextCursor: AdminSupportTicketsCursor | null;
};

function mapRow(row: GetAdminSupportTicketsRow): AdminSupportTicketSummary {
  return {
    ticketId: row.ticket_id,
    category: row.category,
    message: row.message,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    createdAt: row.created_at,
  };
}

/**
 * get_admin_support_tickets (0070) raises NOT_ADMIN for a non-admin caller
 * -- surfaced here as `notAdmin: true`, mirroring getAdminReports' own
 * convention, so the page can render notFound() without leaking any
 * ticket data.
 */
export async function getAdminSupportTickets(limit: number, cursor?: AdminSupportTicketsCursor): Promise<GetAdminSupportTicketsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_support_tickets", {
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    }));
  } catch (err) {
    console.error("get_admin_support_tickets RPC threw:", err instanceof Error ? err.message : err);
    return { tickets: [], hadError: true, notAdmin: false, nextCursor: null };
  }

  if (error) {
    const isNotAdmin = error.details === "NOT_ADMIN";
    if (!isNotAdmin) {
      console.error("get_admin_support_tickets RPC failed:", error.message);
    }
    return { tickets: [], hadError: !isNotAdmin, notAdmin: isNotAdmin, nextCursor: null };
  }

  const rows = (data ?? []) as GetAdminSupportTicketsRow[];
  const tickets = rows.map(mapRow);
  const nextCursor = rows.length === limit ? { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].ticket_id } : null;

  return { tickets, hadError: false, notAdmin: false, nextCursor };
}
