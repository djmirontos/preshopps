-- Messaging Email Summary, Step M1.5: concurrency guard + cron activation.
--
-- Redefines exactly one existing function (adding a transaction-level
-- advisory lock, nothing else) and adds exactly one new pg_cron job. No
-- other database object changes. get_current_unread_messaging_summary,
-- cancel_claimed_email, email_outbox, enqueue_email, the other 8 email
-- events, and the three existing cron jobs (order-expiry-reminders-hourly,
-- process-email-outbox-every-15-min, expire-pending-orders-every-15-min)
-- are all untouched.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0103_unread_messaging_summary (confirmed
-- committed in this repo; neither 0102 nor 0103 has been deployed to the
-- live pre-launch project, which remains at 0101). This migration itself
-- must ALSO not be deployed yet -- see this task's own explicit
-- deployment-boundary instruction: the required order is 0102 -> 0103 ->
-- the already-committed updated process-email-outbox Edge Function ->
-- manual verification -> only then this migration.
--
-- Why a guard is needed before cron activation (read-only audit, M1.4)
-- -----------------------------------------------------------------------
-- Two concurrent calls to enqueue_unread_messaging_summaries() can each
-- independently read the same committed watermark/cooldown state (under
-- this project's own confirmed READ COMMITTED isolation), each generate
-- their own fresh entity_id, and each successfully enqueue a separate
-- unread_messages_summary row for the same recipient -- entity_id is
-- deliberately unique per call, so enqueue_email's own
-- (event_type, entity_id, recipient_user_id) uniqueness constraint cannot
-- detect or prevent this. pg_cron's own documented behavior (verified
-- against the citusdata/pg_cron README, "How pg_cron works": "pg_cron can
-- run multiple jobs in parallel, but only one instance of each specific
-- job at a time. If a second instance is triggered before the first
-- finishes, it's queued and starts as soon as the first one completes.")
-- only serializes multiple SCHEDULED RUNS OF THIS SAME NAMED JOB against
-- each other -- it says nothing about, and provides no protection
-- against, a manual/rehearsal SQL call to this function overlapping with
-- a scheduled run, two manual calls overlapping each other, or a future,
-- differently-named second job calling the same function. A transaction-
-- level advisory lock closes all of those, not just the one pg_cron
-- already handles on its own.
--
-- The lock itself
-- -----------------------------------------------------------------------
-- pg_advisory_xact_lock(int, int) -- the two-integer, transaction-scoped,
-- BLOCKING form. Not pg_advisory_lock (session-scoped -- would require
-- explicit unlock and could leak if a session ever died mid-hold, exactly
-- the failure mode _xact_ locks exist to avoid). Not
-- pg_try_advisory_xact_lock -- this is a background scan with no latency
-- requirement, and a non-blocking attempt would need its own decision
-- about what to do on failure to acquire (silently skip the entire scan
-- cycle, if handled carelessly) where simply waiting has no such risk.
-- Not session-level locking of any kind. A blocked caller (cron, manual
-- SQL, or any future job) waits for the current holder's transaction to
-- commit or roll back -- at which point pg_advisory_xact_lock's own
-- defining property releases the lock automatically, whether that
-- transaction succeeded or failed -- then proceeds against the now-fresh,
-- already-committed state. The scan is never silently skipped for any
-- caller; every caller eventually runs, serialized.
--
-- A single, global lock (not per-recipient) is used deliberately: this
-- scan is bounded (p_limit, default/max processed rows), runs at most
-- every 30 minutes once cron is active, and the realistic overlap
-- scenario is rare (an occasional manual/rehearsal call, not sustained
-- concurrent production load) -- per-recipient locking would need a
-- collision-tolerant per-UUID key derivation for a throughput benefit
-- this system does not need yet, and was explicitly not chosen for that
-- reason (see the M1.4 audit's own option comparison).
--
-- Because this function is SECURITY DEFINER with `set search_path = ''`
-- (matching every other function in this schema), pg_catalog functions
-- are fully qualified here even though pg_catalog is implicitly searched
-- regardless of search_path -- explicit, not relying on that implicit
-- behavior. The lock key is a stable, deterministic, namespaced pair:
-- pg_catalog.hashtext('preshopps') and
-- pg_catalog.hashtext('enqueue_unread_messaging_summaries') -- both
-- pg_catalog.hashtext(text) returns int4, matching
-- pg_advisory_xact_lock(int, int) exactly, no cast needed. Confirmed via
-- repo-wide search immediately before writing this file: zero existing
-- use of pg_advisory_* anywhere in this codebase's migrations -- this key
-- pair cannot collide with any other advisory lock this schema already
-- uses, because there isn't one yet.
--
-- Acquired once, immediately after the existing p_limit validation and
-- BEFORE the eligibility/watermark query begins -- exactly as specified.
--
-- Everything else in this redefinition is byte-for-byte identical to the
-- approved 0103 implementation: the 30-minute initial threshold
-- (v_delay_cutoff), MIN(unread_signal_at) gating eligibility (not MAX --
-- a newer unread conversation must never reset an older one's own wait),
-- MAX(unread_signal_at) feeding covers_through, the muted/archived
-- exclusions, the identical coalesce(..., true) fail-safe default, the
-- 2-hour cooldown (v_cooldown_window) combined with the covers_through
-- watermark as two independent conditions, one grouped row per recipient
-- (GROUP BY recipient_id before any LIMIT), p_limit bounding recipients
-- rather than raw conversations, a fresh gen_random_uuid() entity_id per
-- genuinely new digest, the existing enqueue_email() call (never a raw
-- INSERT INTO email_outbox), and a payload containing only
-- covers_through -- no conversation id, participant name, or message
-- content of any kind.
--
-- Cron activation
-- -----------------------------------------------------------------------
-- 'unread-messaging-summary-scan-every-30-min', direct SQL call to
-- enqueue_unread_messaging_summaries(200) -- no HTTP, no Edge Function, no
-- secret -- identical mechanism to the existing
-- 'order-expiry-reminders-hourly' job (itself verified, in the M1.2
-- design audit, to run as role `postgres`, which owns every function
-- these migrations create and therefore has implicit EXECUTE on this one
-- regardless of its own GRANT statements -- the service_role grant below
-- remains a convention-consistency artifact, not load-bearing for this
-- cron path). Does not touch, redefine, or reschedule
-- process-email-outbox-every-15-min, order-expiry-reminders-hourly, or
-- expire-pending-orders-every-15-min in any way.

-- ============================================================
-- enqueue_unread_messaging_summaries: same signature, same grants, same
-- scan logic as 0103 -- the only change is the advisory lock acquired
-- immediately below the existing parameter validation.
-- ============================================================
create or replace function public.enqueue_unread_messaging_summaries(
  p_limit integer default 200
)
returns table (
  recipient_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_delay_cutoff timestamptz := v_now - interval '30 minutes';
  v_cooldown_window interval := interval '2 hours';
  r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Batch limit must be between 1 and 1000.' using detail = 'INVALID_BATCH_LIMIT';
  end if;

  -- Transaction-level, blocking, namespaced advisory lock -- serializes
  -- every caller of this function (cron, manual SQL, or any future job)
  -- against every other. Acquired before any eligibility/watermark read
  -- below, so a caller that had to wait always proceeds against fresh,
  -- already-committed state, never a stale snapshot. Automatically
  -- released when this transaction commits or rolls back -- no unlock
  -- call, no leak risk.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('preshopps'),
    pg_catalog.hashtext('enqueue_unread_messaging_summaries')
  );

  for r in
    with participant_conversations as (
      -- viewer is the conversation's initiator ("buyer" role).
      select
        c.id as conversation_id,
        c.last_message_at,
        c.initiator_id as viewer_id,
        cus.archived_at,
        cus.last_read_at,
        cus.marked_unread_at,
        cus.muted
      from public.conversations c
      left join public.conversation_user_states cus
        on cus.conversation_id = c.id and cus.user_id = c.initiator_id

      union all

      -- viewer owns the shop ("seller" role).
      select
        c.id,
        c.last_message_at,
        s.owner_id,
        cus.archived_at,
        cus.last_read_at,
        cus.marked_unread_at,
        cus.muted
      from public.conversations c
      join public.shops s on s.id = c.shop_id
      left join public.conversation_user_states cus
        on cus.conversation_id = c.id and cus.user_id = s.owner_id
    ),
    eligible_conversations as (
      select
        pc.viewer_id as recipient_id,
        greatest(coalesce(pc.marked_unread_at, '-infinity'::timestamptz), pc.last_message_at) as unread_signal_at
      from participant_conversations pc
      where pc.archived_at is null
        and coalesce(pc.muted, false) = false
        and coalesce(
          pc.marked_unread_at is not null
            or pc.last_read_at is null
            or pc.last_message_at > pc.last_read_at,
          true
        )
    ),
    recipient_signals as (
      select
        ec.recipient_id,
        -- Eligibility gates on the OLDEST qualifying unread signal, not
        -- the newest: once ANY one conversation has sat unread for the
        -- full delay window, the recipient qualifies -- a second, newer
        -- unread conversation arriving in the meantime must never reset
        -- that first conversation's own wait. covers_through (below)
        -- still uses the newest signal, since the digest content and
        -- watermark are about "what's covered as of now," a separate
        -- concern from "has enough time passed to notify at all."
        min(ec.unread_signal_at) as oldest_unread_signal_at,
        max(ec.unread_signal_at) as newest_unread_signal_at
      from eligible_conversations ec
      group by ec.recipient_id
      having min(ec.unread_signal_at) <= v_delay_cutoff
    )
    select
      rs.recipient_id,
      rs.newest_unread_signal_at
    from recipient_signals rs
    left join lateral (
      select
        eo.created_at,
        coalesce((eo.payload ->> 'covers_through')::timestamptz, '-infinity'::timestamptz) as covers_through
      from public.email_outbox eo
      where eo.recipient_user_id = rs.recipient_id
        and eo.event_type = 'unread_messages_summary'::public.email_event_type_enum
      order by eo.created_at desc
      limit 1
    ) prior on true
    where prior.created_at is null
       or (
         v_now - prior.created_at >= v_cooldown_window
         and rs.newest_unread_signal_at > prior.covers_through
       )
    order by rs.recipient_id
    limit p_limit
  loop
    perform public.enqueue_email(
      'unread_messages_summary'::public.email_event_type_enum,
      r.recipient_id,
      gen_random_uuid(),
      jsonb_build_object('covers_through', r.newest_unread_signal_at)
    );

    recipient_id := r.recipient_id;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.enqueue_unread_messaging_summaries(integer) from public;
revoke all on function public.enqueue_unread_messaging_summaries(integer) from anon;
revoke all on function public.enqueue_unread_messaging_summaries(integer) from authenticated;
grant execute on function public.enqueue_unread_messaging_summaries(integer) to service_role;

-- ============================================================
-- unread-summary scan cron: every 30 minutes, direct SQL call, no HTTP,
-- no secret -- identical mechanism to order-expiry-reminders-hourly.
-- Scanning/enqueueing only -- never claims, sends, or touches
-- process-email-outbox-every-15-min in any way. NOT applied by this
-- commit -- see this migration's own header and the task's explicit
-- deployment-boundary instruction.
-- ============================================================
select cron.schedule(
  'unread-messaging-summary-scan-every-30-min',
  '*/30 * * * *',
  $$select public.enqueue_unread_messaging_summaries(200);$$
);
