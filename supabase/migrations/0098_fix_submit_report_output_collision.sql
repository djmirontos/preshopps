-- Moderation completion, Step A1-R4: fix the same PL/pgSQL output-column
-- collision class previously fixed in apply_user_restriction (0097), now
-- confirmed in submit_report.
--
-- Confirmed defect
-- -----------------------------------------------------------------------
-- submit_report's own RETURNS TABLE declares an OUT parameter named
-- created_at. Its insert branch performs an unqualified `returning id,
-- created_at into v_report_id, v_created_at` -- the bare `created_at` in
-- that RETURNING clause is ambiguous between the OUT parameter (an
-- implicit PL/pgSQL variable of the same name) and reports.created_at,
-- and PostgreSQL raises 42702 at runtime on every call, since submit_report
-- has no idempotent early-return branch that could ever avoid this insert
-- -- unlike apply_user_restriction, EVERY call to submit_report that
-- passes validation hits this bug, with no working path at all. This was
-- first identified during Step A1-R3's own collision search across the
-- schema (that step's own explicit scope excluded fixing it, since it
-- does not belong to the apply_user_restriction RPC path) and is
-- confirmed present in production's current live submit_report today --
-- this migration is the dedicated fix step that search called for.
--
-- Collision inventory (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Checked every unqualified table/column reference in submit_report
-- against both of its own RETURNS TABLE names (report_id, created_at):
-- the INSERT's own target-column list `(reporter_id, target_type,
-- listing_id, shop_id, review_id, conversation_id, reason, description)`
-- is an INSERT target-column-list context, not a value-expression
-- context, so it is not subject to this ambiguity class at all (and in
-- any case uses `reporter_id`, not `report_id`, so no collision would
-- exist there regardless). Every other reference to profiles/listings/
-- shops/reviews/conversations columns in the body already uses a local
-- table alias (`l.`, `s.`, `r.`, `c.`, `p.`). The one and only collision
-- in this function is the bare `returning id, created_at` on its single
-- insert, fixed below. `report_id` itself never appears bare in a
-- value-expression context anywhere in the body, so it has no collision
-- to fix.
--
-- The fix
-- -----------------------------------------------------------------------
-- CREATE OR REPLACE with the exact same name, parameters, RETURNS TABLE
-- shape (including the created_at OUT parameter name -- not renamed),
-- SECURITY DEFINER, search_path, and every existing grant/revoke,
-- auth.uid()-derived reporter identity, deleted-caller guard, description
-- validation, all four target-type resolution branches (listing/shop/
-- review/conversation) with their exact existing *_NOT_FOUND and
-- SELF_REPORT_NOT_ALLOWED / NOT_CONVERSATION_PARTICIPANT checks, and the
-- unsupported-target-type rejection -- all reproduced verbatim. No
-- duplicate/rate-limit check is added: canon (PRD 31) never defines one
-- for reports, and 0067's own header already documents this as an
-- intentional design choice ("multiple reports against the same target
-- from different reporters are legitimate triage signal for admin, not
-- spam to be silently collapsed") -- unchanged here. The only change is
-- the insert's RETURNING clause: `insert into public.reports as r (...)
-- ... returning r.id, r.created_at into ...` -- table-aliased and
-- column-qualified, so `r.created_at` unambiguously refers to the table
-- column and can never be confused with the OUT parameter of the same
-- name. This is the same qualification style 0079
-- (fix_plpgsql_output_column_collisions) and 0097 (the identical fix for
-- apply_user_restriction) already established as this schema's own
-- convention for exactly this bug class.

create or replace function public.submit_report(
  p_target_type public.report_target_type_enum,
  p_target_id uuid,
  p_reason public.report_reason_enum,
  p_description text default null
)
returns table (
  report_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_description text;
  v_listing_id uuid;
  v_shop_id uuid;
  v_review_id uuid;
  v_conversation_id uuid;
  v_lookup_shop_id uuid;
  v_owner_id uuid;
  v_buyer_id uuid;
  v_report_id uuid;
  v_created_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot submit reports.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if p_target_id is null then
    raise exception 'A report target is required.' using detail = 'TARGET_TYPE_INVALID';
  end if;

  -- ===================== description normalization/length (identical to create_review's own convention) =====================
  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Description is too long.' using detail = 'REPORT_DESCRIPTION_TOO_LONG';
  end if;

  -- ===================== resolve target, validate existence, reject self-report / non-participant cases =====================
  if p_target_type = 'listing' then
    select l.shop_id into v_lookup_shop_id
      from public.listings l
      where l.id = p_target_id;

    if not found then
      raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
    end if;

    select s.owner_id into v_owner_id from public.shops s where s.id = v_lookup_shop_id;

    if v_owner_id = v_caller then
      raise exception 'You cannot report your own listing.' using detail = 'SELF_REPORT_NOT_ALLOWED';
    end if;

    v_listing_id := p_target_id;

  elsif p_target_type = 'shop' then
    select s.owner_id into v_owner_id
      from public.shops s
      where s.id = p_target_id;

    if not found then
      raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
    end if;

    if v_owner_id = v_caller then
      raise exception 'You cannot report your own shop.' using detail = 'SELF_REPORT_NOT_ALLOWED';
    end if;

    v_shop_id := p_target_id;

  elsif p_target_type = 'review' then
    select r.buyer_id into v_buyer_id
      from public.reviews r
      where r.id = p_target_id;

    if not found then
      raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
    end if;

    if v_buyer_id = v_caller then
      raise exception 'You cannot report your own review.' using detail = 'SELF_REPORT_NOT_ALLOWED';
    end if;

    v_review_id := p_target_id;

  elsif p_target_type = 'conversation' then
    select c.initiator_id, c.shop_id into v_buyer_id, v_lookup_shop_id
      from public.conversations c
      where c.id = p_target_id;

    if not found then
      raise exception 'Conversation not found.' using detail = 'CONVERSATION_NOT_FOUND';
    end if;

    select s.owner_id into v_owner_id from public.shops s where s.id = v_lookup_shop_id;

    if v_caller <> v_buyer_id and v_caller <> v_owner_id then
      raise exception 'You are not a participant in this conversation.' using detail = 'NOT_CONVERSATION_PARTICIPANT';
    end if;

    v_conversation_id := p_target_id;

  else
    raise exception 'Unsupported report target.' using detail = 'TARGET_TYPE_INVALID';
  end if;

  -- ===================== insert the immutable report record =====================
  insert into public.reports as r (reporter_id, target_type, listing_id, shop_id, review_id, conversation_id, reason, description)
    values (v_caller, p_target_type, v_listing_id, v_shop_id, v_review_id, v_conversation_id, p_reason, v_description)
    returning r.id, r.created_at into v_report_id, v_created_at;

  return query
    select v_report_id, v_created_at;
end;
$$;

revoke all on function public.submit_report(public.report_target_type_enum, uuid, public.report_reason_enum, text) from public;
revoke all on function public.submit_report(public.report_target_type_enum, uuid, public.report_reason_enum, text) from anon;
grant execute on function public.submit_report(public.report_target_type_enum, uuid, public.report_reason_enum, text) to authenticated;
