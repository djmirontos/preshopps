-- Transactional Email Notification system (MVP), per PRD 21.2/21.5/21.7/
-- 23.2/35.3/42 and ARCHITECTURE 3.4/19 ("Domain action -> database mutation
-- succeeds -> create in-app notification -> enqueue/send transactional
-- email server-side"). This migration creates ONLY a durable outbox table
-- and its trusted SECURITY DEFINER helper functions, then wires a single
-- `perform public.enqueue_email(...)` call into each of the five existing
-- RPCs that already own the seven canonical email events, immediately next
-- to that RPC's own existing in-app notification insert (or, for the two
-- moderation RPCs, which have no in-app notification insert of their own
-- today, as an independent addition -- see the moderation section below).
-- No other business logic in any of these five functions is touched: same
-- signatures, same SECURITY DEFINER, same search_path, same validation,
-- same status transitions, same reservations, same history rows, same
-- Trusted Seller hooks, same return shapes, same grants.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0082_harden_anonymized_account_mutations
-- (confirmed live, no drift). All five touched functions
-- (submit_cart_order, accept_order_items, cancel_accepted_order,
-- apply_user_restriction, lift_user_restriction) were re-fetched via live
-- pg_get_functiondef immediately before writing this migration -- every
-- diff below is against that confirmed live body. pg_cron/pg_net are
-- confirmed NOT installed in this project (list_extensions,
-- installed_version null for both) -- 0024's own already-approved MVP
-- direction ("an external scheduler... invoking [a SQL function]
-- approximately hourly through a thin server-side route authenticated
-- with service-role credentials") is reused verbatim for both the
-- reminder scan and the email processor, rather than silently introducing
-- pg_cron. Resend is ARCHITECTURE.md 3.4's own named "recommended initial
-- implementation" -- used as-is, not chosen freshly. No RESEND_API_KEY
-- exists in this environment; see this task's own explicit instruction
-- that database enqueueing/processor code may be fully deployed while
-- actual provider delivery stays disabled pending real credentials --
-- reported plainly in the accompanying report, not silently glossed over.
--
-- Canonical MVP email events (task's own numbered list, cross-checked
-- against PRD 21.2/21.5/21.7/23.2/35.3/42 -- nothing invented beyond it)
-- -----------------------------------------------------------------------
--   1. new_order_request               -> seller   (submit_cart_order)
--   2. order_accepted                  -> buyer    (accept_order_items)
--   3. order_declined                  -> buyer    (accept_order_items)
--   4. order_partial_acceptance        -> buyer    (accept_order_items)
--   5. order_expiration_reminder       -> seller   (new scan function)
--   6. order_seller_cancelled          -> buyer    (cancel_accepted_order)
--   7. moderation_restriction_applied  -> target   (apply_user_restriction)
--      moderation_restriction_lifted   -> target   (lift_user_restriction)
-- PRD 42 reads "when admin takes an action affecting a user" without
-- restricting itself to negative actions, so lifting a restriction is
-- split into its own event rather than reusing the same event_type as
-- applying one -- both target the same restriction row, and collapsing
-- them under one event_type would make the idempotency key below
-- (event_type, entity_id, recipient_user_id) silently suppress the second,
-- opposite-direction email for that same row. This is a naming refinement
-- of canonical event #7, not an invented eighth event.
-- Deliberately NOT implemented here: PRD 35.3's "important unread
-- messaging summary" -- this task's own canonical event list (1-7) omits
-- it, and this task's own instruction says it "is a separate follow-up
-- unless canon requires it for initial launch." It is canon-listed but
-- explicitly deferred by this task's own scope; reported as a known
-- deviation from PRD 35.3's full list, not a silent omission.
--
-- Why an outbox table, not a direct provider call inside these RPCs
-- -----------------------------------------------------------------------
-- This task's own explicit instruction: "EMAIL FAILURE MUST NEVER ROLL
-- BACK A VALID ORDER/MODERATION ACTION." A direct HTTP call to Resend
-- from inside a Postgres PL/pgSQL transaction is not possible without the
-- `http`/`pg_net` extensions making a network call as part of the SQL
-- transaction itself -- coupling an external, fallible network call's
-- success to whether the order/restriction mutation commits. The outbox
-- table decouples them completely: enqueueing is a plain, always-
-- succeeding local INSERT in the same transaction as the business
-- mutation (so it can never itself cause a rollback under normal
-- operation), and actual delivery happens later, out-of-transaction, from
-- trusted application code that can fail and retry independently.
--
-- enqueue_email: the single, centralized enqueue path
-- -----------------------------------------------------------------------
-- Called internally (never granted to anon/authenticated/public) from
-- each of the five business RPCs, always as a `perform`, so its own return
-- value can never influence the caller's control flow or error state.
-- Resolves the recipient's current profiles.deleted_at at the moment of
-- the call and silently no-ops (never raises) for a missing or anonymized
-- profile -- "Do not enqueue/send new transactional email to accounts
-- where profiles.deleted_at IS NOT NULL," checked fresh here rather than
-- trusted from the caller, since a caller's own deleted_at guard (where
-- one exists) checks the CALLER's own profile, not necessarily the
-- RECIPIENT's -- these are different people in every one of the five call
-- sites (seller receiving a buyer's order event, buyer receiving a
-- seller's event, or a moderation target who is not the admin caller at
-- all). Idempotency is enforced by a single unique constraint on
-- (event_type, entity_id, recipient_user_id) via ON CONFLICT DO NOTHING --
-- never an exception, so a legitimate duplicate call (for example a retried
-- client request that reaches an already-idempotent RPC branch) never
-- disrupts the caller's own transaction. Because every event_type in this
-- schema's actual state machine can only genuinely occur once for a given
-- (order or restriction) row -- an order accepts/declines/partially-
-- accepts at most once each, a given restriction row is applied once and
-- lifted at most once -- this key does not need a separate occurrence/
-- version column to satisfy "do not prevent legitimate repeated future
-- events merely because the same order id is reused across different
-- transitions": a later, different event_type against that same order_id
-- (for example order_seller_cancelled after order_accepted) is a distinct
-- key and is never blocked by this constraint.
--
-- Anonymized accounts: enqueue-time AND claim-time re-checks
-- -----------------------------------------------------------------------
-- enqueue_email's own check handles "never enqueue for an already-
-- anonymized account." "Existing queued email for an account anonymized
-- before delivery should be skipped/cancelled safely" is handled by
-- claim_pending_emails re-resolving the SAME profiles.deleted_at check at
-- claim time, immediately before a row would ever be handed to the
-- application-layer processor for actual sending -- a row claimed for an
-- account anonymized in the gap between enqueue and processing is marked
-- 'cancelled' directly, never returned to the caller, and the provider is
-- never invoked for it. No separate cleanup/reaper job is needed for this
-- case: it is caught inline on the very next claim attempt.
--
-- claim_pending_emails / mark_email_sent / mark_email_failed: the
-- claim/send/finalize split
-- -----------------------------------------------------------------------
-- Actually sending an email requires an outbound HTTPS call to Resend,
-- which can only happen from trusted Node/Vercel application code, never
-- from a Postgres function -- so "claim" (atomic, safe under concurrency,
-- entirely in SQL) is a deliberately separate step from "send" (the one
-- part of this whole system that must run outside the database) and
-- "finalize" (also SQL, atomic). claim_pending_emails selects rows that
-- are either due ('pending' with next_attempt_at <= now()) or abandoned
-- ('processing' with claimed_at older than 5 minutes -- a crashed or
-- killed processor invocation's claim, recovered automatically on the
-- next run, per this task's own "design recovery for stale claims"
-- instruction; no separate reaper job exists or is needed), locks them
-- FOR UPDATE SKIP LOCKED (the identical job-queue pattern
-- expire_pending_orders, 0024, already established in this schema),
-- marks each 'processing' with a fresh claimed_at and an incremented
-- attempt_count, and returns the resolved recipient email (joined from
-- auth.users, the same already-established pattern 0065/0078 use) --
-- never persisting that email address into the table itself, satisfying
-- "prefer resolving the recipient email server-side... when enqueuing or
-- sending" in its stronger form (resolved fresh, not cached) and keeping
-- the outbox's own permanent storage free of email-address PII. Two
-- concurrent processor invocations calling claim_pending_emails at the
-- same moment can never claim the same row (SKIP LOCKED plus the atomic
-- UPDATE happening inside the same statement's row lock), so double-
-- sending is structurally prevented, not merely discouraged.
-- mark_email_sent only ever transitions a row it finds still in
-- 'processing' (a WHERE guard, not an exception) -- so a duplicate or
-- late-arriving finalize call is a safe no-op, never a corrupting double-
-- write. mark_email_failed uses a small bounded strategy: attempt_count
-- capped at 5 total attempts (matching this task's own "small bounded
-- strategy... no infinite hot loop" instruction), with exponential
-- backoff (2, 4, 8, 16, 32 minutes) between retries via next_attempt_at,
-- and a genuinely terminal 'failed' status once attempts are exhausted --
-- a permanently failed row is never retried again automatically, but
-- remains inspectable (last_error, attempt_count) for manual diagnosis,
-- satisfying "log visibility needed to diagnose failures" without any
-- dashboard.
--
-- enqueue_pending_order_expiry_reminders: the ~24h-before-72h reminder
-- -----------------------------------------------------------------------
-- PRD 21.7's own window (created_at between 48 and 72 hours old, status
-- still 'pending') is read-only here -- this function never mutates
-- public.orders at all, unlike expire_pending_orders, so it deliberately
-- takes NO row lock on orders (a lock would only be useful to avoid
-- redundant work, at the cost of unnecessary contention against
-- accept_order_items/cancel_pending_order's own FOR UPDATE locks on the
-- identical rows, for zero correctness benefit). "Reminder sent at most
-- once per order" and "no duplicate reminders across repeated scheduler
-- runs" are both satisfied entirely by enqueue_email's own unique
-- constraint, not by any new column on orders or any state tracked by
-- this function itself -- every hourly invocation re-scans the same
-- ~24-hour-wide eligibility window (so a single missed run never causes a
-- missed reminder), and the SECOND and later invocations that see the
-- same still-pending order simply hit ON CONFLICT DO NOTHING inside
-- enqueue_email and enqueue nothing new. "No reminder if order already
-- left pending" is satisfied by the `status = 'pending'` predicate itself
-- -- an accepted/declined/cancelled/expired order structurally falls out
-- of eligibility on the very next scan, exactly like expire_pending_orders'
-- own established idempotency reasoning.
--
-- Table/RLS: additive only, matching the established "RLS enabled, zero
-- policies, SECURITY DEFINER-only access" convention
-- -----------------------------------------------------------------------
-- public.email_outbox is created with RLS explicitly enabled and zero
-- policies (confirmed live: moderation_actions/reports/user_restrictions/
-- admin_audit_logs/notifications all already have relrowsecurity = true
-- in this project) -- ordinary authenticated users get zero rows via
-- PostgREST under any circumstance, matching "ordinary users cannot
-- read/write it." Every function that touches this table is REVOKEd from
-- public/anon/authenticated and GRANTed only to service_role (or, for
-- enqueue_email specifically, granted to no role at all beyond the
-- functions that call it internally as the same SECURITY DEFINER owner --
-- identical to recalculate_trusted_seller's own established pattern,
-- 0065) -- no email body or recipient id is ever reachable through any
-- client-facing RPC. No table/enum/column already in this schema is
-- altered.
--
-- What is genuinely NOT included in this migration (reported plainly, not
-- silently omitted)
-- -----------------------------------------------------------------------
-- No application-layer processor code, no Vercel route handlers, no
-- vercel.json cron config, and no Resend SDK wiring live inside this SQL
-- migration -- those are separate, non-database files reported in the
-- same task's final report. No admin UI/dashboard for email_outbox is
-- created (explicitly out of scope). No unread-message-summary email
-- (PRD 35.3, explicitly deferred per this task's own instruction). No
-- change to expire_pending_orders (0024) itself -- the reminder scan is a
-- new, independent function, not a modification of that one.

-- ============================================================
-- enums
-- ============================================================
create type public.email_event_type_enum as enum (
  'new_order_request',
  'order_accepted',
  'order_declined',
  'order_partial_acceptance',
  'order_expiration_reminder',
  'order_seller_cancelled',
  'moderation_restriction_applied',
  'moderation_restriction_lifted'
);

create type public.email_outbox_status_enum as enum (
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled'
);

-- ============================================================
-- email_outbox
-- ============================================================
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type public.email_event_type_enum not null,
  entity_id uuid not null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status public.email_outbox_status_enum not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  constraint email_outbox_attempt_count_non_negative_check check (attempt_count >= 0),
  constraint email_outbox_event_entity_recipient_key unique (event_type, entity_id, recipient_user_id)
);

create index email_outbox_claimable_idx
  on public.email_outbox (status, next_attempt_at);

alter table public.email_outbox enable row level security;
-- No policies: ordinary authenticated users get zero rows via PostgREST
-- under any circumstance. All access is through the SECURITY DEFINER
-- functions below, granted only to service_role (enqueue_email is not
-- even granted to service_role -- see its own header below).

-- ============================================================
-- enqueue_email: the single, centralized, internal-only enqueue path.
-- Never granted to anon/authenticated/public/service_role -- called only
-- as `perform public.enqueue_email(...)` from other SECURITY DEFINER
-- functions owned by this same role, which already run as that owner
-- regardless of enqueue_email's own grants (identical to
-- recalculate_trusted_seller's own established pattern, 0065).
-- ============================================================
create or replace function public.enqueue_email(
  p_event_type public.email_event_type_enum,
  p_recipient_user_id uuid,
  p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_at timestamptz;
begin
  if p_recipient_user_id is null or p_entity_id is null or p_event_type is null then
    return;
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = p_recipient_user_id;

  if not found or v_deleted_at is not null then
    return;
  end if;

  insert into public.email_outbox (event_type, entity_id, recipient_user_id, payload)
    values (p_event_type, p_entity_id, p_recipient_user_id, coalesce(p_payload, '{}'::jsonb))
  on conflict on constraint email_outbox_event_entity_recipient_key do nothing;
end;
$$;

revoke all on function public.enqueue_email(public.email_event_type_enum, uuid, uuid, jsonb) from public;
revoke all on function public.enqueue_email(public.email_event_type_enum, uuid, uuid, jsonb) from anon;
revoke all on function public.enqueue_email(public.email_event_type_enum, uuid, uuid, jsonb) from authenticated;
revoke all on function public.enqueue_email(public.email_event_type_enum, uuid, uuid, jsonb) from service_role;

-- ============================================================
-- claim_pending_emails: service_role-only. Atomically claims up to
-- p_limit due/stale rows and returns each with a freshly-resolved
-- recipient email (never persisted to the table). A row whose recipient
-- is missing or anonymized at claim time is cancelled directly and never
-- returned.
-- ============================================================
create or replace function public.claim_pending_emails(
  p_limit integer default 20
)
returns table (
  id uuid,
  event_type public.email_event_type_enum,
  entity_id uuid,
  recipient_user_id uuid,
  recipient_email text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_stale_before timestamptz := v_now - interval '5 minutes';
  v_deleted_at timestamptz;
  v_email text;
  r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Batch limit must be between 1 and 100.' using detail = 'INVALID_BATCH_LIMIT';
  end if;

  for r in
    select eo.id, eo.event_type, eo.entity_id, eo.recipient_user_id, eo.payload, eo.attempt_count
      from public.email_outbox eo
      where (eo.status = 'pending' and eo.next_attempt_at <= v_now)
         or (eo.status = 'processing' and eo.claimed_at < v_stale_before)
      order by eo.next_attempt_at asc, eo.created_at asc
      for update skip locked
      limit p_limit
  loop
    select p.deleted_at, u.email into v_deleted_at, v_email
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.id = r.recipient_user_id;

    if not found or v_deleted_at is not null or v_email is null then
      update public.email_outbox as eo
        set status = 'cancelled',
            last_error = 'Recipient account is anonymized or missing.'
        where eo.id = r.id;
      continue;
    end if;

    update public.email_outbox as eo
      set status = 'processing',
          claimed_at = v_now,
          attempt_count = r.attempt_count + 1
      where eo.id = r.id;

    id := r.id;
    event_type := r.event_type;
    entity_id := r.entity_id;
    recipient_user_id := r.recipient_user_id;
    recipient_email := v_email;
    payload := r.payload;
    attempt_count := r.attempt_count + 1;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.claim_pending_emails(integer) from public;
revoke all on function public.claim_pending_emails(integer) from anon;
revoke all on function public.claim_pending_emails(integer) from authenticated;
grant execute on function public.claim_pending_emails(integer) to service_role;

-- ============================================================
-- mark_email_sent: service_role-only. Only transitions a row still in
-- 'processing' -- a WHERE guard, not an exception, so a duplicate or
-- late finalize call is a safe no-op.
-- ============================================================
create or replace function public.mark_email_sent(
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_outbox
    set status = 'sent',
        sent_at = now(),
        last_error = null
    where id = p_id and status = 'processing';
end;
$$;

revoke all on function public.mark_email_sent(uuid) from public;
revoke all on function public.mark_email_sent(uuid) from anon;
revoke all on function public.mark_email_sent(uuid) from authenticated;
grant execute on function public.mark_email_sent(uuid) to service_role;

-- ============================================================
-- mark_email_failed: service_role-only. Bounded retry: up to 5 total
-- attempts, exponential backoff (2/4/8/16/32 minutes) between retries,
-- terminal 'failed' status once exhausted. Only acts on a row still in
-- 'processing' -- a WHERE guard, not an exception.
-- ============================================================
create or replace function public.mark_email_failed(
  p_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_count integer;
  v_max_attempts constant integer := 5;
  v_backoff_minutes integer;
  v_error text;
begin
  v_error := left(coalesce(nullif(btrim(p_error), ''), 'Unknown error.'), 2000);

  select attempt_count into v_attempt_count
    from public.email_outbox
    where id = p_id and status = 'processing'
    for update;

  if not found then
    return;
  end if;

  if v_attempt_count >= v_max_attempts then
    update public.email_outbox
      set status = 'failed',
          last_error = v_error
      where id = p_id;
  else
    v_backoff_minutes := power(2, v_attempt_count)::integer;
    update public.email_outbox
      set status = 'pending',
          next_attempt_at = now() + (v_backoff_minutes || ' minutes')::interval,
          last_error = v_error
      where id = p_id;
  end if;
end;
$$;

revoke all on function public.mark_email_failed(uuid, text) from public;
revoke all on function public.mark_email_failed(uuid, text) from anon;
revoke all on function public.mark_email_failed(uuid, text) from authenticated;
grant execute on function public.mark_email_failed(uuid, text) to service_role;

-- ============================================================
-- enqueue_pending_order_expiry_reminders: service_role-only, system-only
-- scan (no auth.uid(), same as expire_pending_orders). Read-only against
-- public.orders -- see this migration's own header for why no row lock is
-- taken here.
-- ============================================================
create or replace function public.enqueue_pending_order_expiry_reminders(
  p_limit integer default 200
)
returns table (
  order_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_shop_owner_id uuid;
  r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Batch limit must be between 1 and 1000.' using detail = 'INVALID_BATCH_LIMIT';
  end if;

  for r in
    select o.id, o.public_code, o.shop_id
      from public.orders o
      where o.status = 'pending'
        and o.created_at <= v_now - interval '48 hours'
        and o.created_at > v_now - interval '72 hours'
      order by o.created_at, o.id
      limit p_limit
  loop
    select s.owner_id into v_shop_owner_id
      from public.shops s
      where s.id = r.shop_id;

    perform public.enqueue_email(
      'order_expiration_reminder'::public.email_event_type_enum,
      v_shop_owner_id,
      r.id,
      jsonb_build_object('order_public_code', r.public_code)
    );

    order_id := r.id;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.enqueue_pending_order_expiry_reminders(integer) from public;
revoke all on function public.enqueue_pending_order_expiry_reminders(integer) from anon;
revoke all on function public.enqueue_pending_order_expiry_reminders(integer) from authenticated;
grant execute on function public.enqueue_pending_order_expiry_reminders(integer) to service_role;

-- ============================================================
-- submit_cart_order: adds one `perform public.enqueue_email(...)` call
-- immediately after the existing per-shop 'order_request_received'
-- in-app notification insert, inside the same per-shop loop. Nothing
-- else in this function is changed.
-- ============================================================
create or replace function public.submit_cart_order(p_cart_item_ids uuid[], p_fulfillment_choices jsonb, p_buyer_note text default null::text)
returns table(order_id uuid, shop_id uuid, order_public_code text, item_count integer, total_cents bigint, status order_status_enum)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
  v_buyer_note text;
  v_constraint_name text;
  v_public_code text;
  v_new_order_id uuid;
  v_attempt integer;
  v_shop_owner_id uuid;
  r record;
begin
  -- ===================== auth =====================
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== active buyer profile =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== buyer restrictions =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'Account is currently restricted.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== structural validation of selected ids =====================
  if p_cart_item_ids is null or coalesce(array_length(p_cart_item_ids, 1), 0) = 0 then
    raise exception 'At least one cart item must be selected.' using detail = 'SUBMISSION_INVALID';
  end if;

  if exists (select 1 from unnest(p_cart_item_ids) x where x is null) then
    raise exception 'Selected cart item ids may not be null.' using detail = 'SUBMISSION_INVALID';
  end if;

  if (select count(*) from unnest(p_cart_item_ids)) <> (select count(distinct x) from unnest(p_cart_item_ids) x) then
    raise exception 'Duplicate cart item ids are not allowed.' using detail = 'SUBMISSION_INVALID';
  end if;

  -- ===================== materialize selected rows with live state =====================
  drop table if exists pg_temp.tmp_submit_items;
  create temporary table tmp_submit_items (
    cart_item_id uuid primary key,
    listing_id uuid not null,
    shop_id uuid not null,
    shop_owner_id uuid not null,
    shop_name text not null,
    quantity integer not null,
    cart_price_snapshot bigint not null,
    current_price bigint not null,
    available_quantity integer not null,
    listing_title text not null,
    listing_public_code text not null,
    cover_image_path text,
    is_orderable boolean not null,
    is_blocked boolean not null,
    matched_order_id uuid
  ) on commit drop;

  insert into tmp_submit_items (
    cart_item_id, listing_id, shop_id, shop_owner_id, shop_name, quantity,
    cart_price_snapshot, current_price, available_quantity, listing_title,
    listing_public_code, cover_image_path, is_orderable, is_blocked
  )
  select
    ci.id,
    l.id,
    s.id,
    s.owner_id,
    s.name,
    ci.quantity,
    ci.price_cents_snapshot,
    l.price_cents,
    l.available_quantity,
    l.title,
    l.public_code,
    img.storage_path,
    (
      l.status = 'available'
      and cat.is_inquiry_only = false
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      )
    ),
    exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = v_caller_id and ub.blocked_id = s.owner_id)
         or (ub.blocker_id = s.owner_id and ub.blocked_id = v_caller_id)
    )
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    join public.listings l on l.id = ci.listing_id
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    left join public.listing_images img on img.id = l.cover_image_id
    where c.user_id = v_caller_id
      and ci.id = any(p_cart_item_ids);

  -- ===================== ownership/existence: every id must have matched =====================
  if (select count(*) from tmp_submit_items) <> (select count(distinct x) from unnest(p_cart_item_ids) x) then
    raise exception 'One or more selected cart items were not found.' using detail = 'CART_ITEM_NOT_FOUND';
  end if;

  -- ===================== listing eligibility (generic, non-revealing) =====================
  if exists (select 1 from tmp_submit_items t where not t.is_orderable) then
    raise exception 'One or more selected listings cannot be ordered.' using detail = 'LISTING_NOT_ORDERABLE';
  end if;

  -- ===================== own shop =====================
  if exists (select 1 from tmp_submit_items t where t.shop_owner_id = v_caller_id) then
    raise exception 'You cannot buy your own listing.' using detail = 'CANNOT_BUY_OWN_LISTING';
  end if;

  -- ===================== peer block =====================
  if exists (select 1 from tmp_submit_items t where t.is_blocked) then
    raise exception 'Interaction is blocked.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== quantity vs live availability (fail closed) =====================
  if exists (select 1 from tmp_submit_items t where t.quantity < 1 or t.quantity > t.available_quantity) then
    raise exception 'Requested quantity exceeds available stock.' using detail = 'QUANTITY_UNAVAILABLE';
  end if;

  -- ===================== price drift =====================
  if exists (select 1 from tmp_submit_items t where t.current_price <> t.cart_price_snapshot) then
    raise exception 'Price has changed since this item was added to cart.' using detail = 'PRICE_CHANGED';
  end if;

  -- ===================== buyer note normalization =====================
  v_buyer_note := nullif(btrim(p_buyer_note), '');
  if v_buyer_note is not null and char_length(v_buyer_note) > 1000 then
    raise exception 'Buyer note is too long.' using detail = 'SUBMISSION_INVALID';
  end if;

  -- ===================== fulfillment payload: structural, cast-safe validation =====================
  if p_fulfillment_choices is null or jsonb_typeof(p_fulfillment_choices) <> 'array' then
    raise exception 'Fulfillment choices must be a JSON array.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fulfillment_choices) as elem
    where jsonb_typeof(elem) <> 'object'
       or not (elem ? 'shop_id')
       or jsonb_typeof(elem -> 'shop_id') <> 'string'
       or (elem ->> 'shop_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not (elem ? 'method')
       or jsonb_typeof(elem -> 'method') <> 'string'
       or (elem ->> 'method') not in ('meetup', 'pickup', 'local_delivery', 'shipping')
  ) then
    raise exception 'Fulfillment choices contain an invalid entry.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if (select count(*) from jsonb_array_elements(p_fulfillment_choices)) <>
     (select count(distinct (elem ->> 'shop_id')) from jsonb_array_elements(p_fulfillment_choices) elem) then
    raise exception 'Duplicate fulfillment choice for the same shop.' using detail = 'FULFILLMENT_INVALID';
  end if;

  drop table if exists pg_temp.tmp_submit_shops;
  create temporary table tmp_submit_shops (
    shop_id uuid primary key,
    method public.fulfillment_method_enum not null,
    matched_order_id uuid,
    public_code text
  ) on commit drop;

  insert into tmp_submit_shops (shop_id, method)
  select (elem ->> 'shop_id')::uuid, (elem ->> 'method')::public.fulfillment_method_enum
    from jsonb_array_elements(p_fulfillment_choices) as elem;

  -- ===================== exact shop-set match =====================
  if exists (
    select 1 from tmp_submit_items t
    where not exists (select 1 from tmp_submit_shops f where f.shop_id = t.shop_id)
  ) then
    raise exception 'Missing fulfillment choice for a selected shop.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if exists (
    select 1 from tmp_submit_shops f
    where not exists (select 1 from tmp_submit_items t where t.shop_id = f.shop_id)
  ) then
    raise exception 'Fulfillment choice given for a shop not in the selection.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== per-shop listing compatibility =====================
  if exists (
    select 1
    from tmp_submit_items t
    join tmp_submit_shops f on f.shop_id = t.shop_id
    where not exists (
      select 1 from public.listing_fulfillment_methods lfm
      where lfm.listing_id = t.listing_id and lfm.method = f.method
    )
  ) then
    raise exception 'A selected listing does not support the chosen fulfillment method.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== all validation passed: create one order per shop =====================
  for r in select f.shop_id, f.method from tmp_submit_shops f loop
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_public_code := 'PSO-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
      begin
        insert into public.orders (public_code, buyer_id, shop_id, status, fulfillment_method, buyer_note)
        values (v_public_code, v_caller_id, r.shop_id, 'pending', r.method, v_buyer_note)
        returning id into v_new_order_id;
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name = 'orders_public_code_key' then
          if v_attempt >= 5 then
            raise exception 'Unable to generate a unique order code.' using detail = 'SUBMISSION_INVALID';
          end if;
        else
          raise;
        end if;
      end;
    end loop;

    -- ===================== notification: seller receives one per created order =====================
    select s.owner_id into v_shop_owner_id
      from public.shops s
      where s.id = r.shop_id;

    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select v_shop_owner_id, 'order_request_received', v_caller_id, v_new_order_id, v_new_order_id::text
    where not exists (
      select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

    -- ===================== email: seller receives the new order request =====================
    perform public.enqueue_email(
      'new_order_request'::public.email_event_type_enum,
      v_shop_owner_id,
      v_new_order_id,
      jsonb_build_object('order_public_code', v_public_code)
    );

    update tmp_submit_shops set matched_order_id = v_new_order_id, public_code = v_public_code
      where tmp_submit_shops.shop_id = r.shop_id;
    update tmp_submit_items set matched_order_id = v_new_order_id
      where tmp_submit_items.shop_id = r.shop_id;
  end loop;

  -- ===================== order items: exactly one per selected cart item =====================
  insert into public.order_items (
    order_id, shop_id, listing_id, status, quantity,
    listing_title_snapshot, listing_public_code_snapshot, price_cents_snapshot,
    shop_name_snapshot, listing_cover_image_snapshot_path
  )
  select
    t.matched_order_id, t.shop_id, t.listing_id, 'pending', t.quantity,
    t.listing_title, t.listing_public_code, t.current_price,
    t.shop_name, t.cover_image_path
    from tmp_submit_items t;

  -- ===================== cart cleanup: only the selected, now-submitted rows =====================
  delete from public.cart_items ci
    where ci.id = any(p_cart_item_ids);

  -- ===================== one row per created order, deterministic order =====================
  return query
    select
      f.matched_order_id as order_id,
      f.shop_id,
      f.public_code as order_public_code,
      agg.item_count,
      agg.total_cents,
      'pending'::public.order_status_enum as status
    from tmp_submit_shops f
    join lateral (
      select count(*)::integer as item_count,
             sum(t.current_price * t.quantity)::bigint as total_cents
      from tmp_submit_items t
      where t.shop_id = f.shop_id
    ) agg on true
    order by f.shop_id;
end;
$$;

revoke all on function public.submit_cart_order(uuid[], jsonb, text) from public;
revoke all on function public.submit_cart_order(uuid[], jsonb, text) from anon;
grant execute on function public.submit_cart_order(uuid[], jsonb, text) to authenticated;

-- ============================================================
-- accept_order_items: adds one `perform public.enqueue_email(...)` call
-- immediately after the existing outcome-specific 'order_accepted' /
-- 'order_declined' / 'order_changes_pending' in-app notification insert,
-- mapping each outcome to its corresponding email event type. Nothing
-- else in this function is changed.
-- ============================================================
create or replace function public.accept_order_items(p_order_id uuid, p_accepted_item_ids uuid[], p_declined_item_ids uuid[])
returns table (order_id uuid, order_status public.order_status_enum, was_already_processed boolean, accepted_item_ids uuid[], declined_item_ids uuid[], stock_conflict_item_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;

  v_accepted_ids uuid[];
  v_declined_ids uuid[];
  v_all_decided_ids uuid[];
  v_pending_ids uuid[];
  v_bad_ids uuid[];
  v_missing_ids uuid[];

  v_stock_conflict_ids uuid[] := '{}';
  v_final_accepted_ids uuid[];
  v_final_declined_ids uuid[];
  v_conflict_batch uuid[];

  v_ok_listing_ids uuid[] := '{}';
  v_ok_listing_qty integer[] := '{}';
  v_ok_listing_new_reserved integer[] := '{}';
  v_ok_listing_new_available integer[] := '{}';
  v_ok_listing_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_avail_qty integer;
  v_listing_status public.listing_status_enum;

  v_accepted_count integer;
  v_total_count integer;
  v_outcome_status public.order_status_enum;
  v_note text;
  v_order_public_code text;

  v_derived_accepted uuid[];
  v_derived_declined uuid[];

  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.buyer_id
    into v_order_status, v_order_shop_id, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: only a pending order may be processed =====================
  if v_order_status <> 'pending' then
    select coalesce(array_agg(oi.id) filter (where oi.status = 'accepted'), '{}'),
           coalesce(array_agg(oi.id) filter (where oi.status = 'declined'), '{}')
      into v_derived_accepted, v_derived_declined
      from public.order_items oi
      where oi.order_id = p_order_id;

    return query
      select p_order_id, v_order_status, true, v_derived_accepted, v_derived_declined, '{}'::uuid[];
    return;
  end if;

  -- ===================== normalize input =====================
  v_accepted_ids := coalesce(p_accepted_item_ids, '{}');
  v_declined_ids := coalesce(p_declined_item_ids, '{}');

  if exists (select 1 from unnest(v_accepted_ids) u where u is null)
     or exists (select 1 from unnest(v_declined_ids) u where u is null) then
    raise exception 'Item decision arrays may not contain a null item id.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- duplicate ids within either array, or the same id in both arrays
  if (select count(*) from unnest(v_accepted_ids)) <> (select count(distinct u) from unnest(v_accepted_ids) u)
     or (select count(*) from unnest(v_declined_ids)) <> (select count(distinct u) from unnest(v_declined_ids) u)
     or exists (
       select 1 from unnest(v_accepted_ids) a join unnest(v_declined_ids) d on a = d
     ) then
    raise exception 'Duplicate or overlapping item decisions are not allowed.' using detail = 'DUPLICATE_ITEM_DECISION';
  end if;

  v_all_decided_ids := v_accepted_ids || v_declined_ids;

  -- ===================== lock this order's order_items rows =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  select coalesce(array_agg(oi.id order by oi.id), '{}') into v_pending_ids
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'pending';

  v_total_count := coalesce(array_length(v_pending_ids, 1), 0);
  if v_total_count = 0 then
    raise exception 'Order has no pending items to decide.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- every decided id must belong to this order
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    where not exists (
      select 1 from public.order_items oi where oi.id = x and oi.order_id = p_order_id
    );
  if v_bad_ids is not null then
    raise exception 'One or more item IDs do not belong to this order.' using detail = 'ITEM_NOT_IN_ORDER';
  end if;

  -- every decided id must currently be pending
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    join public.order_items oi on oi.id = x and oi.order_id = p_order_id
    where oi.status <> 'pending';
  if v_bad_ids is not null then
    raise exception 'One or more items have already been decided.' using detail = 'ITEM_ALREADY_DECIDED';
  end if;

  -- every pending item must receive an explicit decision (completeness rule)
  select array_agg(x) into v_missing_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_all_decided_ids));
  if v_missing_ids is not null then
    raise exception 'Every pending item must receive an explicit decision.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- ===================== stock-conflict items with a NULL listing_id =====================
  select array_agg(oi.id) into v_conflict_batch
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and oi.listing_id is null;
  if v_conflict_batch is not null then
    v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
  end if;

  -- ===================== lock referenced listings in deterministic order, classify =====================
  for v_listing_id, v_agg_qty in
    select oi.listing_id, sum(oi.quantity)::integer
      from public.order_items oi
      where oi.id = any(v_accepted_ids) and oi.listing_id is not null
      group by oi.listing_id
      order by oi.listing_id
  loop
    select l.stock_quantity, l.reserved_quantity, l.available_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_avail_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_id
      for update;

    if not found
       or v_listing_status in ('draft', 'archived', 'sold')
       or v_avail_qty < v_agg_qty then
      select array_agg(oi.id) into v_conflict_batch
        from public.order_items oi
        where oi.id = any(v_accepted_ids) and oi.listing_id = v_listing_id;
      v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
      continue;
    end if;

    v_ok_listing_ids := v_ok_listing_ids || v_listing_id;
    v_ok_listing_qty := v_ok_listing_qty || v_agg_qty;
    v_ok_listing_new_reserved := v_ok_listing_new_reserved || (v_reserved_qty + v_agg_qty);
    v_ok_listing_new_available := v_ok_listing_new_available || (v_avail_qty - v_agg_qty);
    v_ok_listing_status := v_ok_listing_status || v_listing_status;
  end loop;

  -- ===================== final item classification =====================
  select coalesce(array_agg(oi.id), '{}') into v_final_accepted_ids
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and not (oi.id = any(v_stock_conflict_ids));

  select coalesce(array_agg(x), '{}') into v_final_declined_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_final_accepted_ids));

  v_accepted_count := coalesce(array_length(v_final_accepted_ids, 1), 0);

  if v_accepted_count = v_total_count then
    v_outcome_status := 'accepted';
  elsif v_accepted_count = 0 then
    v_outcome_status := 'declined';
  else
    v_outcome_status := 'changes_pending';
  end if;

  v_note := case
    when coalesce(array_length(v_stock_conflict_ids, 1), 0) > 0
      then format('%s item(s) auto-declined due to insufficient stock or an unavailable listing.', array_length(v_stock_conflict_ids, 1))
    else null
  end;

  -- ===================== item status writes (all outcomes) =====================
  update public.order_items set status = 'accepted' where id = any(v_final_accepted_ids);
  update public.order_items set status = 'declined' where id = any(v_final_declined_ids);

  -- ===================== outcome-specific mutation =====================
  if v_outcome_status = 'accepted' then
    -- reservations first (the ledger is authoritative), then the cached aggregate
    insert into public.inventory_reservations (listing_id, order_id, order_item_id, shop_id, quantity)
      select oi.listing_id, p_order_id, oi.id, v_order_shop_id, oi.quantity
        from public.order_items oi
        where oi.id = any(v_final_accepted_ids);

    for i in 1 .. coalesce(array_length(v_ok_listing_ids, 1), 0) loop
      update public.listings
        set reserved_quantity = v_ok_listing_new_reserved[i],
            status = case
              when v_ok_listing_new_available[i] = 0 and v_ok_listing_status[i] in ('available', 'reserved')
                then 'reserved'::public.listing_status_enum
              else status
            end
        where id = v_ok_listing_ids[i];
    end loop;
  end if;

  -- (no listing/reservation mutation for 'declined' or 'changes_pending' outcomes)

  -- lifecycle timestamps: accepted_at is set only when this call's resolved
  -- outcome is 'accepted', declined_at only when it is 'declined'; the
  -- 'changes_pending' outcome touches neither (both CASE branches
  -- preserve the column's current value, a no-op for a pending-origin
  -- order where both are already NULL).
  update public.orders
    set status = v_outcome_status,
        accepted_at = case when v_outcome_status = 'accepted' then now() else accepted_at end,
        declined_at = case when v_outcome_status = 'declined' then now() else declined_at end
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'pending', v_outcome_status, v_caller, v_note);

  -- ===================== notification: buyer receives outcome-specific event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select
    v_order_buyer_id,
    case v_outcome_status
      when 'accepted' then 'order_accepted'::public.notification_type_enum
      when 'declined' then 'order_declined'::public.notification_type_enum
      else 'order_changes_pending'::public.notification_type_enum
    end,
    v_caller,
    p_order_id,
    p_order_id::text || ':' || v_outcome_status::text
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  -- ===================== email: buyer receives outcome-specific event =====================
  select o.public_code into v_order_public_code from public.orders o where o.id = p_order_id;

  perform public.enqueue_email(
    case v_outcome_status
      when 'accepted' then 'order_accepted'::public.email_event_type_enum
      when 'declined' then 'order_declined'::public.email_event_type_enum
      else 'order_partial_acceptance'::public.email_event_type_enum
    end,
    v_order_buyer_id,
    p_order_id,
    jsonb_build_object(
      'order_public_code', v_order_public_code,
      'accepted_count', v_accepted_count,
      'declined_count', v_total_count - v_accepted_count
    )
  );

  return query
    select p_order_id, v_outcome_status, false, v_final_accepted_ids, v_final_declined_ids, v_stock_conflict_ids;
