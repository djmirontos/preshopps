-- Enables the minimum Supabase Realtime backend required for the
-- upcoming messages + notifications Realtime frontend work (per the
-- accepted read-only Realtime audit). Adds exactly two tables to the
-- `supabase_realtime` publication:
--
--   - public.messages
--   - public.notifications
--
-- public.conversations is deliberately NOT added here -- the accepted
-- architecture derives every conversation-level UI update (unread bump,
-- list reordering, badge) from the `notifications` channel instead
-- (every new message already inserts exactly one deduped `new_message`
-- notification row in the same transaction, per send_message/0082), so a
-- direct conversations-table subscription is not required for MVP. Keeping
-- the publication minimal avoids broadcasting conversation-level noise
-- (archive/mute/mark-unread are purely local per-user state on
-- conversation_user_states and were never candidates for this publication
-- either) that nothing currently needs to consume.
--
-- Pre-apply verification (read-only, immediately before writing this
-- migration): re-confirmed live that
--   - RLS is enabled on both public.messages and public.notifications
--   - public.messages carries `messages_select_participants` (SELECT,
--     authenticated only, scoped to the parent conversation's
--     initiator_id / shop owner_id -- unchanged since the audit)
--   - public.notifications carries `notifications_select_own` (SELECT,
--     authenticated only, `auth.uid() = recipient_id` -- unchanged since
--     the audit)
--   - the `supabase_realtime` publication currently contains zero tables
-- No divergence from the accepted audit was found, so this migration adds
-- nothing beyond publication membership: no RLS policy is created, altered,
-- or dropped; no table grant changes; no REPLICA IDENTITY change (both
-- tables already default to identity-by-primary-key, which is sufficient
-- -- Realtime's `payload.new` always carries the full inserted/updated row
-- regardless of replica identity, and this slice only needs INSERT
-- events); no message/notification/conversation schema change; no RPC is
-- created or replaced.
--
-- Supabase's `postgres_changes` Realtime model evaluates each subscribing
-- client's own RLS SELECT policy per broadcast event using their
-- connection's JWT, so adding these two tables to the publication does not
-- by itself grant any client visibility beyond what messages_select_participants
-- and notifications_select_own already allow -- an anon connection (no
-- policy matches `roles = {authenticated}` for either policy) gains
-- nothing, and an authenticated user still only receives rows for
-- conversations they participate in / notifications addressed to them.
--
-- Idempotency: ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS clause
-- in PostgreSQL and errors if the table is already a member, so each
-- addition is guarded by an explicit pg_publication_tables existence check
-- rather than a broad exception handler -- this makes a re-run of this
-- migration a safe no-op without silently swallowing any other, unrelated
-- failure.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
