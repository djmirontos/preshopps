-- Fix a confirmed defect in get_admin_users() and find_user_for_role_assignment():
-- both declare `email text` in their own RETURNS TABLE, but select
-- `u.email` directly from auth.users, whose email column is
-- `character varying(255)`, not `text`. PL/pgSQL's `return query`
-- enforces an exact structural type match against the function's
-- declared RETURNS TABLE row type -- unlike a plain top-level SELECT,
-- which implicitly casts varchar to text without complaint. This raises
-- "structure of query does not match function result type" at runtime on
-- every real call that reaches the return query, confirmed directly
-- against live Postgres logs for get_admin_users (two real
-- /admin/admins page-load attempts by the live super_admin account, both
-- logged with this exact error, shortly after a third attempt that
-- correctly hit the NOT_SUPER_ADMIN check instead -- i.e. the super-admin
-- authorization check itself was not the problem). This is a latent bug
-- present since 0078 first defined both functions; the admin roster page
-- appears to have gone un-exercised end-to-end by a real super_admin
-- until now. find_user_for_role_assignment has the byte-for-byte identical
-- pattern and is fixed here as the same-cause sibling, though no direct
-- log evidence of its own failure exists yet -- it has not been
-- separately reproduced, only inferred from the identical code shape.
--
-- The fix
-- -----------------------------------------------------------------------
-- CREATE OR REPLACE with the exact same name, parameters, RETURNS TABLE
-- shape, SECURITY DEFINER, search_path, every existing grant/revoke, and
-- every authorization/validation check, reproduced verbatim from 0078's
-- own live definitions. The only change in either function is the
-- returned email expression: `u.email` becomes `u.email::text`, an
-- explicit cast to the exact type each function's own RETURNS TABLE
-- already declares. No signature, grant, or any other query logic is
-- touched. 0078 itself is not edited -- this is a new, separate
-- redefinition, matching this schema's own established fix convention
-- (0079, 0097, 0098) for exactly this class of PL/pgSQL output-type bug.

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
      u.email::text,
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
    select p.id, p.display_name, u.email::text, ur.role
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
