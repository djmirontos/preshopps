// Supabase Edge Function: process-email-outbox
//
// Deno port of lib/email/{templates,resend-client,process-email-outbox}.ts
// and lib/email/env.ts's provider-config checks, run on Supabase Cron so
// that ~15-minute email processing works reliably regardless of which
// platform hosts the Next.js web app (Preshopps' confirmed pre-launch
// hosting: Netlify Free for the web app, Supabase Free for backend/cron,
// Resend Free for email -- this function has no dependency on any of
// that web-app hosting choice). Content is kept byte-for-byte identical
// to the Next.js templates -- this is a necessary duplication across the
// Node/Deno runtime boundary (Next.js's `@/lib/env` path alias and
// `process.env` are not usable from Deno), not a change to the email
// event matrix or template content. See migration 0084's own header and
// the task report for the full tradeoff writeup.
//
// Auth: this function is deployed with verify_jwt = false and instead
// checks a custom `x-cron-secret` header against the CRON_SECRET Edge
// Function secret, using a constant-time comparison (see
// timingSafeEqualHash below) so response timing cannot be used to guess
// the secret byte-by-byte. Supabase Cron (pg_cron + pg_net) passes this
// header, with the secret value itself stored only in Supabase Vault
// (name: email_processor_cron_secret), never in this file or any
// migration. The auth check runs first, before any Supabase client is
// created or any RPC is called -- zero email_outbox rows are ever
// touched by an unauthenticated request. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are automatically injected by the Supabase
// platform into every Edge Function's runtime; they are never set or
// handled by this code.
//
// Resend Free plan limits (documented, not enforced here beyond existing
// batching): 100 emails/day, 3,000/month. A quota-exceeded response from
// Resend is treated as a genuine provider failure and uses the existing
// bounded retry/backoff (mark_email_failed), exactly like any other
// provider error -- no separate throttling logic is added.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@6";

// ===================== env / config =====================
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM_ADDRESS = Deno.env.get("EMAIL_FROM_ADDRESS");
// The canonical deployed Preshopps URL -- whatever platform ultimately
// hosts the Next.js web app (Netlify is the confirmed pre-launch choice).
// Deliberately never hardcoded here: no Netlify-generated URL is known
// yet, and this value must be set as an Edge Function secret once the
// app's real production URL exists.
const APP_BASE_URL = Deno.env.get("APP_BASE_URL");
const EMAIL_TEST_RECIPIENT_OVERRIDE = Deno.env.get("EMAIL_TEST_RECIPIENT_OVERRIDE");

function isProviderConfigured(): boolean {
  return Boolean(RESEND_API_KEY) && Boolean(EMAIL_FROM_ADDRESS) && Boolean(APP_BASE_URL);
}

// Constant-time secret comparison: both sides are first hashed to a
// fixed-length 32-byte SHA-256 digest (so comparison time never varies
// with the caller-supplied header's length, only with a fixed-size XOR
// loop), removing the most practical timing side-channel from a plain
// `===` string comparison. Uses only the standard Web Crypto API already
// available in the Edge Runtime -- no new dependency, matching "do not
// over-engineer."
async function timingSafeEqualHash(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

// ===================== templates (port of lib/email/templates.ts) =====================
type EmailEventType =
  | "new_order_request"
  | "order_accepted"
  | "order_declined"
  | "order_partial_acceptance"
  | "order_expiration_reminder"
  | "order_seller_cancelled"
  | "moderation_restriction_applied"
  | "moderation_restriction_lifted";

type EmailTemplate = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHtml(bodyLines: string[], linkHref: string, linkLabel: string): string {
  const paragraphs = bodyLines.map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`).join("");
  const link = `<p style="margin:20px 0 0;"><a href="${escapeHtml(linkHref)}" style="color:#111827;">${escapeHtml(linkLabel)}</a></p>`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:480px;"><p style="margin:0 0 20px;font-weight:600;">Preshopps</p>${paragraphs}${link}</div>`;
}

function getAppUrl(): string {
  if (!APP_BASE_URL) throw new Error("Missing required environment variable: APP_BASE_URL");
  return APP_BASE_URL;
}

function sellerOrderLink(publicCode: string): string {
  return `${getAppUrl()}/seller/orders/${publicCode}`;
}

function buyerOrderLink(publicCode: string): string {
  return `${getAppUrl()}/orders/${publicCode}`;
}

function supportLink(): string {
  return `${getAppUrl()}/support`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function formatRestrictionType(value: string): string {
  return value.replace(/_/g, " ");
}

function buildTemplate(subject: string, lines: string[], href: string, linkLabel: string): EmailTemplate {
  return {
    subject,
    text: `${lines.join("\n")}\n\n${linkLabel}: ${href}`,
    html: wrapHtml(lines, href, linkLabel),
  };
}

function renderEmailTemplate(eventType: EmailEventType, payload: Record<string, unknown>): EmailTemplate {
  switch (eventType) {
    case "new_order_request": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(
        `New order request -- ${code}`,
        [`You have a new order request (${code}).`, "Please review and respond -- accept, decline, or partially accept -- within 72 hours."],
        sellerOrderLink(code),
        "View order request",
      );
    }
    case "order_accepted": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(`Order accepted -- ${code}`, [`Good news -- your order (${code}) was accepted by the seller.`], buyerOrderLink(code), "View order");
    }
    case "order_declined": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(`Order declined -- ${code}`, [`Your order (${code}) was declined by the seller.`], buyerOrderLink(code), "View order");
    }
    case "order_partial_acceptance": {
      const code = asString(payload.order_public_code, "your order");
      const accepted = asNumber(payload.accepted_count);
      const declined = asNumber(payload.declined_count);
      return buildTemplate(
        `Order partially accepted -- ${code}`,
        [
          `Your order (${code}) was partially accepted: ${accepted} item(s) accepted, ${declined} item(s) declined.`,
          "Please confirm the changes to continue with the accepted items.",
        ],
        buyerOrderLink(code),
        "Review and confirm changes",
      );
    }
    case "order_expiration_reminder": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(
        `Order request expiring soon -- ${code}`,
        [
          `Your order request (${code}) has not been answered yet and will expire in about 24 hours.`,
          "Please respond soon -- accept, decline, or partially accept.",
        ],
        sellerOrderLink(code),
        "View order request",
      );
    }
    case "order_seller_cancelled": {
      const code = asString(payload.order_public_code, "your order");
      const reason = asString(payload.reason);
      return buildTemplate(
        `Order cancelled by seller -- ${code}`,
        [`The seller cancelled your order (${code}).`, ...(reason ? [`Reason: ${reason}`] : [])],
        buyerOrderLink(code),
        "View order",
      );
    }
    case "moderation_restriction_applied": {
      const restrictionType = formatRestrictionType(asString(payload.restriction_type, "restriction"));
      const reason = asString(payload.reason);
      return buildTemplate(
        "Action taken on your Preshopps account",
        [
          `An admin action was taken on your account (${restrictionType}).`,
          ...(reason ? [`Reason: ${reason}`] : []),
          "If you believe this is a mistake, please contact support.",
        ],
        supportLink(),
        "Contact support",
      );
    }
    case "moderation_restriction_lifted": {
      const restrictionType = formatRestrictionType(asString(payload.restriction_type, "restriction"));
      const note = asString(payload.note);
      return buildTemplate(
        "Your Preshopps account restriction was lifted",
        [`Your account restriction (${restrictionType}) has been lifted.`, ...(note ? [`Note: ${note}`] : [])],
        supportLink(),
        "Contact support",
      );
    }
    default: {
      throw new Error(`Unhandled email event type: ${String(eventType)}`);
    }
  }
}

