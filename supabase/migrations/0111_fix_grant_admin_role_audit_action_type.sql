-- Fix a confirmed defect in grant_admin_role()'s own admin_audit_logs
-- insert: `admin_audit_logs.action` is `public.admin_audit_action_enum`,
-- but the value supplied is `case when v_previous_role is null then
-- 'admin_role_granted' else 'admin_role_changed' end` -- a CASE
-- expression whose two branches are both untyped string literals.
-- Unlike a bare literal placed directly in an INSERT's VALUES list
-- (which Postgres resolves against the target column's type --
-- confirmed working today for revoke_admin_role's own equivalent bare
-- 'admin_role_revoked' literal in the same column position), a CASE
-- expression's own result type is resolved independently, before the
-- INSERT-target coercion applies. With both branches untyped, Postgres
-- defaults the result to `text`, and `text` cannot implicitly cast to a
-- custom enum -- raising "column "action" is of type
-- public.admin_audit_action_enum but expression is of type text"
-- (SQLSTATE 42804) at runtime on every real call that reaches the
-- insert. Confirmed directly against live Postgres logs for a real
-- /admin/admins "grant role" retry by the live super_admin account
-- (after 0110's own fix already resolved the earlier ON CONFLICT
-- ambiguity): context "PL/pgSQL function public.grant_admin_role(...)
-- line 58 at SQL statement", hint "You will need to rewrite or cast the
-- expression.", internal_query_pos 157 landing exactly on the `case`
-- keyword. Checked and confirmed the target account received no role
-- row and no admin_audit_logs row from any of the failed attempts, and
-- no lock was left held -- the statement-level exception rolled back the
-- whole call (including the already-executed user_roles upsert) before
-- any write persisted, exactly the atomic role-plus-audit behavior this
-- function already relies on Postgres's own implicit-transaction
-- rollback to provide.
--
-- Checked every other value/return expression in the function body for
-- the same class of issue (an untyped literal or expression landing on
-- an enum/typed column without the context to resolve correctly): every
-- other value is already a typed parameter or declared variable
-- (p_user_id uuid, p_role public.user_role_enum, v_caller uuid,
-- v_previous_role public.user_role_enum, v_reason text), matching its
-- target column's type directly with no literal or CASE involved -- none
-- of them are affected. revoke_admin_role's own audit insert uses a bare
-- literal ('admin_role_revoked') directly in the VALUES list, not a
-- CASE, so it is not affected either and is not touched here.
--
-- The fix
-- -----------------------------------------------------------------------
-- This migration takes grant_admin_role's current live/0110 body (which
-- already carries 0110's own `on conflict on constraint
-- user_roles_user_id_key` fix) as its basis, not 0078's original. The
-- only change is an explicit cast on the CASE expression's own result:
-- `(case when v_previous_role is null then 'admin_role_granted' else
-- 'admin_role_changed' end)::public.admin_audit_action_enum`. Every
-- other line -- authorization, locking, lockout protection, the upsert
-- and its named conflict target, the remaining audit-insert columns, the
-- return shape, SECURITY DEFINER, search_path, and every grant -- is
-- reproduced verbatim from 0110. 0078 and 0110 are not edited, and
-- revoke_admin_role is not redefined -- this is a new, separate
-- redefinition, matching this schema's own established fix convention
-- (0079, 0097, 0098, 0109, 0110) for PL/pgSQL output-type/identifier
-- bugs.

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
  on conflict on constraint user_roles_user_id_key do update
    set role = excluded.role,
        granted_by = excluded.granted_by,
        created_at = now();

  insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
    values (
      v_caller,
      p_user_id,
      (case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end)::public.admin_audit_action_enum,
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
