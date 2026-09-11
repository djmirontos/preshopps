import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const MIGRATION_PATH = "supabase/migrations/0084_supabase_cron_email_scheduling.sql";

describe("0084: enables pg_cron and pg_net, nothing else structural", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly the two extensions this scheduler needs", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).toMatch(/create extension if not exists pg_cron;/);
    expect(codeOnly).toMatch(/create extension if not exists pg_net;/);
  });

  it("creates no table, enum, or RLS policy -- pure scheduling wiring", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).not.toMatch(/create table|create type|create policy|alter table/i);
  });

  it("never CREATE OR REPLACEs any function -- outbox idempotency/retry logic (claim_pending_emails, mark_email_sent, mark_email_failed, enqueue_email, enqueue_pending_order_expiry_reminders) is entirely untouched", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).not.toMatch(/create (or replace )?function/i);
  });

  it("never references the order/listing/moderation/anonymization RPCs at all -- scheduler-layer only", () => {
    const codeOnly = stripSqlComments(source);
    for (const fn of ["submit_cart_order", "accept_order_items", "cancel_accepted_order", "apply_user_restriction", "lift_user_restriction", "anonymize_user_account"]) {
      expect(codeOnly).not.toMatch(new RegExp(fn));
    }
  });
});

describe("0084: hourly expiry-reminder scan via direct SQL function call, no HTTP, no secret", () => {
  const source = readFile(MIGRATION_PATH);

  it("schedules order-expiry-reminders-hourly at '0 * * * *' calling enqueue_pending_order_expiry_reminders directly", () => {
    expect(source).toMatch(
      /select cron\.schedule\(\s*\n\s*'order-expiry-reminders-hourly',\s*\n\s*'0 \* \* \* \*',\s*\n\s*\$\$select public\.enqueue_pending_order_expiry_reminders\(200\);\$\$\s*\n\s*\);/,
    );
  });

  it("this job's command contains no net.http_post and no secret lookup -- a plain SQL call", () => {
    const jobMatch = source.match(/select cron\.schedule\(\s*\n\s*'order-expiry-reminders-hourly'[\s\S]*?\);/);
    expect(jobMatch).not.toBeNull();
    expect(jobMatch![0]).not.toMatch(/net\.http_post|vault\./);
  });
});

describe("0084: every-15-minutes email processor via net.http_post to the Edge Function, secret resolved from Vault at run time", () => {
  const source = readFile(MIGRATION_PATH);

  it("schedules process-email-outbox-every-15-min at '*/15 * * * *'", () => {
    expect(source).toMatch(/select cron\.schedule\(\s*\n\s*'process-email-outbox-every-15-min',\s*\n\s*'\*\/15 \* \* \* \*',/);
  });

  it("targets the deterministic Supabase Edge Function URL for this exact project (never an unknown/guessed web-app production domain)", () => {
    expect(source).toMatch(/url := 'https:\/\/ylhfbqcyxjmxrbpkxtgu\.supabase\.co\/functions\/v1\/process-email-outbox'/);
  });

  it("passes the shared secret via an x-cron-secret header, resolved from vault.decrypted_secrets by name -- never a literal secret value", () => {
    expect(source).toMatch(/'x-cron-secret',\s*\(select decrypted_secret from vault\.decrypted_secrets where name = 'email_processor_cron_secret'\)/);
  });

  it("never embeds a literal secret string (only the vault lookup expression)", () => {
    const codeOnly = stripSqlComments(source);
    // A real secret would be a long opaque literal string in a headers/
    // auth context; the only string literals near auth here are the
    // header name and the vault secret's own *name*, not its value.
    expect(codeOnly).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
    expect(codeOnly).not.toMatch(/x-cron-secret',\s*'[^']{10,}'/);
  });

  it("sets a bounded timeout so a slow/cold Edge Function invocation cannot hang the cron worker", () => {
    expect(source).toMatch(/timeout_milliseconds := \d+/);
  });
});

describe("0084: header documents the Option A vs Option B tradeoff and Resend Free plan limits", () => {
  const source = readFile(MIGRATION_PATH);

  it("documents why the Edge Function (Option A) was chosen over invoking the existing Next.js processor route (Option B), in provider-neutral terms", () => {
    expect(source).toMatch(/Option A/);
    expect(source).toMatch(/Option B/);
    expect(source).toMatch(/no web app hosting has been linked or\s*\n?\s*-- deployed yet/);
  });

  it("never claims Vercel is the planned production host -- hosting language is provider-neutral, reflecting the confirmed Netlify + Supabase + Resend pre-launch decision", () => {
    expect(source).toMatch(/Netlify Free/);
    expect(source).not.toMatch(/production Vercel deployment|Vercel deployment being live/i);
  });

  it("documents the Resend Free plan's 100/day and 3,000/month limits and that quota failures use the existing retry path", () => {
    expect(source).toMatch(/100 emails\/day/);
    expect(source).toMatch(/3,000\/month/);
    expect(source).toMatch(/mark_email_failed/);
  });
});
