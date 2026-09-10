-- Admin support ticket queue: PRD 43.1 says submissions "route to admin" --
-- 0069 built the submission path (support_tickets table, RLS enabled with
-- zero policies, submit_support_ticket RPC) but admin had no way to
-- actually read what was submitted. This migration is the smallest
-- additive read layer that closes that gap: two SECURITY DEFINER RPCs,
-- get_admin_support_tickets (paginated queue) and
-- get_admin_support_ticket_detail (single ticket), following the exact
-- same admin-authorization/pagination/cursor pattern as
-- get_admin_reports/get_admin_report_detail (0067). No table, enum, or
-- policy is created or altered; no mutation RPC is added -- tickets stay
-- read-only from the admin side, since canon does not require a mutable
-- status/workflow and this task explicitly says not to invent one.
--
-- Pre-inspection: migration history ends at 0069_support_tickets
-- (confirmed live via list_migrations, no drift). support_tickets (id,
-- user_id, category, message, created_at) and
-- support_ticket_category_enum are exactly as 0069 left them; neither is
-- touched here.
--
-- Admin authorization -- identical to every admin RPC in 0067
-- -----------------------------------------------------------------------
-- `exists (select 1 from public.user_roles ur where ur.user_id = v_caller)`
-- is the same role-agnostic check 0067 uses for get_admin_reports/
-- get_admin_report_detail/etc.: user_roles has no separate "is this admin
-- vs super_admin" branch anywhere in this codebase -- any row in
-- user_roles (role = 'admin' or 'super_admin', per user_role_enum, 0004)
-- already qualifies as admin access. Not decided client-side, not a
-- p_role/p_is_admin parameter of any kind -- read from the trusted table
-- itself, exactly like every other admin RPC.
--
-- Minimal PII exposure
-- -----------------------------------------------------------------------
-- Each row exposes exactly: ticket id, category, the submitted message,
-- the submitting user's id, and that user's public display_name (the same
-- single identifying field get_admin_reports already exposes for a
-- reporter -- never email, exact address, or any other profiles column).
-- This is enough for an admin to know who to follow up with in-app;
-- nothing beyond what get_admin_reports already establishes as
-- legitimate admin-visible identity.
--
-- Pagination -- identical shape to get_admin_reports
-- -----------------------------------------------------------------------
-- Same p_limit (1-50) validation, same (created_at, id) keyset cursor
-- requiring both cursor values together or neither, same newest-first
-- ordering (created_at desc, id desc) so a stable cursor never skips or
-- repeats a row across pages.

-- ============================================================
-- get_admin_support_tickets
-- ============================================================
create or replace function public.get_admin_support_tickets(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  ticket_id uuid,
  category public.support_ticket_category_enum,
  message text,
  user_id uuid,
  user_display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  -- ===================== pagination validation =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    select
      st.id as ticket_id,
      st.category,
      st.message,
      st.user_id,
      p.display_name as user_display_name,
      st.created_at
    from public.support_tickets st
    join public.profiles p on p.id = st.user_id
    where (
      p_before_created_at is null
      or (st.created_at, st.id) < (p_before_created_at, p_before_id)
    )
    order by st.created_at desc, st.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_admin_support_tickets(integer, timestamptz, uuid) from public;
revoke all on function public.get_admin_support_tickets(integer, timestamptz, uuid) from anon;
grant execute on function public.get_admin_support_tickets(integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_admin_support_ticket_detail
-- ============================================================
create or replace function public.get_admin_support_ticket_detail(
  p_ticket_id uuid
)
returns table (
  ticket_id uuid,
  category public.support_ticket_category_enum,
  message text,
  user_id uuid,
  user_display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  if not exists (select 1 from public.support_tickets st where st.id = p_ticket_id) then
    raise exception 'Support ticket not found.' using detail = 'TICKET_NOT_FOUND';
  end if;

  return query
    select
      st.id as ticket_id,
      st.category,
      st.message,
      st.user_id,
      p.display_name as user_display_name,
      st.created_at
    from public.support_tickets st
    join public.profiles p on p.id = st.user_id
    where st.id = p_ticket_id;
end;
$$;

revoke all on function public.get_admin_support_ticket_detail(uuid) from public;
revoke all on function public.get_admin_support_ticket_detail(uuid) from anon;
grant execute on function public.get_admin_support_ticket_detail(uuid) to authenticated;
