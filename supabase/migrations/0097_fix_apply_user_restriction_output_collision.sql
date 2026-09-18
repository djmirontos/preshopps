-- Moderation completion, Step A1-R3: fix a pre-existing PL/pgSQL
-- output-column collision in apply_user_restriction that blocks every
-- genuinely new (non-idempotent) restriction application.
--
-- Confirmed defect
-- -----------------------------------------------------------------------
-- apply_user_restriction's own RETURNS TABLE declares an OUT parameter
-- named created_at. Its fresh-insert branch performs an unqualified
-- `returning id, created_at into v_new_id, v_new_created_at` -- the bare
-- `created_at` in that RETURNING clause is ambiguous between the OUT
-- parameter (an implicit PL/pgSQL variable of the same name) and
-- user_restrictions.created_at, and PostgreSQL raises 42702 at runtime on
-- every call that actually reaches this branch. The idempotent
-- "already-active" early-return branch never reaches this INSERT, which
-- is why the function appeared to work in every prior static review and
-- rehearsal check that only exercised the idempotent path -- real
-- end-to-end execution against a hosted rehearsal database (Step A1-R2)
-- is what first surfaced it, by actually applying a brand-new restriction
-- through the real RPC. This same body (byte-for-byte, this exact bug
-- included) is 0096's own verbatim reproduction of 0083's live function,
-- and is confirmed present in production's current live
-- apply_user_restriction today -- this is not a defect 0095 or 0096
-- introduced, only one they (correctly, per their own stated intent to
-- reproduce 0083 verbatim) carried forward unchanged.
--
-- Collision search (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Every other unqualified table/column reference in apply_user_restriction
-- was checked against all five of its own RETURNS TABLE names
-- (restriction_id, user_id, restriction_type, was_already_active,
-- created_at): the two idempotent-branch `insert into
-- public.user_restrictions (user_id, restriction_type, reason,
-- issued_by)` / `insert into public.moderation_actions (..., restriction_type,
-- restriction_id, ...)` column lists are INSERT target-column lists, not
-- value-expression contexts, so they are not subject to this ambiguity
-- class at all; every other reference to user_restrictions/moderation_actions
-- columns in the body is already alias-qualified (`ur.`, `p.`). The one and
-- only collision in this function is the bare `returning id, created_at`
-- on the fresh-insert branch, fixed below.
--
-- The same collision class was also searched for across every other
-- current function in this schema whose own RETURNS TABLE could plausibly
-- collide with a bare RETURNING clause in its body. One additional
-- occurrence was found: submit_report has an identical unqualified
-- `returning id, created_at` against its own `TABLE(report_id uuid,
-- created_at timestamp with time zone)` shape, which would fail the same
-- way on every real call. submit_report does not belong to the
-- apply_user_restriction RPC path (it is the unrelated report-submission
-- flow) and per this step's own explicit scope is deliberately NOT fixed
-- here -- it is reported as a separate, already-identified defect for a
-- future, dedicated step. No other function in the schema showed this
-- pattern; every other RETURNS TABLE function with a RETURNING clause in
-- its body already qualifies every returned column via a table alias.
--
-- The fix
-- -----------------------------------------------------------------------
-- CREATE OR REPLACE with the exact same name, parameters, RETURNS TABLE
-- shape (including the created_at OUT parameter name -- not renamed),
-- SECURITY DEFINER, search_path, and every existing grant/revoke,
-- admin-authorization check, reason validation, idempotency branch,
-- moderation_actions insert, Trusted Seller recalculation hook, email
-- enqueue call, and the in-app notification insert 0096 added -- all
-- reproduced verbatim. The only change is the fresh-insert RETURNING
-- clause: `insert into public.user_restrictions as ur (...) ... returning
-- ur.id, ur.created_at into ...` -- table-aliased and column-qualified,
-- so `ur.created_at` unambiguously refers to the table column and can
-- never be confused with the OUT parameter of the same name. This is the
-- same qualification style this schema's own 0079
-- (fix_plpgsql_output_column_collisions) already established as the
-- convention for exactly this bug class elsewhere.

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

  insert into public.user_restrictions as ur (user_id, restriction_type, reason, issued_by)
    values (p_user_id, p_restriction_type, v_reason, v_caller)
    returning ur.id, ur.created_at into v_new_id, v_new_created_at;

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
