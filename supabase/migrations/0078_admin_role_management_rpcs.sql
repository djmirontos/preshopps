-- Admin Bootstrap / Admin Role Management foundation, RPC layer (PRD
-- 4.4/4.5, ARCHITECTURE S8, PRD 41): get_my_admin_role, get_admin_users,
-- find_user_for_role_assignment, grant_admin_role, revoke_admin_role. No
-- schema change here -- 0077's enum/table/bootstrap function are used
-- exactly as created. No existing admin-agnostic RPC (0067/0070/0075) is
-- touched -- their role-agnostic `exists (select 1 from user_roles ...)`
-- authorization is untouched and still correct for their own purposes
-- (Reports/Support/Disputes are explicitly usable by any admin per PRD
-- 4.4, not super_admin-gated).
--
-- Pre-inspection: migration history ends at 0077_admin_role_management_
-- schema (confirmed live, no drift). admin_audit_logs/
-- admin_audit_action_enum/bootstrap_first_super_admin confirmed exactly
-- as 0077 left them.
--
-- Super-admin authorization -- new, stricter than every existing admin
-- check in this schema
-- -----------------------------------------------------------------------
-- Every RPC below (except get_my_admin_role, which is intentionally
-- self-only and role-agnostic -- see its own note) uses
-- `exists (select 1 from public.user_roles ur where ur.user_id = v_caller
-- and ur.role = 'super_admin')`, not the plain "any role row" check
-- 0067/0070/0075 use -- per ARCHITECTURE S8, "Super Admin alone can
-- manage admin role assignments," an ordinary admin must be rejected
-- exactly like an ordinary signed-in user, both with NOT_SUPER_ADMIN.
--
-- get_my_admin_role(): the one role-agnostic RPC here, by design
-- -----------------------------------------------------------------------
-- Returns the caller's own role (or null for an ordinary user/guest) --
-- used purely so every admin page's shared nav shell can decide whether
-- to render the "Admins" link, without exposing anyone else's role or
-- identity. Self-only (derived entirely from auth.uid()), so there is no
-- privilege or information-disclosure concern in granting this to every
-- authenticated user: it only ever answers "what is MY role."
--
-- get_admin_users(): the full roster, super_admin-only
-- -----------------------------------------------------------------------
-- public.user_roles "will only ever hold a handful of rows" (0004's own
-- header) -- no pagination is added, matching that migration's own
-- reasoning. Joins auth.users for email (profiles deliberately does not
-- duplicate it, per 0004's own header; 0065's recalculate_trusted_seller
-- is this schema's own existing precedent for a SECURITY DEFINER function
-- reading auth.users directly under search_path = '').
--
-- find_user_for_role_assignment(p_email): the search RPC this task's own
-- instruction requires in place of any general user directory
-- -----------------------------------------------------------------------
-- Super_admin-only, returns only the minimal identity fields needed to
-- decide/perform a role assignment (id, display name, email, current
-- role if any) for exactly one matching, non-deleted account -- never a
-- browsable list, never any other profile field (location, avatar, etc.).
--
-- grant_admin_role(p_user_id, p_role, p_reason): grant OR change, one
-- upsert operation
-- -----------------------------------------------------------------------
-- "Add an existing user as admin/super_admin" and "change role if
-- allowed" (this task's own Admin UI section) are the same underlying
-- operation on this schema's single-row-per-user model (UNIQUE(user_id))
-- -- there is no separate "the user already has a different role" case
-- that needs its own RPC; ON CONFLICT (user_id) DO UPDATE handles both a
-- fresh grant and a role change with one statement. May assign either
-- 'admin' or 'super_admin' -- canon never restricts which roles a
-- super_admin may assign (0077's own header), so both are permitted.
-- granted_by is always v_caller (auth.uid()), never a parameter -- no
-- client-supplied grantor identity is ever trusted, satisfying this
-- task's own explicit instruction. Setting the exact same role the
-- target already holds is a safe, audit-free no-op (idempotent, matching
-- update_dispute_status's own established idempotency convention, 0075)
-- -- nothing actually changed, so no admin_audit_logs row is written for
-- it. A real change is always mirrored into admin_audit_logs (action =
-- 'admin_role_granted' when previous_role was null, else
-- 'admin_role_changed'). p_reason is optional (PRD 41 lists "Reason when
-- applicable," not unconditionally required the way applying a
-- restriction is, per moderation_actions_reason_required_for_apply_check)
-- -- capped at 1000 chars, matching this schema's established reason/
-- note length convention.
--
-- revoke_admin_role(p_user_id, p_reason): remove entirely, ordinary
-- users have no row
-- -----------------------------------------------------------------------
-- Deletes the user_roles row outright (an ordinary user has none, per
-- 0004's own "absence of a row = ordinary user" convention) -- there is
-- no "revoke to what" ambiguity the way there might be with a status
-- column. Rejects a target with no row at all (TARGET_HAS_NO_ROLE) rather
-- than silently succeeding on a no-op, since "revoke" implies something
-- was actually held.
--
-- Lockout protection -- one invariant covers both stated requirements
-- -----------------------------------------------------------------------
-- This task's own SAFETY RULES list two rules: "a super_admin must not be
-- able to remove/demote the LAST remaining super_admin" and
-- "self-demotion/removal only if another super_admin exists." These are
-- the same invariant from two angles (self-removal is just the case
-- target = caller) -- both grant_admin_role (when previous_role =
-- 'super_admin' and the new role is not 'super_admin') and
-- revoke_admin_role (when previous_role = 'super_admin') apply the
-- identical check: after excluding the target's own row, at least one
-- OTHER super_admin row must exist, or the action is rejected with
-- LAST_SUPER_ADMIN -- regardless of whether the caller is acting on
-- themselves or on someone else. Only ever counting/locking super_admin
-- rows keeps this cheap (this table will only ever hold a handful of
-- rows) while still being race-safe: before counting, both functions lock
-- every current super_admin row (`for update`) so two concurrent
-- demote/revoke calls against two *different* super_admin targets cannot
-- both independently observe "at least one other exists" and simultaneously
-- drive the count to zero -- the second transaction blocks on the lock
-- until the first commits, then re-reads a now-accurate count. Revoking
-- or demoting the last remaining plain 'admin' is never restricted --
-- canon protects only super_admin, the sole role capable of managing
-- roles at all; losing the last plain admin is not a structural lockout,
-- since any super_admin can re-grant it at any time.
--
-- Duplicate rows, nonexistent/deleted targets
-- -----------------------------------------------------------------------
-- UNIQUE(user_id) on user_roles (0004) already makes a duplicate role row
-- structurally impossible; grant_admin_role's ON CONFLICT DO UPDATE means
-- this is never even attempted, let alone races into a unique_violation.
-- grant_admin_role additionally checks the target profile exists and is
-- not deleted (public.profiles, deleted_at is null) before granting --
-- revoke_admin_role does not re-check this, since removing an elevated
-- role from an account (deleted or not) is never something canon would
-- want blocked.

-- ============================================================
-- get_my_admin_role
-- ============================================================
create or replace function public.get_my_admin_role()
returns public.user_role_enum
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_role public.user_role_enum;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return null;
  end if;

  select ur.role into v_role
    from public.user_roles ur
    where ur.user_id = v_caller;

  return v_role;
end;
$$;

revoke all on function public.get_my_admin_role() from public;
revoke all on function public.get_my_admin_role() from anon;
grant execute on function public.get_my_admin_role() to authenticated;

-- ============================================================
-- get_admin_users
-- ============================================================
create or replace function public.get_admin_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  role public.user_role_enum,
  granted_by uuid,
  granted_by_display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller and ur.role = 'super_admin') then
    raise exception 'Super admin access required.' using detail = 'NOT_SUPER_ADMIN';
  end if;

  return query
    select
      ur.user_id,
      p.display_name,
      u.email,
      ur.role,
      ur.granted_by,
      gp.display_name as granted_by_display_name,
      ur.created_at
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    join auth.users u on u.id = ur.user_id
    left join public.profiles gp on gp.id = ur.granted_by
    order by ur.created_at asc;
end;
$$;

revoke all on function public.get_admin_users() from public;
revoke all on function public.get_admin_users() from anon;
grant execute on function public.get_admin_users() to authenticated;

-- ============================================================
-- find_user_for_role_assignment
-- ============================================================
create or replace function public.find_user_for_role_assignment(
  p_email text
)
returns table (
  user_id uuid,
  display_name text,
  email text,
  existing_role public.user_role_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_email text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller and ur.role = 'super_admin') then
    raise exception 'Super admin access required.' using detail = 'NOT_SUPER_ADMIN';
  end if;

  v_email := nullif(btrim(p_email), '');
  if v_email is null then
    raise exception 'An email is required.' using detail = 'EMAIL_REQUIRED';
  end if;

  return query
    select p.id, p.display_name, u.email, ur.role
    from auth.users u
    join public.profiles p on p.id = u.id
    left join public.user_roles ur on ur.user_id = p.id
    where lower(u.email) = lower(v_email)
      and p.deleted_at is null;
end;
$$;

revoke all on function public.find_user_for_role_assignment(text) from public;
revoke all on function public.find_user_for_role_assignment(text) from anon;
grant execute on function public.find_user_for_role_assignment(text) to authenticated;

-- ============================================================
-- grant_admin_role
-- ============================================================
create or replace function public.grant_admin_role(
  p_user_id uuid,
  p_role public.user_role_enum,
  p_reason text default null
)
returns table (
  user_id uuid,
  role public.user_role_enum,
  previous_role public.user_role_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_previous_role public.user_role_enum;
  v_reason text;
  v_other_super_admin_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller and ur.role = 'super_admin') then
    raise exception 'Super admin access required.' using detail = 'NOT_SUPER_ADMIN';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null) then
    raise exception 'Target user not found.' using detail = 'TARGET_USER_NOT_FOUND';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Please shorten the reason.' using detail = 'REASON_TOO_LONG';
  end if;

  -- ===================== lock any existing role row for this target =====================
  select ur.role into v_previous_role
    from public.user_roles ur
    where ur.user_id = p_user_id
    for update;

  -- ===================== idempotent no-op: already exactly this role =====================
  if v_previous_role is not distinct from p_role then
    return query select p_user_id, p_role, v_previous_role;
    return;
  end if;

  -- ===================== lockout protection: never let the super_admin count reach zero =====================
  if v_previous_role = 'super_admin' and p_role <> 'super_admin' then
    perform 1 from public.user_roles ur where ur.role = 'super_admin' for update;

    select count(*) into v_other_super_admin_count
      from public.user_roles ur
      where ur.role = 'super_admin' and ur.user_id <> p_user_id;

    if v_other_super_admin_count = 0 then
      raise exception 'Cannot demote the last remaining super admin.' using detail = 'LAST_SUPER_ADMIN';
    end if;
  end if;

  insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, p_role, v_caller)
  on conflict (user_id) do update
    set role = excluded.role,
        granted_by = excluded.granted_by,
        created_at = now();

  insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
    values (
      v_caller,
      p_user_id,
      case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end,
      v_previous_role,
      p_role,
      v_reason
    );

  return query select p_user_id, p_role, v_previous_role;
