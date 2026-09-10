-- Disputes MVP, buyer/seller-facing RPCs (PRD 34.1/34.2/34.3, 34.6):
-- create_dispute, get_my_disputes, get_dispute_detail,
-- get_order_dispute_summary. No admin action lives here (0075). No
-- schema change here -- 0073's tables/enum values/storage bucket are
-- used exactly as created.
--
-- Pre-inspection: migration history ends at 0073_disputes_schema
-- (confirmed live, no drift). disputes/dispute_images/
-- dispute_status_history/dispute_admin_notes confirmed exactly as 0073
-- left them.
--
-- "Eligible active order" (PRD 34.1) -- a reasoned, documented reading,
-- not an invented one
-- -----------------------------------------------------------------------
-- PRD 22's own order-status-flow section lists "Active order -> Disputed"
-- immediately alongside "Accepted/Ready/etc. -> Cancelled" in the same
-- "Alternative outcomes" list -- the same "etc." status set a seller can
-- already directly cancel (accepted, ready -- cancel_accepted_order,
-- 0023) plus the two later active-but-not-yet-completed states
-- (handed_over_or_shipped, received_confirmed) that PRD 22.3 explicitly
-- describes as still eligible for "dispute/admin intervention" when a
-- buyer never confirms receipt. 'pending' is excluded: no seller has
-- accepted anything yet, no reservation exists, and PRD's own pending-
-- state remedy is direct buyer cancellation (23.1), not a dispute.
-- 'disputed' itself, and every terminal status (completed, declined,
-- cancelled, expired), are excluded by construction -- eligibility is
-- exactly {accepted, ready, handed_over_or_shipped, received_confirmed}.
--
-- Order transitions to 'disputed' transactionally, inside create_dispute
-- -----------------------------------------------------------------------
-- Per this task's own instruction. orders.status, orders.disputed_at, and
-- one order_status_history row (from_status = whatever it actually was,
-- to_status = 'disputed', changed_by = the opener) are written in the
-- same transaction as the dispute/dispute_images/dispute_status_history
-- rows -- one atomic unit, order row locked FOR UPDATE first as this
-- schema's universal serialization point. Order-item snapshots and
-- inventory_reservations are never touched here at all (no fulfillment
-- fact changes just because a dispute opened) -- reservation
-- consequences belong entirely to whichever later admin action (cancel
-- or complete, 0075) actually resolves what happened to the goods.
--
-- Resolving a dispute does NOT restore any prior order status
-- -----------------------------------------------------------------------
-- PRD 34.4/ARCHITECTURE S20 give admin exactly three distinct actions --
-- cancel order, mark resolved, mark completed when justified -- never a
-- fourth "put it back to whatever it was" action. This task's own
-- instruction is explicit: do not invent restoration where canon doesn't
-- state it. update_dispute_status (0075) therefore only ever changes
-- disputes.status; it never touches orders.status. An order can
-- legitimately remain 'disputed' forever after its dispute resolves with
-- neither a cancel nor a complete action -- e.g. the parties worked it
-- out privately over messaging and admin just closed the case -- which is
-- why disputes_order_id_active_unique (0073) is scoped to `status <>
-- 'resolved'`, not to the order's own status: a second, later, unrelated
-- dispute on that same order must still be possible once the first one
-- is actually resolved, independent of whatever the order's status is.
--
-- Identity, ownership, no direct table writes
-- -----------------------------------------------------------------------
-- Every RPC below derives identity exclusively from auth.uid(); none
-- accepts a p_user_id/p_buyer_id/p_shop_id parameter of any kind. All
-- three tables from 0073 have zero client RLS policies (rls_auto_enable
-- default-deny) -- these RPCs are the only write/read path.

