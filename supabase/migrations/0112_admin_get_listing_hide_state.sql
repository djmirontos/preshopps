-- Listing-hide state reader: admin-only, read-only. admin_hide_listing and
-- admin_unhide_listing (0106) can change a listing's hidden_by_admin_at,
-- but no currently-callable read path exposes that value, so an admin UI
-- cannot show whether a listing is hidden without attempting a mutation.
-- This adds the smallest read contract that closes that gap.
--
-- Authorization mirrors admin_hide_listing exactly: an authenticated
-- caller, then a trusted public.user_roles check, before anything is
-- read. The read takes no row lock, writes nothing, and inserts no audit
-- row. A listing that does not exist raises LISTING_NOT_FOUND, deliberately
-- distinct from a visible listing, which returns a row whose
-- hidden_by_admin_at is null.
--
-- RETURNS TABLE declares listing_id and hidden_by_admin_at as OUT
-- parameters, so every reference in the body is alias-qualified (l.id,
-- l.hidden_by_admin_at) or uses the function's own parameter, to avoid the
-- PL/pgSQL output-identifier ambiguity fixed in 0097, 0109, 0110, and 0111.
--
-- Existing functions are not redefined here.

create or replace function public.admin_get_listing_hide_state(p_listing_id uuid)
returns table (listing_id uuid, hidden_by_admin_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_hidden_at timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  select l.hidden_by_admin_at into v_hidden_at
    from public.listings l
    where l.id = p_listing_id;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  return query
    select p_listing_id, v_hidden_at;
end;
$$;

revoke all on function public.admin_get_listing_hide_state(uuid) from public;
revoke all on function public.admin_get_listing_hide_state(uuid) from anon;
grant execute on function public.admin_get_listing_hide_state(uuid) to authenticated;
