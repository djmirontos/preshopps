-- Peer blocking RPCs (PRD 30): closes the real, reported gap the earlier
-- public-marketplace/security audit flagged -- "user_blocks table/RPCs
-- exist only in supabase/migrations/0030_messaging_schema.sql" and "no
-- Block/Unblock button component exists anywhere in components/messaging
-- or components/shop... there is no affordance to initiate a block."
-- public.user_blocks itself (0030) and its RLS policies
-- (user_blocks_select_involved/insert_own/delete_own, 0031) are untouched
-- here -- this migration does not alter that table, its constraints, or
-- its policies at all. It only adds the RPC-mediated write path this
-- task's own instruction requires ("no direct writes to
-- user_blocks/reports tables"), mirroring add_favorite/remove_favorite's
-- exact shape (0037) rather than inventing a new pattern.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0071_signup_policy_acceptance (confirmed live
-- via list_migrations, no drift). public.user_blocks confirmed exactly as
-- 0030 left it: (blocker_id, blocked_id) both uuid not null references
-- profiles(id) on delete restrict, created_at timestamptz default now(),
-- primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id).
-- No block_user/unblock_user/get_conversation_block_state or similarly-
-- named function exists anywhere -- clean namespace. get_conversation_
-- context (0046) already computes "the other participant's profile id"
-- internally (v_initiator_id / v_shop_owner_id) to resolve
-- other_party_display_name and the bidirectional can_send block check,
-- but never returns that id -- exposing it is the actual, real blocker
-- this migration exists to close (per this task's own "do not create new
-- backend work unless an actual blocker exists" instruction). Rather than
-- DROP+recreate the actively-used, wide get_conversation_context (whose
-- RETURNS TABLE column list cannot be changed via a plain CREATE OR
-- REPLACE), a small new standalone read RPC is added instead --
-- get_conversation_block_state -- so the heavily-relied-on existing
-- function is never touched, dropped, or re-granted.
--
-- block_user / unblock_user: same shape as add_favorite/remove_favorite
-- -----------------------------------------------------------------------
-- Auth + deleted-account eligibility checked first, identical convention
-- to every other mutating RPC in this schema (add_favorite,
-- submit_report, submit_support_ticket, ...). block_user additionally
-- rejects a self-target (CANNOT_BLOCK_SELF) before ever reaching the
-- insert -- defense in depth on top of user_blocks' own
-- user_blocks_not_self_check CHECK and the insert_own RLS policy's
-- identical guard, and on top of this feature's own UI never being able
-- to construct a self-targeting call (the conversation-block-state
-- resolution below always names the *other* participant). Both RPCs are
-- idempotent: block_user's insert uses ON CONFLICT (blocker_id,
-- blocked_id) DO NOTHING (blocking twice is a safe no-op, matching
-- accept_seller_policies' own idempotency convention), and
-- unblock_user's DELETE is naturally idempotent (deleting an absent row
-- succeeds silently, exactly like remove_favorite). Only ever
-- blocker_id = auth.uid() is written or deleted -- no p_blocker_id
-- parameter exists, and RLS on user_blocks separately reinforces the
-- same "only your own" boundary as a second layer beneath these RPCs.
--
-- get_conversation_block_state: resolves the one thing the UI needs
-- -----------------------------------------------------------------------
-- Reuses the identical participant-resolution logic get_conversation_
-- context (0046) already established (viewer must be either the
-- conversation's initiator or the shop's owner; the *other* one is
-- "the other party") so the two functions can never disagree about who
-- the other participant is. Returns exactly two fields: the other
-- party's profile id (needed as block_user/unblock_user's own
-- parameter) and whether the viewer has blocked them (so the client can
-- render Block vs. Unblock immediately, without a placeholder guess).
-- Never exposes the caller's own id (already known client-side) or any
-- other profiles column (no display_name/avatar/email) -- narrower than
-- get_conversation_context's own already-established exposure.
--
-- Preserves canon exactly: no auto-report, no restriction, no history change
-- -----------------------------------------------------------------------
-- Neither block_user nor unblock_user touches public.reports,
-- public.moderation_actions, or public.user_restrictions in any way --
-- blocking is a private peer action, never a report and never an
-- admin-visible restriction (PRD 30 vs. PRD 31/33 are kept structurally
-- separate, exactly as canon separates them). Neither RPC deletes or
-- modifies any row in conversations, messages, orders, reviews, or
-- disputes -- PRD 30's "Existing order, review, moderation, and dispute
-- history remains preserved" is upheld by construction: these RPCs only
-- ever touch user_blocks.

-- ============================================================
-- block_user
-- ============================================================
create or replace function public.block_user(
  p_blocked_id uuid
)
returns table (
  blocked_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== cannot block self =====================
  if p_blocked_id = v_caller_id then
    raise exception 'You cannot block yourself.' using detail = 'CANNOT_BLOCK_SELF';
  end if;

  -- ===================== target must exist =====================
  if not exists (select 1 from public.profiles p where p.id = p_blocked_id) then
    raise exception 'User not found.' using detail = 'USER_NOT_FOUND';
  end if;

  -- ===================== idempotent insert =====================
  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_caller_id, p_blocked_id)
  on conflict (blocker_id, blocked_id) do nothing;

  return query
    select ub.blocked_id, ub.created_at
    from public.user_blocks ub
    where ub.blocker_id = v_caller_id and ub.blocked_id = p_blocked_id;
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.block_user(uuid) from anon;
grant execute on function public.block_user(uuid) to authenticated;

-- ============================================================
-- unblock_user
-- ============================================================
-- No self-target/target-existence checks needed -- deleting a row that
-- was never there (self or otherwise) is already a harmless no-op.
create or replace function public.unblock_user(
  p_blocked_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  delete from public.user_blocks
  where blocker_id = v_caller_id and blocked_id = p_blocked_id;
end;
$$;

revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ============================================================
-- get_conversation_block_state
-- ============================================================
create or replace function public.get_conversation_block_state(
  p_conversation_id uuid
)
returns table (
  other_party_id uuid,
  is_blocked_by_viewer boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_initiator_id uuid;
  v_shop_id uuid;
  v_shop_owner_id uuid;
  v_other_party_id uuid;
begin
  -- ===================== authentication =====================
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== resolve conversation + participants (identical to get_conversation_context, 0046) =====================
  select c.initiator_id, c.shop_id into v_initiator_id, v_shop_id
    from public.conversations c
    where c.id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found.' using detail = 'CONVERSATION_NOT_FOUND';
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_shop_id;

  if v_caller_id = v_initiator_id then
    v_other_party_id := v_shop_owner_id;
  elsif v_caller_id = v_shop_owner_id then
    v_other_party_id := v_initiator_id;
  else
    raise exception 'You are not a participant in this conversation.' using detail = 'NOT_CONVERSATION_PARTICIPANT';
  end if;

  return query
    select
      v_other_party_id,
      exists (
        select 1 from public.user_blocks ub
        where ub.blocker_id = v_caller_id and ub.blocked_id = v_other_party_id
      );
end;
$$;

revoke all on function public.get_conversation_block_state(uuid) from public;
revoke all on function public.get_conversation_block_state(uuid) from anon;
grant execute on function public.get_conversation_block_state(uuid) to authenticated;