end;
$$;

revoke all on function public.grant_admin_role(uuid, public.user_role_enum, text) from public;
revoke all on function public.grant_admin_role(uuid, public.user_role_enum, text) from anon;
grant execute on function public.grant_admin_role(uuid, public.user_role_enum, text) to authenticated;

-- ============================================================
-- revoke_admin_role
-- ============================================================
create or replace function public.revoke_admin_role(
  p_user_id uuid,
  p_reason text default null
)
returns table (
  user_id uuid,
  previous_role public.user_role_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_previous_role public.user_role_enum;
  v_reason text;
  v_other_super_admin_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller and ur.role = 'super_admin') then
    raise exception 'Super admin access required.' using detail = 'NOT_SUPER_ADMIN';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Please shorten the reason.' using detail = 'REASON_TOO_LONG';
  end if;

  -- ===================== lock the target's role row =====================
  select ur.role into v_previous_role
    from public.user_roles ur
    where ur.user_id = p_user_id
    for update;

  if v_previous_role is null then
    raise exception 'This user does not have an admin role.' using detail = 'TARGET_HAS_NO_ROLE';
  end if;

  -- ===================== lockout protection: never let the super_admin count reach zero =====================
  if v_previous_role = 'super_admin' then
    perform 1 from public.user_roles ur where ur.role = 'super_admin' for update;

    select count(*) into v_other_super_admin_count
      from public.user_roles ur
      where ur.role = 'super_admin' and ur.user_id <> p_user_id;

    if v_other_super_admin_count = 0 then
      raise exception 'Cannot remove the last remaining super admin.' using detail = 'LAST_SUPER_ADMIN';
    end if;
  end if;

  delete from public.user_roles where user_id = p_user_id;

  insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
    values (v_caller, p_user_id, 'admin_role_revoked', v_previous_role, null, v_reason);

  return query select p_user_id, v_previous_role;
end;
$$;

revoke all on function public.revoke_admin_role(uuid, text) from public;
revoke all on function public.revoke_admin_role(uuid, text) from anon;
grant execute on function public.revoke_admin_role(uuid, text) to authenticated;
