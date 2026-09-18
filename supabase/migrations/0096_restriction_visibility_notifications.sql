-- Moderation completion, Step A1 (part 2 of 2): closes exactly the two gaps
-- the read-only moderation audit confirmed -- (1) a restricted/suspended
-- user has no RPC anywhere that lets them read their own active
-- restriction/reason, and (2) apply_user_restriction/lift_user_restriction
-- (0067/0083) already enqueue an email but never write to
-- public.notifications, despite ARCHITECTURE.md's own in-app notification
-- list naming "Moderation action" as a core event (S19) and PRD 42
-- requiring both an in-app AND an email notification. Database/backend
-- foundation only -- no frontend banner/UI, no appeal flow, no listing/
-- review moderation, no admin user management (all explicitly out of this
-- task's own scope).
--
-- Depends on 0095 (prior, separately committed migration)
-- -----------------------------------------------------------------------
-- 0095_restriction_visibility_notifications.sql adds exactly the two enum
-- values this migration references below (moderation_restriction_applied/
-- moderation_restriction_lifted) and nothing else. PostgreSQL forbids
-- using a value added to a pre-existing enum type inside the same
-- transaction that added it -- 0095 is a separate, already-committed
-- migration by the time this one runs, so both values are safe to
-- reference here in a column default-free ALTER, inside CREATE OR REPLACE
-- FUNCTION bodies, and in explicit casts. This is this migration's entire
-- reason for being split from 0095, matching this project's own
-- established precedent (0015/…, 0073-0074, 0080-0081) for the identical
-- situation.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0095_restriction_visibility_notifications
-- (confirmed -- no drift). apply_user_restriction/lift_user_restriction's
-- current live bodies are exactly what 0083 left them as (0083 is the
-- last migration to touch either function; 0082's own lift_user_
-- restriction redefinition was itself superseded by 0083's later one in
-- the same migration sequence) -- both already: admin-authorized, require/
-- validate a reason (apply only), idempotent (an already-active
-- restriction on apply, or an already-lifted row on lift, returns success
-- and writes nothing further), write exactly one moderation_actions row on
-- a real transition, call recalculate_trusted_seller for seller_suspended/
-- account_suspended, and (0083) enqueue a moderation_restriction_applied/
-- moderation_restriction_lifted email via enqueue_email. Neither function
-- writes to public.notifications today -- confirmed by a full-text read of
-- both bodies, not assumed. public.notifications (0040) has no column
-- that could reference a restriction -- confirmed unchanged since 0040
-- (only order_id/conversation_id/review_id exist, alongside the table's
-- own documented "no title/body/payload column by design" comment). No
-- get_my_active_restrictions or similarly-named function exists anywhere
-- -- confirmed via pg_proc; public.user_restrictions is read today only by
-- the admin-only get_admin_user_restrictions (0067) and internally by
-- several trusted RPCs, never by a self-scoped read. RLS on
-- user_restrictions remains enabled with zero policies (rls_auto_enable
-- default-deny, unchanged since 0004) -- this migration adds no policy to
-- it; the new self-read RPC is the only additional access path, exactly
-- like every existing admin RPC against this same table.
--
-- restriction_id column, not a payload/text column -- matches this table's
-- own "resolved fresh, never stored" design exactly
-- -----------------------------------------------------------------------
-- public.notifications' own existing comment is explicit: "No title/body/
-- payload/delivery-state columns by design; every recipient-facing string
-- is projected fresh by get_my_notifications." order_id/conversation_id/
-- review_id are that exact pattern -- a nullable FK to the one table that
-- actually owns the display text, resolved at read time. restriction_id
-- (nullable, references user_restrictions(id), ON DELETE CASCADE --
-- matching order_id/conversation_id/review_id's identical ON DELETE
-- CASCADE, not the RESTRICT this schema uses for admin-identity/
-- accountability columns elsewhere) is the same pattern applied to this
-- new notification type, so a later frontend step can resolve restriction_
-- type/reason fresh from user_restrictions exactly like every other
-- notification type already resolves its own display text -- never a
-- frozen copy that could go stale or drift from the authoritative row.
-- get_my_notifications (0040) is deliberately NOT widened in this
-- migration to project restriction_type/reason: this project's own
-- established precedent (0072's header, for the identical situation with
-- get_conversation_context) is to add a small new function rather than
-- risk changing an actively-used, wide RETURNS TABLE function's column
-- shape -- and this task's own scope is backend foundation only, with
-- frontend display explicitly deferred to a later step. The notification
-- row exists, is correctly typed, and is fully resolvable by that later
-- step; rendering it is not this migration's job.
--
-- get_my_active_restrictions(): self-read, active-only, minimal projection
-- -----------------------------------------------------------------------
-- No p_user_id parameter -- identity is exclusively auth.uid(), exactly
-- like get_my_notifications/get_my_admin_role/every other self-read RPC in
-- this schema. Rejects an unauthenticated caller with NOT_AUTHENTICATED
-- (matching get_my_notifications' own convention, not get_my_admin_role's
-- softer silent-null -- this task's own instruction is explicit: "un-
-- authenticated caller rejected"). A deleted/anonymized caller's own
-- profile returns zero rows rather than an error, mirroring get_my_
-- notifications' identical "missing/deleted caller: zero rows, not an
-- error" convention exactly. Returns a full TABLE (restriction_id,
-- restriction_type, reason, created_at) -- one row per currently-active
-- restriction (lifted_at is null), so a user who somehow has more than one
-- simultaneously active restriction type (e.g. buyer_restricted AND
-- seller_suspended at once -- nothing in this schema prevents that, since
-- apply_user_restriction's own idempotency check is scoped to one exact
-- restriction_type at a time) is represented as multiple rows, never
-- silently collapsed to one. Deliberately excludes issued_by/issued_by_
-- display_name/lifted_by/lifted_by_display_name (all present on the
-- admin-only get_admin_user_restrictions, 0067) -- this task's own
-- instruction is explicit that moderator identity is not exposed here
-- unless canon requires it, and PRD 33.2 only ever promises the affected
-- user their own "suspension notice/reason," never who issued it. lifted_
-- at/lifted_by are also excluded: this RPC's own contract is "active
-- restrictions only" (lifted_at is null by construction), so a lifted_at
-- column would only ever read back NULL. No other user's restriction row
-- can ever be read through this function -- the WHERE clause is always
-- `user_id = auth.uid()`, never a client-supplied id, so there is no
-- target-identity parameter to forge in the first place.
--
-- apply_user_restriction / lift_user_restriction: exactly one new insert
-- each, placed after every existing idempotent-return branch
-- -----------------------------------------------------------------------
-- Every existing line of behavior from 0083's live bodies is reproduced
-- verbatim -- admin authorization, reason validation, the profile-row
-- lock, the idempotent early-return branches (an already-active
-- restriction on apply, an already-lifted row on lift, both returning
-- before any write), the moderation_actions insert, the Trusted Seller
-- recalculation hook, the anonymized-target guard on lift (0082/0083), and
-- the existing enqueue_email call. The one addition to each is a single
-- `insert into public.notifications (...)` placed immediately after that
-- existing enqueue_email call (same "state first, side effects after,
-- audit before external side effects" ordering every mutating RPC in this
-- schema already follows) -- so it can only ever be reached on the exact
-- same real-transition path the email already uses, which is exactly why
-- a duplicate/idempotent apply or lift can never create a duplicate
-- notification: the idempotent branches return long before reaching it,
-- identical to why they never create a duplicate email today. `on conflict
-- on constraint notifications_recipient_type_dedupe_key do nothing` is
-- included anyway as the same defense-in-depth every other notification
-- insert in this schema already carries, not because the idempotent
-- early-returns alone are believed insufficient. dedupe_key is the
-- restriction's own id plus an event-describing suffix (":applied"/
-- ":lifted"), mirroring dispute_resolved's own `p_dispute_id::text ||
-- ':resolved'` convention exactly -- a fresh restriction row from a later
-- re-apply (after an earlier one was lifted) always has a new id, so no
-- suffix is strictly required for uniqueness, but the suffix is kept for
-- the same readability/consistency reason the existing convention already
-- uses one. actor_id is set to the caller (the acting admin), matching
-- this schema's own existing precedent for an admin-driven, affected-user-
-- facing notification: dispute_resolved (0075) sets actor_id to the
-- resolving admin, and get_my_notifications already projects that as
-- actor_display_name to both order participants today. This migration
-- follows that same established pattern rather than inventing a new
-- "hide the actor" convention with no canonical basis -- this task's own
-- explicit "do not expose moderator identity" instruction is scoped to
-- the self-read RPC's own returned columns (a different, more targeted
-- disclosure surface), not to the notification actor field every other
-- admin-driven notification in this schema already populates. Both
-- inserts carry the same anonymized-recipient guard (`not exists (...
-- deleted_at is not null)`) every other notification insert in this
-- schema already uses.
--
-- Security: no RLS policy is added to notifications or user_restrictions
-- by this migration (both already RLS-enabled -- notifications since 0040
-- with only its own pre-existing notifications_select_own SELECT policy,
-- user_restrictions since 0004 with zero policies) -- the new self-read
-- RPC is the only additional access path to user_restrictions, and the two
-- new notification inserts happen exclusively inside the two existing
-- SECURITY DEFINER admin RPCs, never through a new direct-write policy on
-- notifications. get_my_active_restrictions is SECURITY DEFINER, SET
-- search_path = '', every table/column reference schema- and alias-
-- qualified, REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated
-- only -- identical posture to every other self-read RPC in this schema.
-- apply_user_restriction/lift_user_restriction's own existing admin-
-- authorization checks, grants, and revokes are entirely unchanged.

alter table public.notifications
  add column restriction_id uuid references public.user_restrictions(id) on delete cascade;

-- ============================================================
-- get_my_active_restrictions
-- ============================================================
create or replace function public.get_my_active_restrictions()
returns table (
  restriction_id uuid,
  restriction_type public.restriction_type_enum,
  reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== missing/deleted caller profile: zero rows, not an error =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return;
  end if;

  -- ===================== only the caller's own currently-active restrictions =====================
  return query
    select
      ur.id as restriction_id,
      ur.restriction_type,
      ur.reason,
      ur.created_at
    from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
    order by ur.created_at desc;
end;
$$;

revoke all on function public.get_my_active_restrictions() from public;
revoke all on function public.get_my_active_restrictions() from anon;
grant execute on function public.get_my_active_restrictions() to authenticated;

-- ============================================================
-- apply_user_restriction (adds one in-app notification insert only)
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

  -- ===================== in-app notification: same event, same recipient, only on a real transition (PRD 42) =====================
  insert into public.notifications (recipient_id, type, actor_id, restriction_id, dedupe_key)
  select p_user_id, 'moderation_restriction_applied', v_caller, v_new_id, v_new_id::text || ':applied'
  where not exists (
    select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_new_id, p_user_id, p_restriction_type, false, v_new_created_at;
end;
$$;

revoke all on function public.apply_user_restriction(uuid, restriction_type_enum, text) from public;
revoke all on function public.apply_user_restriction(uuid, restriction_type_enum, text) from anon;
grant execute on function public.apply_user_restriction(uuid, restriction_type_enum, text) to authenticated;

-- ============================================================
-- lift_user_restriction (adds one in-app notification insert only, on the
-- fresh-lift branch -- never on the idempotent "already lifted" branch,
-- and never when the anonymized-target guard rejects the call)
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

  -- ===================== in-app notification: same event, same recipient, only on a real lift (PRD 42) =====================
  insert into public.notifications (recipient_id, type, actor_id, restriction_id, dedupe_key)
  select v_user_id, 'moderation_restriction_lifted', v_caller, p_restriction_id, p_restriction_id::text || ':lifted'
  where not exists (
    select 1 from public.profiles p where p.id = v_user_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_restriction_id, v_user_id, v_restriction_type, false, v_lifted_at;
end;
$$;

revoke all on function public.lift_user_restriction(uuid, text) from public;
revoke all on function public.lift_user_restriction(uuid, text) from anon;
grant execute on function public.lift_user_restriction(uuid, text) to authenticated;