-- ============================================================
-- create_dispute
-- ============================================================
create or replace function public.create_dispute(
  p_order_id uuid,
  p_reason text,
  p_explanation text,
  p_image_paths text[] default '{}'::text[]
)
returns table (
  dispute_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;
  v_from_status public.order_status_enum;
  v_reason text;
  v_explanation text;
  v_image_count integer;
  v_path text;
  v_dispute_id uuid;
  v_created_at timestamptz;
  v_now timestamptz;
  v_recipient_id uuid;
  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.buyer_id
    into v_order_status, v_order_shop_id, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  -- ===================== authorization: caller must be the buyer or the shop owner =====================
  if v_caller <> v_order_buyer_id and v_caller <> v_shop_owner_id then
    raise exception 'You do not have permission to open a dispute on this order.' using detail = 'NOT_ORDER_PARTICIPANT';
  end if;

  -- ===================== eligibility: only an active order may be disputed (see header) =====================
  if v_order_status not in ('accepted', 'ready', 'handed_over_or_shipped', 'received_confirmed') then
    raise exception 'This order cannot be disputed right now.' using detail = 'ORDER_NOT_DISPUTABLE';
  end if;

  -- ===================== duplicate-active-dispute guard (explicit, friendly -- the unique index is the final guard) =====================
  if exists (select 1 from public.disputes d where d.order_id = p_order_id and d.status <> 'resolved') then
    raise exception 'A dispute is already open for this order.' using detail = 'DISPUTE_ALREADY_ACTIVE';
  end if;

  -- ===================== reason/explanation validation =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A reason is required.' using detail = 'DISPUTE_REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'Please shorten the reason.' using detail = 'DISPUTE_REASON_TOO_LONG';
  end if;

  v_explanation := btrim(p_explanation);
  if v_explanation is null or length(v_explanation) = 0 then
    raise exception 'An explanation is required.' using detail = 'DISPUTE_EXPLANATION_REQUIRED';
  end if;
  if char_length(v_explanation) > 2000 then
    raise exception 'Please shorten the explanation.' using detail = 'DISPUTE_EXPLANATION_TOO_LONG';
  end if;

  -- ===================== image path validation (0..3) -- ownership enforced by storage RLS, not re-checked here (matches create_review's own convention) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 3 then
    raise exception 'A dispute may include at most 3 images.' using detail = 'TOO_MANY_DISPUTE_IMAGES';
  end if;

  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null or v_path !~ '[^[:space:]]' then
        raise exception 'One or more dispute image paths are invalid.' using detail = 'DISPUTE_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  v_from_status := v_order_status;
  v_now := now();

  -- ===================== insert the dispute (race-safe: order lock already serializes; UNIQUE is the final guard) =====================
  begin
    insert into public.disputes (order_id, opened_by, reason, explanation, created_at)
      values (p_order_id, v_caller, v_reason, v_explanation, v_now)
      returning id, created_at into v_dispute_id, v_created_at;
  exception
    when unique_violation then
      raise exception 'A dispute is already open for this order.' using detail = 'DISPUTE_ALREADY_ACTIVE';
  end;

  -- ===================== image rows =====================
  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.dispute_images (dispute_id, storage_path)
        values (v_dispute_id, p_image_paths[i]);
    end loop;
  end if;

  -- ===================== dispute's own status timeline: null -> opened =====================
  insert into public.dispute_status_history (dispute_id, from_status, to_status, changed_by)
    values (v_dispute_id, null, 'opened', v_caller);

  -- ===================== order transitions to disputed, transactionally, history preserved =====================
  update public.orders
    set status = 'disputed',
        disputed_at = v_now
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_from_status, 'disputed', v_caller, null);

  -- ===================== notify the other participant only =====================
  v_recipient_id := case when v_caller = v_order_buyer_id then v_shop_owner_id else v_order_buyer_id end;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_recipient_id, 'dispute_opened', v_caller, p_order_id, v_dispute_id::text || ':opened'
  where not exists (
    select 1 from public.profiles p where p.id = v_recipient_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_dispute_id, v_created_at;
end;
$$;

revoke all on function public.create_dispute(uuid, text, text, text[]) from public;
revoke all on function public.create_dispute(uuid, text, text, text[]) from anon;
grant execute on function public.create_dispute(uuid, text, text, text[]) to authenticated;

-- ============================================================
-- get_my_disputes
-- ============================================================
-- Scoped to order participancy (buyer or shop owner), not just
-- opened_by -- PRD 34.6's "remains attached to order history for buyer,
-- seller, admin" means both parties see it, whichever one opened it.
create or replace function public.get_my_disputes(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  dispute_id uuid,
  order_id uuid,
  order_public_code text,
  status public.dispute_status_enum,
  reason text,
  opened_by uuid,
  is_mine_opened boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
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
      d.id as dispute_id,
      d.order_id,
      o.public_code as order_public_code,
      d.status,
      d.reason,
      d.opened_by,
      (d.opened_by = v_caller) as is_mine_opened,
      d.created_at
    from public.disputes d
    join public.orders o on o.id = d.order_id
    join public.shops s on s.id = o.shop_id
    where (o.buyer_id = v_caller or s.owner_id = v_caller)
      and (
        p_before_created_at is null
        or (d.created_at, d.id) < (p_before_created_at, p_before_id)
      )
    order by d.created_at desc, d.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_disputes(integer, timestamptz, uuid) from public;
revoke all on function public.get_my_disputes(integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_disputes(integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_dispute_detail
-- ============================================================
-- Buyer/seller-facing detail: full reason/explanation/status/evidence
-- paths/order snapshot -- never the admin-only private notes (those are
-- exposed exclusively via get_admin_dispute_detail, 0075, per PRD 42's
-- "Private admin notes must never be exposed to users").
create or replace function public.get_dispute_detail(
  p_dispute_id uuid
)
returns table (
  dispute_id uuid,
  order_id uuid,
  order_public_code text,
  order_status public.order_status_enum,
  status public.dispute_status_enum,
  reason text,
  explanation text,
  opened_by uuid,
  is_mine_opened boolean,
  shop_name text,
  buyer_display_name text,
  fulfillment_method public.fulfillment_method_enum,
  image_paths text[],
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_id uuid;
  v_buyer_id uuid;
  v_shop_owner_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select d.order_id into v_order_id
    from public.disputes d
    where d.id = p_dispute_id;

  if not found then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
  end if;

  select o.buyer_id, s.owner_id into v_buyer_id, v_shop_owner_id
    from public.orders o
    join public.shops s on s.id = o.shop_id
    where o.id = v_order_id;

  if v_caller <> v_buyer_id and v_caller <> v_shop_owner_id then
    raise exception 'You do not have permission to view this dispute.' using detail = 'NOT_DISPUTE_PARTICIPANT';
  end if;

  return query
    select
      d.id as dispute_id,
      d.order_id,
      o.public_code as order_public_code,
      o.status as order_status,
      d.status,
      d.reason,
      d.explanation,
      d.opened_by,
      (d.opened_by = v_caller) as is_mine_opened,
      s.name as shop_name,
      bp.display_name as buyer_display_name,
      o.fulfillment_method,
      coalesce(img.image_paths, '{}'::text[]) as image_paths,
      d.created_at,
      d.resolved_at
    from public.disputes d
    join public.orders o on o.id = d.order_id
    join public.shops s on s.id = o.shop_id
    join public.profiles bp on bp.id = o.buyer_id
    left join lateral (
      select array_agg(di.storage_path order by di.created_at) as image_paths
        from public.dispute_images di
        where di.dispute_id = d.id
    ) img on true
    where d.id = p_dispute_id;
end;
$$;

revoke all on function public.get_dispute_detail(uuid) from public;
revoke all on function public.get_dispute_detail(uuid) from anon;
grant execute on function public.get_dispute_detail(uuid) to authenticated;

-- ============================================================
-- get_order_dispute_summary
-- ============================================================
-- The smallest possible lookup the order-detail UI needs: "does this
-- order already have a non-resolved-or-resolved dispute, and if so
-- which one/what status" -- so the buyer/seller order page can render
-- Open Dispute vs. a link to the existing one without waiting on the
-- full get_dispute_detail payload. Returns zero rows when no dispute
-- exists for this order at all (the common case for most orders).
create or replace function public.get_order_dispute_summary(
  p_order_id uuid
)
returns table (
  dispute_id uuid,
  status public.dispute_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_buyer_id uuid;
  v_shop_owner_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select o.buyer_id, s.owner_id into v_buyer_id, v_shop_owner_id
    from public.orders o
    join public.shops s on s.id = o.shop_id
    where o.id = p_order_id;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  if v_caller <> v_buyer_id and v_caller <> v_shop_owner_id then
    raise exception 'You do not have permission to view this order.' using detail = 'NOT_ORDER_PARTICIPANT';
  end if;

  return query
    select d.id as dispute_id, d.status
    from public.disputes d
    where d.order_id = p_order_id
    order by d.created_at desc
    limit 1;
end;
$$;

revoke all on function public.get_order_dispute_summary(uuid) from public;
revoke all on function public.get_order_dispute_summary(uuid) from anon;
grant execute on function public.get_order_dispute_summary(uuid) to authenticated;
