-- ============================================================
-- 0114_review_moderation_state_and_audit.sql
--
-- Phase 1 whole-review moderation schema.
--
-- 1. reviews.removed_at: NULL = visible; set = removed by moderation.
--    Reversible: restore clears it. This is a "hidden from app" state only.
--    Object URLs in the public review-images bucket are unaffected (see the
--    Phase 1 limitation recorded with this slice).
--
-- 2. review_moderation_actions: append-only audit of every removal and
--    restoration (PRD §41: actor, action, target, previous state, new
--    state, timestamp, reason). The user-facing message and the private
--    admin note are stored separately. Only the user-facing message may ever
--    leave the database, and only to the buyer (see 0115).
--
-- Immutability is enforced by a trigger that rejects UPDATE, DELETE, and
-- TRUNCATE for every role, including the table owner, so it does not depend
-- on RLS or grants alone.
-- ============================================================

alter table public.reviews
  add column if not exists removed_at timestamptz null;

-- User-facing moderation message carried by the in-app notification (removal
-- reason, or optional restore message). Private admin notes never go here.
-- Null for every notification type other than review_removed/review_restored.
alter table public.notifications
  add column if not exists public_message text null
    constraint notifications_public_message_check
      check (
        public_message is null
        or (char_length(public_message) <= 1000 and public_message ~ '[^[:space:]]')
      );

create table public.review_moderation_actions (
  id uuid primary key default gen_random_uuid(),

  admin_id uuid not null
    references public.profiles(id) on delete restrict,

  review_id uuid not null
    references public.reviews(id) on delete restrict,

  action_type text not null,
  previous_state text not null,
  new_state text not null,

  -- User-facing explanation. Required for a removal; optional for a restore.
  -- Shown to the buyer (order review page, notification, email).
  public_message text null,

  -- Private admin note. Never returned to any non-admin caller.
  private_note text null,

  created_at timestamptz not null default now(),

  constraint review_moderation_actions_action_type_check
    check (action_type in ('review_removed', 'review_restored')),

  constraint review_moderation_actions_state_values_check
    check (previous_state in ('visible', 'removed') and new_state in ('visible', 'removed')),

  -- Only the two legal transitions can be recorded.
  constraint review_moderation_actions_transition_check
    check (
      (action_type = 'review_removed' and previous_state = 'visible' and new_state = 'removed')
      or (action_type = 'review_restored' and previous_state = 'removed' and new_state = 'visible')
    ),

  constraint review_moderation_actions_public_message_check
    check (
      public_message is null
      or (char_length(public_message) <= 1000 and public_message ~ '[^[:space:]]')
    ),

  constraint review_moderation_actions_private_note_check
    check (
      private_note is null
      or (char_length(private_note) <= 1000 and private_note ~ '[^[:space:]]')
    ),

  constraint review_moderation_actions_removal_reason_required_check
    check (action_type <> 'review_removed' or public_message is not null)
);

create index review_moderation_actions_review_id_created_at_idx
  on public.review_moderation_actions (review_id, created_at desc, id desc);

-- Append-only: reject every mutation, for every role.
create or replace function public.review_moderation_actions_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Review moderation audit records are immutable.' using detail = 'AUDIT_IMMUTABLE';
end;
$$;

create trigger review_moderation_actions_reject_update_delete
  before update or delete on public.review_moderation_actions
  for each row execute function public.review_moderation_actions_reject_mutation();

create trigger review_moderation_actions_reject_truncate
  before truncate on public.review_moderation_actions
  for each statement execute function public.review_moderation_actions_reject_mutation();

-- RLS on with zero client policies, matching the trusted-RPC-only pattern
-- used by listing_moderation_actions (0106). Direct client access is
-- denied both by policy absence and by revoked table privileges.
alter table public.review_moderation_actions enable row level security;

revoke all on public.review_moderation_actions from public;
revoke all on public.review_moderation_actions from anon;
revoke all on public.review_moderation_actions from authenticated;
