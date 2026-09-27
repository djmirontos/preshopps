-- Messaging Email Summary, Step M1.2: database foundation only.
--
-- Three new functions. Deliberately NO new pg_cron job in this migration
-- -- see part D below for why scheduling the scan before the Edge
-- Function recognizes the event type would not be safely inert. No
-- existing function (enqueue_email, claim_pending_emails, mark_email_sent,
-- mark_email_failed, enqueue_pending_order_expiry_reminders) is redefined;
-- no existing table (email_outbox, conversations, conversation_user_states,
-- messages) is altered; the existing 15-minute email-processor cron job
-- (process-email-outbox-every-15-min) and the existing hourly
-- order-expiry-reminder cron job are untouched. The Edge Function
-- (supabase/functions/process-email-outbox/index.ts) is NOT modified by
-- this migration -- it still has no case for the new event type. Because
-- nothing schedules enqueue_unread_messaging_summaries here, no row of
-- this event type can be created except by a manual/test invocation --
-- there is no automatic path that could reach the Edge Function's own
-- unhandled-event-type throw (part D has the full analysis of what that
-- throw would actually do if it were ever reached).
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0102_unread_messaging_summary_enum (confirmed
-- committed in this repo). public.email_event_type_enum's 9th value,
-- 'unread_messages_summary', is safely referenceable here because 0102 is
-- a prior, separately-committed migration -- the enum-value-same-
-- transaction restriction that required the 0102/0103 split does not
-- apply to this file referencing a value 0102 already added.
-- get_my_unread_conversation_count (0088, re-verified against the live
-- pre-launch project during the prior design audit) is this schema's own
-- authoritative unread predicate:
--   archived_at IS NULL
--   AND coalesce(marked_unread_at IS NOT NULL OR last_read_at IS NULL
--                 OR last_message_at > last_read_at, true)
-- The functions below reuse this exact predicate, adding only a
-- `muted = false` exclusion on top (an explicitly approved product
-- decision for this event type -- the existing badge count intentionally
-- does NOT exclude muted, since mute must never suppress unread accrual;
-- it only suppresses notification delivery, and this new email is a
-- notification, not the accrual count itself).
--
-- A. enqueue_unread_messaging_summaries -- system-only scan, cron-invoked
-- -----------------------------------------------------------------------
-- Mirrors enqueue_pending_order_expiry_reminders's own established shape
-- exactly: no auth.uid() check (system-only, invoked by pg_cron -- there
-- is no caller session to check), SECURITY DEFINER, bounded p_limit,
-- returns table(recipient_id uuid) via return next for observability.
-- Computes, per candidate recipient, every currently-unread, non-archived,
-- non-muted conversation they participate in (same initiator-or-shop-
-- owner union get_my_unread_conversation_count already uses), and this
-- conversation's own "unread signal" timestamp:
--   greatest(coalesce(marked_unread_at, '-infinity'), last_message_at)
-- This single expression correctly represents either unread reason (a
-- manual mark-unread, a new message, or both at once -- schema comment:
-- marking unread never rewinds last_read_at, so both can be independently
-- true for the same row) without branching, taking whichever signal is
-- actually newest.
--
-- A recipient becomes a scan candidate once their OLDEST such signal,
-- across all their eligible conversations, is at least 30 minutes old
-- (the approved initial delay) -- deliberately MIN, not MAX. A second,
-- newer unread conversation arriving in the meantime must never reset an
-- older one's own wait: conversation A unread since 10:00, conversation B
-- unread since 10:29, scanned at 10:30 -- the recipient qualifies (A has
-- waited the full 30 minutes) even though B is only 1 minute old. Using
-- MAX here instead would incorrectly let a trickle of new messages
-- indefinitely postpone notifying about a much older unread conversation,
-- which is the opposite of the approved behavior. This is a per-recipient
-- gate on whether to notify AT ALL, not a per-conversation filter on which
-- conversations get reported; get_current_unread_messaging_summary
-- (part B) reports every currently-eligible conversation for an approved
-- recipient regardless of how fresh each individually is, and the
-- covers_through watermark below (part A.2) still uses the NEWEST signal
-- -- "has enough time passed to notify" and "what does this digest cover"
-- are two separate questions, answered by MIN and MAX respectively.
--
-- Two independent conditions must BOTH hold before actually enqueueing,
-- per the task's own explicit compound framing ("even if new unread
-- activity arrived during that period"):
--   1. Cooldown: the recipient's most recent prior unread_messages_summary
--      email_outbox row (any status -- pending/processing/sent/failed/
--      cancelled all count, per the task's own explicit instruction) must
--      be at least 2 hours old, OR no such row exists yet at all.
--   2. Watermark: the recipient's current newest unread signal must be
--      strictly newer than that prior row's own `covers_through` payload
--      value (defensively coalesced to '-infinity' if somehow missing) --
--      otherwise nothing has changed since the last digest and no new row
--      is created, satisfying "unchanged unread activity must not
--      generate repeated digests" independently of the cooldown.
-- A recipient with no prior row at all always passes both (nothing to be
-- newer than, no cooldown to wait out).
--
-- entity_id is a fresh gen_random_uuid() per genuinely new digest, not a
-- derived business key -- see the prior design audit's own reasoning:
-- this event type has no natural single "entity" the way an order or a
-- restriction row does, and reusing recipient_user_id as entity_id would
-- permanently block any future digest for that person after the first one
-- ever sent, via enqueue_email's own (event_type, entity_id,
-- recipient_user_id) uniqueness constraint. The real "don't duplicate"
-- control here is entirely this function's own cooldown+watermark query,
-- not that constraint -- a deliberate, documented departure from how the
-- other 8 event types use it, not an oversight.
--
-- payload contains ONLY `covers_through` (a timestamp) -- no conversation
-- id, no participant name, no message content of any kind. Recipient
-- eligibility (deleted/anonymized accounts) is delegated entirely to
-- enqueue_email's own existing check, exactly like
-- enqueue_pending_order_expiry_reminders already does -- not duplicated
-- here.
--
-- B. get_current_unread_messaging_summary -- claim-time live recheck
-- -----------------------------------------------------------------------
-- Takes p_recipient_user_id as an explicit parameter (no auth.uid() --
-- the caller is the trusted Edge Function acting on a claimed outbox
-- row's own recipient, not the recipient's own session). Re-runs the
-- IDENTICAL unread/muted/archived predicate as part A, live, at whatever
-- moment it is actually called -- intended call site is the Edge Function,
-- immediately after claiming a row and immediately before calling Resend
-- (the next bounded step, not implemented by this migration). If the
-- recipient has read, muted, or archived everything since enqueue time,
-- this returns zero rows and the caller is expected to cancel rather than
-- send -- this function itself never mutates anything; it is a pure read.
--
-- Column shape and per-row resolution are modeled directly on the
-- existing get_my_conversations (0046) initiator/seller union -- reusing
-- an already-reviewed-safe field set (shop_name, listing_title,
-- other_party_display_name) rather than inventing a new one. Deliberately
-- does NOT select get_my_conversations' own last_message_preview (m.body)
-- column or anything resembling it -- no message body, no message
-- content, anywhere in this function.
--
-- The 30-minute delay and 2-hour cooldown are both ENQUEUE-time concerns
-- (part A) and do not appear anywhere in this function -- it must not
-- hide a conversation that is genuinely still unread just because it was
-- young relative to some other gate; its only job is "is this still
-- eligible right now," using the exact same predicate, nothing more.
--
-- C. cancel_claimed_email -- claim-time cancellation, not a retry
-- -----------------------------------------------------------------------
-- Mirrors mark_email_sent's own exact WHERE-guard convention: only
-- transitions a row still 'processing' (a WHERE clause, not an exception,
-- so a duplicate/late call is a safe no-op) directly to 'cancelled', never
-- through mark_email_failed's retry/backoff path -- a cancellation is not
-- a failure to be retried, it is "there is genuinely nothing left to send."
-- Never counts toward attempt_count. Error text sanitized via the exact
-- same left(coalesce(nullif(btrim(...)), fallback), 2000) convention
-- mark_email_failed already uses.
--
-- D. pg_cron job -- deliberately NOT created by this migration
-- -----------------------------------------------------------------------
-- This migration creates enqueue_unread_messaging_summaries but does NOT
-- schedule it. The existing process-email-outbox Edge Function's
-- EmailEventType union and renderEmailTemplate switch have no case for
-- 'unread_messages_summary' yet -- its default branch throws
-- `Unhandled email event type: ...`, and that throw happens AFTER
-- claim_pending_emails has already transitioned the row to 'processing',
-- with no surrounding try/catch in that loop to fall back to
-- mark_email_failed. The throw propagates out to the Deno.serve handler's
-- own outer try/catch, which returns HTTP 500 -- and because it aborts
-- the whole processEmailOutbox loop mid-iteration, ANY other rows the
-- same claim_pending_emails call happened to claim in the same batch
-- (a different event type, unrelated to this one) never get sent or
-- marked in that invocation either, even though they were already
-- legitimately claimed. The row then becomes eligible for the existing
-- stale-'processing' reclaim (claimed_at older than 5 minutes) on the
-- very next processor tick, and the identical throw happens again --
-- repeating indefinitely, since mark_email_failed (the only place that
-- enforces the 5-attempt cap) is never reached. Scheduling the scan
-- before the Edge Function recognizes the event type is therefore not
-- safely inert -- it would actively degrade the shared processor for
-- every other event type, not just leave an inert pending row. Cron
-- activation is deferred to a later migration (expected 0104), only
-- after the Edge Function's own template case has been added and
-- reviewed. That later job will not touch, replace, or reschedule
-- 'process-email-outbox-every-15-min' in any way -- it keeps
-- claiming/sending every event type, including this new one, once the
-- Edge Function change lands.
--
-- E. Grants -- verified against how this project's pg_cron jobs actually
-- run, not assumed (see the prior design audit's own live query against
-- cron.job.username on the pre-launch project: every existing job runs as
-- role `postgres`, which is NOT a Postgres superuser here but IS the
-- owner of every function these migrations create -- and a function
-- owner always has implicit EXECUTE on its own functions regardless of
-- any GRANT/REVOKE targeting other roles). Concretely:
--   - enqueue_unread_messaging_summaries: will work via ownership alone
--     once a later migration's cron.schedule invokes it directly, exactly
--     like enqueue_pending_order_expiry_reminders already does -- not
--     scheduled by this migration (see part D). REVOKEd from
--     public/anon/authenticated; GRANTed to service_role purely for
--     convention-consistency with that sibling function -- NOT load-
--     bearing for the eventual cron path itself.
--   - get_current_unread_messaging_summary / cancel_claimed_email: these
--     ARE genuinely invoked by the Edge Function's service_role-
--     authenticated Supabase client over PostgREST (a real, different
--     call path from cron, not the function owner) -- their
--     GRANT EXECUTE ... TO service_role is load-bearing here, matching
--     claim_pending_emails/mark_email_sent/mark_email_failed's own
--     already-established, already-verified-live grant pattern exactly.
-- None of the three functions is ever granted to anon or authenticated --
-- no client-facing path can read another user's conversation existence,
-- unread state, or trigger a scan.

