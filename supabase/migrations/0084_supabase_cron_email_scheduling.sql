-- Scheduler-layer refactor only: transactional email processing and the
-- pending-order expiry reminder scan must run reliably (~15-minute
-- processor cadence, hourly reminder scan) regardless of which platform
-- hosts the Next.js web app. Preshopps' confirmed pre-launch hosting is
-- Netlify Free (web app) + Supabase Free (backend/database/auth/storage/
-- cron) + Resend Free (email); this design intentionally does not depend
-- on the web app's own host/scheduled-function tier at all -- Supabase
-- Cron (pg_cron) is used exclusively instead, so it works identically
-- regardless of which platform ultimately serves the Next.js app. (This
-- work was originally scoped after finding Vercel Hobby's once-daily
-- Cron limit incompatible with these schedules, during an earlier
-- hosting evaluation; the pre-launch hosting decision has since moved to
-- Netlify, but the Supabase-Cron-based design below is provider-neutral
-- by construction and remains correct unchanged.) No email event,
-- template, outbox schema, retry/idempotency semantics, or order/
-- moderation business logic is touched by this migration -- see the
-- verification section at the end of this header.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0083_transactional_email_outbox (confirmed
-- live, no drift). pg_cron and pg_net confirmed NOT installed
-- (list_extensions: installed_version null for both); supabase_vault
-- confirmed already installed (schema `vault`, used since 0081 for
-- nothing yet -- this is its first real use). Both pg_cron and pg_net are
-- present in this project's extension catalog with real default_versions
-- (1.6.4 and 0.20.4), confirming hosted Supabase DOES support self-
-- enabling them via a normal migration on this project -- no dashboard-
-- only gate blocks it.
--
-- Two schedules, two different mechanisms -- chosen per the smallest-
-- surface-area option for each
-- -----------------------------------------------------------------------
-- 1. order-expiry-reminders-hourly: pg_cron calls
--    public.enqueue_pending_order_expiry_reminders(200) DIRECTLY as a SQL
--    statement -- no HTTP call, no Edge Function, no secret of any kind.
--    This is exactly "Supabase Cron runs the expiry-reminder database
--    function hourly," the preferred design's own first line, in its
--    simplest possible form.
-- 2. process-email-outbox-every-15-min: actually sending an email
--    requires an outbound HTTPS call to Resend, which cannot happen from
--    a Postgres function -- so this job uses net.http_post to invoke a
--    new Supabase Edge Function (process-email-outbox, deployed
--    separately, not part of this migration) that reuses
--    claim_pending_emails/mark_email_sent/mark_email_failed exactly as
--    already established (0083, untouched here). The Edge Function is
--    deployed with verify_jwt = false and instead checks a custom
--    `x-cron-secret` header; the shared secret value is read at RUN time
--    from Supabase Vault (vault.decrypted_secrets, name
--    'email_processor_cron_secret') via a lookup embedded in this job's
--    own SQL body -- the literal secret value itself was inserted into
--    Vault via a separate, untracked execute_sql call (never a migration,
--    never a file in this repo, per this task's own explicit "no secrets
--    embedded in migration SQL or tracked files" instruction). This
--    migration's own SQL contains only the vault lookup expression, never
--    the secret's value.
--
-- Why Option A (Edge Function) over Option B (pg_net calling the existing
-- Next.js processor route)
-- -----------------------------------------------------------------------
-- Both were evaluated. Option B would reuse the existing Next.js
-- processor code with zero duplication, but requires knowing the web
-- app's actual production URL -- no web app hosting has been linked or
-- deployed yet, and that URL cannot be guessed without violating this
-- task's own "Do not guess" instruction. It would also make scheduled
-- email delivery depend on the web app's own deployment being live and
-- warm at every 15-minute tick, reintroducing exactly the kind of
-- web-host-scheduling coupling this refactor exists to remove. Option
-- A's Edge Function URL is fully deterministic from this Supabase
-- project's own known ref (https://ylhfbqcyxjmxrbpkxtgu.supabase.co/
-- functions/v1/process-email-outbox) -- zero dependency on the web app
-- being deployed, reachable, or even hosted anywhere yet. The cost is a
-- duplicated (Deno-compatible) copy of templates.ts/resend-client.ts/
-- process-email-outbox.ts's logic, since Next.js's `@/lib/env` path
-- alias and `process.env` are not usable from the Edge Function's Deno
-- runtime -- kept byte-for-byte identical in rendered content, a
-- reported, deliberate duplication tradeoff, not a change to the email
-- event matrix or template wording. The existing Next.js /api/cron/*
-- routes are left exactly as they were (0083), contain no host-specific
-- code, and remain usable for manual/admin testing on whichever platform
-- ultimately hosts the app -- they are simply no longer invoked by any
-- web host's own Cron feature (vercel.json's cron config was removed in
-- the same task, as a separate file change, not part of this migration;
-- no equivalent Netlify scheduled-function config is added here either,
-- since Supabase Cron is now the sole scheduler for both jobs).
--
-- Vault, not a literal secret, not a GUC
-- -----------------------------------------------------------------------
-- Supabase's own documented pattern for "pg_cron invoking an
-- authenticated HTTP endpoint" is exactly this: store the credential in
-- Vault, reference it by name from the job's own SQL body. A GUC
-- (`current_setting`) was not used, since Vault is encrypted at rest and
-- access-controlled, while a GUC would be visible to a wider set of
-- inspection surfaces. The Edge Function's own SUPABASE_SERVICE_ROLE_KEY
-- is never touched by this design at all -- it is auto-injected by the
-- Supabase platform into the Edge Function's own runtime and never flows
-- through pg_cron, pg_net, or Vault.
--
-- Verification that nothing else is touched
-- -----------------------------------------------------------------------
-- This migration contains exactly two CREATE EXTENSION statements and two
-- cron.schedule(...) calls. It does not CREATE OR REPLACE any function,
-- does not ALTER any table (including email_outbox), does not touch
-- claim_pending_emails/mark_email_sent/mark_email_failed/enqueue_email/
-- enqueue_pending_order_expiry_reminders's own definitions (all remain
-- exactly as 0083 left them), and does not touch any order/listing/
-- moderation/anonymization RPC.
--
-- Resend Free plan limits (documented per this task's own instruction,
-- not enforced beyond the existing batching already in claim_pending_
-- emails/the Edge Function's own limit=20 default)
-- -----------------------------------------------------------------------
-- Resend's Free plan allows 100 emails/day and 3,000/month. A quota-
-- exceeded response from Resend surfaces as an ordinary provider error
-- (reason: "provider_error") through the exact same, already-established
-- bounded retry/backoff path (mark_email_failed, 5 attempts, exponential
-- backoff) as any other delivery failure -- no new throttling logic is
-- added here, matching this task's explicit instruction not to implement
-- artificial throttling yet.
--
-- Extension schema placement -- empirically determined live, not guessed
-- -----------------------------------------------------------------------
-- An explicit `WITH SCHEMA cron` / `WITH SCHEMA net` was tried first and
-- failed two different ways when applied live: pg_cron's own install
-- script unconditionally creates its schema itself and errors if that
-- schema already exists as a plain (non-extension-owned) schema
-- ("schema \"cron\" already exists" / "42P06"); pg_net's install requires
-- the same ("schema net is not a member of extension \"pg_net\"" /
-- "55000") when a plain schema was pre-created for it instead. Both
-- extensions install cleanly with NO explicit SCHEMA clause at all,
-- letting each extension's own install script create and own its target
-- schema (`cron` and `net` respectively) itself -- confirmed live
-- afterward: cron.job and net.http_post both resolve correctly under
-- those exact schema-qualified names, which is what both cron.schedule()
-- calls below rely on.

-- ============================================================
-- extensions
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- hourly expiry-reminder scan: direct SQL function call, no HTTP, no
-- secret of any kind. cron.schedule upserts by job name, so re-running
-- this against an existing job name is idempotent.
-- ============================================================
select cron.schedule(
  'order-expiry-reminders-hourly',
  '0 * * * *',
  $$select public.enqueue_pending_order_expiry_reminders(200);$$
);

-- ============================================================
-- every-15-minutes email processor: net.http_post to the
-- process-email-outbox Edge Function, authenticated via a custom
-- x-cron-secret header whose value is resolved from Supabase Vault at
-- run time (never embedded here). timeout_milliseconds gives the Edge
-- Function's cold start plus a small claimed batch enough time to
-- respond; pg_net requests are asynchronous regardless, so this does not
-- block the cron worker.
-- ============================================================
select cron.schedule(
  'process-email-outbox-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ylhfbqcyxjmxrbpkxtgu.supabase.co/functions/v1/process-email-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_processor_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);
