import { renderEmailTemplate, type EmailEventType } from "./templates";
import { sendEmailViaResend, type SendEmailParams, type SendEmailResult } from "./resend-client";
import { isEmailProviderConfigured } from "./env";

type ClaimedEmailRow = {
  id: string;
  event_type: EmailEventType;
  entity_id: string;
  recipient_user_id: string;
  recipient_email: string;
  payload: Record<string, unknown> | null;
  attempt_count: number;
};

// PromiseLike (not Promise) so the real SupabaseClient's `.rpc()` --
// which returns an awaitable PostgrestFilterBuilder, not a literal
// Promise -- and a plain `{ rpc: vi.fn() }` test double are both
// structurally assignable here.
type SupabaseRpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type ProcessEmailOutboxResult = {
  claimed: number;
  sent: number;
  failed: number;
  providerConfigured: boolean;
};

export type ProcessEmailOutboxDeps = {
  supabase: SupabaseRpcClient;
  sendEmail?: (params: SendEmailParams) => Promise<SendEmailResult>;
  isProviderConfigured?: () => boolean;
  limit?: number;
};

/**
 * Core outbox-draining loop: claim -> render -> send -> finalize.
 * Deliberately takes its Supabase client, send function, and config check
 * as injectable dependencies so unit tests never touch a real database or
 * the real Resend network -- only the process-email-outbox cron route
 * wires in the real service-role client, the real sendEmailViaResend, and
 * the real isEmailProviderConfigured.
 *
 * Missing provider configuration (RESEND_API_KEY/EMAIL_FROM_ADDRESS) is
 * checked BEFORE claiming any row -- it is not a delivery attempt, so it
 * must never consume one of email_outbox's bounded 5 retry attempts or
 * drive a row toward terminal 'failed'. When unconfigured, this function
 * claims nothing at all: every currently-queued row stays exactly as it
 * was and becomes claimable again on the very next run, including once
 * configuration is later supplied.
 */
export async function processEmailOutbox({
  supabase,
  sendEmail = sendEmailViaResend,
  isProviderConfigured = isEmailProviderConfigured,
  limit = 20,
}: ProcessEmailOutboxDeps): Promise<ProcessEmailOutboxResult> {
  if (!isProviderConfigured()) {
    console.warn(
      "[email] Provider is not configured (RESEND_API_KEY and/or EMAIL_FROM_ADDRESS missing) -- skipping this run without claiming any email_outbox rows.",
    );
    return { claimed: 0, sent: 0, failed: 0, providerConfigured: false };
  }

  const { data, error } = await supabase.rpc("claim_pending_emails", { p_limit: limit });
  if (error) {
    throw new Error(`claim_pending_emails failed: ${error.message}`);
  }

  const rows = (data ?? []) as ClaimedEmailRow[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const template = renderEmailTemplate(row.event_type, row.payload ?? {});
    const result = await sendEmail({
      to: row.recipient_email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    if (result.ok) {
      const { error: markError } = await supabase.rpc("mark_email_sent", { p_id: row.id });
      if (markError) {
        console.error(`mark_email_sent failed for email_outbox row ${row.id}:`, markError.message);
      }
      sent += 1;
      continue;
    }

    if (result.reason === "not_configured") {
      // Defense-in-depth only: isProviderConfigured() above should make
      // this unreachable. Never consume an attempt or finalize this row
      // as failed -- leave it claimed; claim_pending_emails' own stale-
      // processing reclaim (5 minutes) will pick it back up later.
      console.warn(`[email] Provider became unconfigured mid-run for email_outbox row ${row.id}; leaving it claimed for later reclaim.`);
      continue;
    }

    const { error: markError } = await supabase.rpc("mark_email_failed", { p_id: row.id, p_error: result.error });
    if (markError) {
      console.error(`mark_email_failed failed for email_outbox row ${row.id}:`, markError.message);
    }
    failed += 1;
  }

  return { claimed: rows.length, sent, failed, providerConfigured: true };
}