-- ============================================================
-- enqueue_unread_messaging_summaries: service_role/postgres(cron)-only
-- scan. No auth.uid() check -- system-only, matching
-- enqueue_pending_order_expiry_reminders's own convention exactly.
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
-- get_current_unread_messaging_summary: service_role-only claim-time
-- live recheck. No auth.uid() -- p_recipient_user_id is the trusted
-- caller's own explicit parameter, resolved from the outbox row it
-- already claimed, not from a session.
-- ============================================================
create or replace function public.get_current_unread_messaging_summary(
  p_recipient_user_id uuid
)
returns table (
  conversation_id uuid,
  shop_name text,
  listing_title text,
  other_party_display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient_user_id is null then
    return;
  end if;

  return query
    with combined as (
      -- viewer is the conversation's initiator ("buyer" role) -- other
      -- party is the shop itself, no individual person name (same
      -- convention as get_my_conversations' own initiator branch).
      select
        c.id as conv_id,
        s.name as shop_name,
        l.title as listing_title,
        null::text as other_name,
        c.last_message_at as conv_last_message_at,
        cus.archived_at as cus_archived_at,
        cus.muted as cus_muted,
        cus.last_read_at as cus_last_read_at,
        cus.marked_unread_at as cus_marked_unread_at
      from public.conversations c
      join public.shops s on s.id = c.shop_id
      left join public.listings l on l.id = c.listing_id
      left join public.conversation_user_states cus
        on cus.conversation_id = c.id and cus.user_id = p_recipient_user_id
      where c.initiator_id = p_recipient_user_id

      union all

      -- viewer owns the shop ("seller" role) -- other party is the buyer
      -- who initiated the thread.
      select
        c.id,
        s.name,
        l.title,
        p.display_name,
        c.last_message_at,
        cus.archived_at,
        cus.muted,
        cus.last_read_at,
        cus.marked_unread_at
      from public.conversations c
      join public.shops s on s.id = c.shop_id
      join public.profiles p on p.id = c.initiator_id
      left join public.listings l on l.id = c.listing_id
      left join public.conversation_user_states cus
        on cus.conversation_id = c.id and cus.user_id = p_recipient_user_id
      where s.owner_id = p_recipient_user_id
    )
    select
      combined.conv_id as conversation_id,
      combined.shop_name,
      combined.listing_title,
      combined.other_name as other_party_display_name
    from combined
    where combined.cus_archived_at is null
      and coalesce(combined.cus_muted, false) = false
      and coalesce(
        combined.cus_marked_unread_at is not null
          or combined.cus_last_read_at is null
          or combined.conv_last_message_at > combined.cus_last_read_at,
        true
      )
    order by combined.conv_last_message_at desc;
end;
$$;

revoke all on function public.get_current_unread_messaging_summary(uuid) from public;
revoke all on function public.get_current_unread_messaging_summary(uuid) from anon;
revoke all on function public.get_current_unread_messaging_summary(uuid) from authenticated;
grant execute on function public.get_current_unread_messaging_summary(uuid) to service_role;

-- ============================================================
-- cancel_claimed_email: service_role-only. Only transitions a row still
-- 'processing', directly to 'cancelled' -- never through
-- mark_email_failed's retry/backoff path, and never counted as sent.
-- ============================================================
create or replace function public.cancel_claimed_email(
  p_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  v_reason := left(coalesce(nullif(btrim(p_reason), ''), 'Cancelled.'), 2000);

  update public.email_outbox
    set status = 'cancelled',
        last_error = v_reason
    where id = p_id and status = 'processing';
end;
$$;

revoke all on function public.cancel_claimed_email(uuid, text) from public;
revoke all on function public.cancel_claimed_email(uuid, text) from anon;
revoke all on function public.cancel_claimed_email(uuid, text) from authenticated;
grant execute on function public.cancel_claimed_email(uuid, text) to service_role;

-- No cron.schedule call in this migration -- see part D above. The scan
-- function exists and is fully usable via a direct, manual
-- `select public.enqueue_unread_messaging_summaries(...)` call (e.g. for
-- rehearsal/verification), but nothing in this migration causes it to run
-- automatically. Scheduling it is a later, separate migration (expected
-- 0104), gated on the Edge Function change landing first.