// ===================== resend wrapper (port of lib/email/resend-client.ts) =====================
type SendEmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured"; error: string }
  | { ok: false; reason: "provider_error"; error: string };

async function sendEmailViaResend(params: { to: string; subject: string; html: string; text: string }): Promise<SendEmailResult> {
  if (!RESEND_API_KEY || !EMAIL_FROM_ADDRESS) {
    return {
      ok: false,
      reason: "not_configured",
      error: "Email provider is not configured (RESEND_API_KEY and/or EMAIL_FROM_ADDRESS is missing).",
    };
  }

  const to = EMAIL_TEST_RECIPIENT_OVERRIDE || params.to;

  try {
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: EMAIL_FROM_ADDRESS,
      to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      return { ok: false, reason: "provider_error", error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "provider_error",
      error: err instanceof Error ? err.message : "Unknown error calling the email provider.",
    };
  }
}

// ===================== outbox loop (port of lib/email/process-email-outbox.ts) =====================
type ClaimedEmailRow = {
  id: string;
  event_type: EmailEventType;
  entity_id: string;
  recipient_user_id: string;
  recipient_email: string;
  payload: Record<string, unknown> | null;
  attempt_count: number;
};

async function processEmailOutbox(supabase: SupabaseClient, limit = 20) {
  if (!isProviderConfigured()) {
    console.warn(
      "[email] Provider is not configured (RESEND_API_KEY/EMAIL_FROM_ADDRESS/APP_BASE_URL missing) -- skipping this run without claiming any email_outbox rows.",
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
    const result = await sendEmailViaResend({
      to: row.recipient_email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    if (result.ok) {
      const { error: markError } = await supabase.rpc("mark_email_sent", { p_id: row.id });
      if (markError) console.error(`mark_email_sent failed for email_outbox row ${row.id}:`, markError.message);
      sent += 1;
      continue;
    }

    if (result.reason === "not_configured") {
      console.warn(`[email] Provider became unconfigured mid-run for email_outbox row ${row.id}; leaving it claimed for later reclaim.`);
      continue;
    }

    const { error: markError } = await supabase.rpc("mark_email_failed", { p_id: row.id, p_error: result.error });
    if (markError) console.error(`mark_email_failed failed for email_outbox row ${row.id}:`, markError.message);
    failed += 1;
  }

  return { claimed: rows.length, sent, failed, providerConfigured: true };
}

// ===================== HTTP entrypoint =====================
Deno.serve(async (req: Request) => {
  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || !(await timingSafeEqualHash(providedSecret, CRON_SECRET))) {
    // Never logs the provided or expected secret -- only a generic
    // unauthorized outcome, and only after auth, before any Supabase
    // client is created or any email_outbox row is touched.
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const result = await processEmailOutbox(supabase);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("process-email-outbox edge function failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