end;
$$;

revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from public;
revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from anon;
grant execute on function public.accept_order_items(uuid, uuid[], uuid[]) to authenticated;

-- ============================================================
-- cancel_accepted_order: adds one `perform public.enqueue_email(...)`
-- call immediately after the existing 'order_cancelled' in-app
-- notification insert. Nothing else in this function is changed.
-- ============================================================
create or replace function public.cancel_accepted_order(p_order_id uuid, p_reason text)
returns table (order_id uuid, order_status public.order_status_enum, was_already_cancelled boolean, cancelled_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_existing_cancelled_at timestamptz;
  v_order_buyer_id uuid;
  v_reason text;
  v_req_id uuid;
  v_from_status public.order_status_enum;
  v_order_public_code text;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_available integer[] := '{}';
  v_old_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;

  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.cancelled_at, o.buyer_id
    into v_order_status, v_order_shop_id, v_existing_cancelled_at, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-cancelled is success, zero mutation, origin-agnostic =====================
  if v_order_status = 'cancelled' then
    return query
      select p_order_id, v_order_status, true, v_existing_cancelled_at;
    return;
  end if;

  -- ===================== only accepted/ready orders may be seller-cancelled here =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state that can be directly cancelled.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reason validation (after idempotency/eligibility, before any lock beyond orders) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  v_from_status := v_order_status;

  -- ===================== lock the current pending buyer cancellation request, if any =====================
  select ocr.id into v_req_id
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
    for update;

  -- ===================== lock this order's order_items (their locked status/quantity back the reservation check below) =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  -- ===================== lock this order's active reservations =====================
  perform 1 from public.inventory_reservations ir where ir.order_id = p_order_id and ir.status = 'active' order by ir.id for update;

  -- ===================== reservation/item consistency guard =====================
  -- ownership is already structurally guaranteed by inventory_reservations_order_item_ownership_fkey;
  -- only status and quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = p_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== aggregate release quantity per listing =====================
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = p_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- ===================== lock affected listings in deterministic order, validate, compute resulting values =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing reserved quantity is insufficient to release.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);
    v_new_available := v_new_available || (v_stock_qty - (v_reserved_qty - v_agg_qtys[i]));
    v_old_status := v_old_status || v_listing_status;
  end loop;

  -- ===================== release reservations (the ledger is authoritative, updated before the cached aggregate) =====================
  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = p_order_id and ir.status = 'active';

  -- ===================== update the cached listing aggregates and reopen visibility only where safe =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set reserved_quantity = v_new_reserved[i],
          status = case
            when v_old_status[i] = 'reserved' and v_new_available[i] > 0
              then 'available'::public.listing_status_enum
            else status
          end
      where id = v_listing_ids[i];
  end loop;

  -- ===================== parent order cancellation: status + lifecycle timestamp together, nothing else touched =====================
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  -- ===================== auto-confirm the pending buyer cancellation request, if one existed =====================
  if v_req_id is not null then
    update public.order_cancellation_requests
      set status = 'confirmed',
          reviewed_by = v_caller,
          reviewed_at = now(),
          review_note = v_reason
      where id = v_req_id;
  end if;

  -- ===================== exactly one parent history row, carrying the seller's reason =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_from_status, 'cancelled', v_caller, v_reason);

  -- ===================== notification: buyer receives cancellation event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_cancelled', v_caller, p_order_id, p_order_id::text || ':cancelled'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  -- ===================== email: buyer receives the seller-cancellation event =====================
  select o.public_code into v_order_public_code from public.orders o where o.id = p_order_id;

  perform public.enqueue_email(
    'order_seller_cancelled'::public.email_event_type_enum,
    v_order_buyer_id,
    p_order_id,
    jsonb_build_object('order_public_code', v_order_public_code, 'reason', v_reason)
  );

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false, now();
end;
$$;

