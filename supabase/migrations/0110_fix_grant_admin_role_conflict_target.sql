-- Fix a confirmed defect in grant_admin_role(): it declares `RETURNS
-- TABLE(user_id uuid, ...)`, making `user_id` an implicit PL/pgSQL OUT
-- parameter. Its own upsert statement then writes `on conflict (user_id)
-- do update ...` -- an unqualified column reference inside the
-- conflict-target list, which (confirmed empirically, not just inferred)
-- IS subject to the same PL/pgSQL variable-vs-column ambiguity check a
-- plain INSERT target-column list is exempt from. This raises "column
-- reference "user_id" is ambiguous" (SQLSTATE 42702) at runtime on every
-- real call that reaches the insert -- confirmed directly against live
-- Postgres logs for a real /admin/admins "grant role" attempt by the live
-- super_admin account: context "PL/pgSQL function
-- public.grant_admin_role(...) line 51 at SQL statement", detail "It
-- could refer to either a PL/pgSQL variable or a table column.",
-- internal_query_pos 114 landing exactly on the `(` opening `on conflict
-- (user_id)`. Checked and confirmed the target account received no role
-- row and no admin_audit_logs row from any of the failed attempts -- the
-- statement-level exception rolled back the whole call before any write.
--
-- Unlike 0097/0098/0109's own RETURNING-clause fixes (which qualify the
-- returned column with the insert's own table alias), ON CONFLICT's
-- conflict-target grammar does not accept a table-qualified column name
-- at all, so the same qualification style cannot apply here. Renaming
-- the RETURNS TABLE's own `user_id` OUT parameter would change this
-- function's public signature/response shape, which this fix does not
-- do. Instead, the conflict target is named by its actual unique
-- constraint instead of by column: `user_roles_user_id_key` -- the
-- default-generated name Postgres already assigned to the inline `unique`
-- on user_roles.user_id (0004_identity.sql), confirmed present on the
-- live table. A constraint name can never collide with a PL/pgSQL
-- variable, so this removes the ambiguity entirely while targeting the
-- exact same unique index, with no change to the upsert's own semantics.
--
-- Checked every other function for this same collision class
-- (RETURNS TABLE OUT parameter literally named `user_id`, combined with
-- an unqualified value-expression reference to a real user_id column):
-- revoke_admin_role's own mutating statement is a plain `delete ... as ur
-- where ur.user_id = p_user_id` (already alias-qualified, no ON CONFLICT
-- clause at all); bootstrap_first_super_admin's own insert is already
-- `insert into public.user_roles as ur (...) ... returning
-- ur.created_at` (already alias-qualified, no ON CONFLICT clause
-- either). Neither is affected by this bug, and neither is touched here.
--
-- The fix
-- -----------------------------------------------------------------------
-- CREATE OR REPLACE with the exact same name, parameters, RETURNS TABLE
-- shape, SECURITY DEFINER, search_path, every existing grant/revoke, and
-- every authorization/locking/lockout-protection/audit-write check,
-- reproduced verbatim from 0078's own live definition. The only change
-- is the conflict target: `on conflict (user_id)` becomes `on conflict on
-- constraint user_roles_user_id_key`. No signature, grant, locking,
-- audit, or any other query logic is touched. 0078 itself is not edited
-- -- this is a new, separate redefinition, matching this schema's own
-- established fix convention (0079, 0097, 0098, 0109) for this class of
-- PL/pgSQL output-identifier collision bug.

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
