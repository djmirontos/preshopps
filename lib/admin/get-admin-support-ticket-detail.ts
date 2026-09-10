import { createClient } from "@/lib/supabase/server";
import type { SupportCategory } from "@/lib/support/submit-support-ticket";

/**
 * Row shape exactly matching public.get_admin_support_ticket_detail's
 * RETURNS TABLE (0070_admin_support_ticket_rpcs.sql).
 */
export type GetAdminSupportTicketDetailRow = {
  ticket_id: string;
  category: SupportCategory;
  message: string;
  user_id: string;
  user_display_name: string;
  created_at: string;
};

export type AdminSupportTicketDetail = {
  ticketId: string;
  category: SupportCategory;
  message: string;
  userId: string;
  userDisplayName: string;
  createdAt: string;
};

export type GetAdminSupportTicketDetailResult =
  | { status: "found"; ticket: AdminSupportTicketDetail }
  | { status: "not_found" }
  | { status: "not_admin" }
  | { status: "error" };

function mapRow(row: GetAdminSupportTicketDetailRow): AdminSupportTicketDetail {
  return {
    ticketId: row.ticket_id,
    category: row.category,
    message: row.message,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    createdAt: row.created_at,
  };
}

export async function getAdminSupportTicketDetail(ticketId: string): Promise<GetAdminSupportTicketDetailResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_admin_support_ticket_detail", { p_ticket_id: ticketId }));
  } catch (err) {
    console.error("get_admin_support_ticket_detail RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    if (error.details === "NOT_ADMIN") return { status: "not_admin" };
    if (error.details === "TICKET_NOT_FOUND") return { status: "not_found" };
    console.error("get_admin_support_ticket_detail RPC failed:", error.message);
    return { status: "error" };
  }

  const row = ((data ?? []) as GetAdminSupportTicketDetailRow[])[0];
  if (!row) return { status: "not_found" };

  return { status: "found", ticket: mapRow(row) };
}