revoke all on function public.cancel_accepted_order(uuid, text) from public;
revoke all on function public.cancel_accepted_order(uuid, text) from anon;
grant execute on function public.cancel_accepted_order(uuid, text) to authenticated;

-- ============================================================
-- apply_user_restriction: adds one `perform public.enqueue_email(...)`
-- call on the fresh-application branch only (never on the idempotent
-- "already active" branch, which writes nothing else either). This
-- function has no in-app notification of its own today -- adding one is
-- a distinct, pre-existing gap (PRD 35.1/42) outside this task's own
-- scope ("ONLY the MVP Transactional Email Notification system"); only
-- the email side is added here, deliberately, and reported as such.
-- Nothing else in this function is changed.
-- ============================================================
create or replace function public.apply_user_restriction(p_user_id uuid, p_restriction_type restriction_type_enum, p_reason text)
returns table (restriction_id uuid, user_id uuid, restriction_type restriction_type_enum, was_already_active boolean, created_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_reason text;
  v_existing_id uuid;
  v_existing_created_at timestamptz;
  v_new_id uuid;
  v_new_created_at timestamptz;
  v_shop_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  if p_restriction_type is null then
    raise exception 'A restriction type is required.' using detail = 'RESTRICTION_TYPE_REQUIRED';
  end if;

  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A reason is required.' using detail = 'REASON_REQUIRED';
  end if;

  perform 1 from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using detail = 'USER_NOT_FOUND';
  end if;

  select ur.id, ur.created_at into v_existing_id, v_existing_created_at
    from public.user_restrictions ur
    where ur.user_id = p_user_id
      and ur.restriction_type = p_restriction_type
      and ur.lifted_at is null
    order by ur.created_at desc
    limit 1;

  if found then
    return query
      select v_existing_id, p_user_id, p_restriction_type, true, v_existing_created_at;
    return;
  end if;

  insert into public.user_restrictions (user_id, restriction_type, reason, issued_by)
    values (p_user_id, p_restriction_type, v_reason, v_caller)
    returning id, created_at into v_new_id, v_new_created_at;

  insert into public.moderation_actions (admin_id, action_type, target_user_id, restriction_type, restriction_id, reason)
    values (v_caller, 'restriction_applied', p_user_id, p_restriction_type, v_new_id, v_reason);

  if p_restriction_type in ('seller_suspended', 'account_suspended') then
    select s.id into v_shop_id from public.shops s where s.owner_id = p_user_id;
    if found then
      perform public.recalculate_trusted_seller(v_shop_id);
    end if;
  end if;

  -- ===================== email: affected user is notified of the restriction (PRD 42) =====================
  perform public.enqueue_email(
    'moderation_restriction_applied'::public.email_event_type_enum,
    p_user_id,
    v_new_id,
    jsonb_build_object('restriction_type', p_restriction_type, 'reason', v_reason)
  );

  return query
    select v_new_id, p_user_id, p_restriction_type, false, v_new_created_at;
end;
$$;

revoke all on function public.apply_user_restriction(uuid, restriction_type_enum, text) from public;
revoke all on function public.apply_user_restriction(uuid, restriction_type_enum, text) from anon;
grant execute on function public.apply_user_restriction(uuid, restriction_type_enum, text) to authenticated;

-- ============================================================
-- lift_user_restriction: adds one `perform public.enqueue_email(...)`
-- call on the fresh-lift branch only (never on the idempotent
-- "already lifted" branch, and never when the anonymized-target guard
-- above rejects the call with an exception). Nothing else in this
-- function is changed.
-- ============================================================
create or replace function public.lift_user_restriction(p_restriction_id uuid, p_note text default null::text)
returns table(restriction_id uuid, user_id uuid, restriction_type restriction_type_enum, was_already_lifted boolean, lifted_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_user_id uuid;
  v_restriction_type public.restriction_type_enum;
  v_existing_lifted_at timestamptz;
  v_note text;
  v_lifted_at timestamptz;
  v_shop_id uuid;
  v_target_deleted_at timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  select ur.user_id, ur.restriction_type, ur.lifted_at
    into v_user_id, v_restriction_type, v_existing_lifted_at
    from public.user_restrictions ur
    where ur.id = p_restriction_id
    for update;

  if not found then
    raise exception 'Restriction not found.' using detail = 'RESTRICTION_NOT_FOUND';
  end if;

  if v_existing_lifted_at is not null then
    return query
      select p_restriction_id, v_user_id, v_restriction_type, true, v_existing_lifted_at;
    return;
  end if;

  -- ===================== restriction-lift defense-in-depth: anonymized target, account_suspended only =====================
  if v_restriction_type = 'account_suspended' then
    select p.deleted_at into v_target_deleted_at
      from public.profiles p
      where p.id = v_user_id;

    if v_target_deleted_at is not null then
      raise exception 'This account has been anonymized and its account suspension cannot be lifted.' using detail = 'TARGET_ACCOUNT_ANONYMIZED';
    end if;
  end if;

  v_note := nullif(btrim(p_note), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Note is too long.' using detail = 'RESOLUTION_NOTE_TOO_LONG';
  end if;

  v_lifted_at := now();

  update public.user_restrictions as ur
    set lifted_at = v_lifted_at,
        lifted_by = v_caller
    where ur.id = p_restriction_id;

  insert into public.moderation_actions (admin_id, action_type, target_user_id, restriction_type, restriction_id, reason)
    values (v_caller, 'restriction_lifted', v_user_id, v_restriction_type, p_restriction_id, v_note);

  if v_restriction_type in ('seller_suspended', 'account_suspended') then
    select s.id into v_shop_id from public.shops s where s.owner_id = v_user_id;
    if found then
      perform public.recalculate_trusted_seller(v_shop_id);
    end if;
  end if;

  -- ===================== email: affected user is notified the restriction was lifted (PRD 42) =====================
  perform public.enqueue_email(
    'moderation_restriction_lifted'::public.email_event_type_enum,
    v_user_id,
    p_restriction_id,
    jsonb_build_object('restriction_type', v_restriction_type, 'note', v_note)
  );

  return query
    select p_restriction_id, v_user_id, v_restriction_type, false, v_lifted_at;
end;
$$;

revoke all on function public.lift_user_restriction(uuid, text) from public;
revoke all on function public.lift_user_restriction(uuid, text) from anon;
grant execute on function public.lift_user_restriction(uuid, text) to authenticated;
