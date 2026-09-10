-- Disputes MVP, admin-facing RPCs (PRD 34.4, ARCHITECTURE S20, PRD 41):
-- get_admin_disputes, get_admin_dispute_detail, get_admin_dispute_messages,
-- add_dispute_admin_note, update_dispute_status, admin_cancel_disputed_order,
-- admin_complete_disputed_order. Also widens complete_order (0029/0040/0065)
-- to accept a 'disputed' order as a valid entry status, via CREATE OR
-- REPLACE under its identical signature -- 0029/0040/0065 are never
-- edited, per this project's locked "never edit an already-applied
-- migration" rule.
--
-- Pre-inspection: migration history ends at 0074_dispute_rpcs (confirmed
-- live, no drift). complete_order's current live body confirmed exactly
-- as 0065 left it (service_role-only, no auth.uid() check of its own,
-- Trusted Seller recalculation call, both-party order_completed
-- notifications, hardcoded from_status='received_confirmed' in its own
-- order_status_history insert).
--
-- Admin authorization -- identical to every admin RPC in 0067/0070
-- -----------------------------------------------------------------------
-- `exists (select 1 from public.user_roles ur where ur.user_id = v_caller)`
-- -- the same role-agnostic check used everywhere else in this schema.
--
-- Why complete_order is widened here (safe reuse) but cancel_accepted_order
-- is NOT (a fresh function instead)
-- -----------------------------------------------------------------------
-- complete_order has no caller-identity check of its own at all -- it is
-- granted only to service_role and is designed to be invoked from within
-- another already-authorized SECURITY DEFINER function (confirm_order_received
-- calls it today). Widening its *entry status* precondition to also accept
-- 'disputed' (in addition to 'received_confirmed') is a precondition-only
-- change: admin_complete_disputed_order below performs its own full
-- admin-authorization check before ever calling it, exactly the same
-- shape confirm_order_received already establishes for the buyer path.
-- The from_status recorded in complete_order's own order_status_history
-- insert is changed from a hardcoded 'received_confirmed' literal to a
-- captured v_from_status variable (mirroring cancel_accepted_order's own
-- convention) so a disputed-order completion's history row honestly
-- reads from_status = 'disputed', not a false 'received_confirmed'.
-- Every other line of complete_order's body -- reservation arithmetic,
-- Trusted Seller recalculation, both-party notifications -- is
-- byte-for-byte unchanged; a normal received_confirmed completion is
-- completely unaffected.
--
-- cancel_accepted_order, in contrast, has its seller-ownership check
-- (`v_shop_owner_id is distinct from v_caller` -> NOT_ORDER_SELLER) baked
-- directly into the same function that does the cancellation -- there is
-- no clean way to widen its *entry status* without also touching its
-- *authorization*, which would be a real, risk-bearing behavior change to
-- an existing, already-shipped seller-facing capability, not a narrow
-- precondition widening. admin_cancel_disputed_order below is therefore a
-- fresh function with its own admin-authorization check, duplicating only
-- the (short, well-understood) reservation-release arithmetic block --
-- the safer choice given the two functions' authorization models
-- genuinely differ.
--
-- Messages context (PRD 34.4 "Review relevant messages/history")
-- -----------------------------------------------------------------------
-- No admin message-reading RPC exists anywhere in this schema today --
-- get_admin_dispute_messages is the smallest one: given a dispute, it
-- resolves the underlying order's buyer/shop, finds every conversation
-- between that exact buyer and that exact shop (both listing_inquiry and
-- general_shop), and returns their messages oldest-first, admin-
-- authorized only. It is a read-only, dispute-scoped view -- it does not
-- reuse or alter get_conversation_context/get_conversation_messages
-- (buyer/seller-facing, participant-authorized) at all.
--
-- Resolving vs. order-status actions remain independent (see 0074's own
-- header) -- update_dispute_status never touches orders.status;
-- admin_cancel_disputed_order/admin_complete_disputed_order never touch
-- disputes.status. Admin may call any subset of these three actions in
-- any order canon permits.

-- ============================================================
-- get_admin_disputes
-- ============================================================
create or replace function public.get_admin_disputes(
  p_status public.dispute_status_enum default null,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  dispute_id uuid,
  order_id uuid,
  order_public_code text,
  order_status public.order_status_enum,
  status public.dispute_status_enum,
  reason text,
  opener_display_name text,
  shop_name text,
  buyer_display_name text,
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
      d.id as dispute_id,
      d.order_id,
      o.public_code as order_public_code,
      o.status as order_status,
      d.status,
      d.reason,
      op.display_name as opener_display_name,
      s.name as shop_name,
      bp.display_name as buyer_display_name,
      d.created_at
    from public.disputes d
    join public.orders o on o.id = d.order_id
    join public.shops s on s.id = o.shop_id
    join public.profiles bp on bp.id = o.buyer_id
    join public.profiles op on op.id = d.opened_by
    where (p_status is null or d.status = p_status)
      and (
        p_before_created_at is null
        or (d.created_at, d.id) < (p_before_created_at, p_before_id)
      )
    order by d.created_at desc, d.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_admin_disputes(public.dispute_status_enum, integer, timestamptz, uuid) from public;
revoke all on function public.get_admin_disputes(public.dispute_status_enum, integer, timestamptz, uuid) from anon;
grant execute on function public.get_admin_disputes(public.dispute_status_enum, integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_admin_dispute_detail
-- ============================================================
create or replace function public.get_admin_dispute_detail(
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
  opener_display_name text,
  shop_id uuid,
  shop_name text,
  shop_owner_id uuid,
  shop_owner_display_name text,
  buyer_id uuid,
  buyer_display_name text,
  fulfillment_method public.fulfillment_method_enum,
  image_paths text[],
  admin_notes jsonb,
  resolved_by uuid,
  resolved_by_display_name text,
  resolved_at timestamptz,
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

  if not exists (select 1 from public.disputes d where d.id = p_dispute_id) then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
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
      op.display_name as opener_display_name,
      s.id as shop_id,
      s.name as shop_name,
      s.owner_id as shop_owner_id,
      sop.display_name as shop_owner_display_name,
      o.buyer_id,
      bp.display_name as buyer_display_name,
      o.fulfillment_method,
      coalesce(img.image_paths, '{}'::text[]) as image_paths,
      coalesce(notes.admin_notes, '[]'::jsonb) as admin_notes,
      d.resolved_by,
      resp.display_name as resolved_by_display_name,
      d.resolved_at,
      d.created_at
    from public.disputes d
    join public.orders o on o.id = d.order_id
    join public.shops s on s.id = o.shop_id
    join public.profiles bp on bp.id = o.buyer_id
    join public.profiles op on op.id = d.opened_by
    join public.profiles sop on sop.id = s.owner_id
    left join public.profiles resp on resp.id = d.resolved_by
    left join lateral (
      select array_agg(di.storage_path order by di.created_at) as image_paths
        from public.dispute_images di
        where di.dispute_id = d.id
    ) img on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'note', dan.note,
          'adminDisplayName', ap.display_name,
          'createdAt', dan.created_at
        )
        order by dan.created_at
      ) as admin_notes
        from public.dispute_admin_notes dan
        join public.profiles ap on ap.id = dan.admin_id
        where dan.dispute_id = d.id
    ) notes on true
    where d.id = p_dispute_id;
end;
$$;

revoke all on function public.get_admin_dispute_detail(uuid) from public;
revoke all on function public.get_admin_dispute_detail(uuid) from anon;
grant execute on function public.get_admin_dispute_detail(uuid) to authenticated;

-- ============================================================
-- get_admin_dispute_messages
-- ============================================================
create or replace function public.get_admin_dispute_messages(
  p_dispute_id uuid
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  is_from_buyer boolean,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_id uuid;
  v_buyer_id uuid;
  v_shop_id uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  select d.order_id into v_order_id
    from public.disputes d
    where d.id = p_dispute_id;

  if not found then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
  end if;

  select o.buyer_id, o.shop_id into v_buyer_id, v_shop_id
    from public.orders o
    where o.id = v_order_id;

  return query
    select
      m.id as message_id,
      m.conversation_id,
      m.sender_id,
      (m.sender_id = v_buyer_id) as is_from_buyer,
      m.body,
      m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.initiator_id = v_buyer_id
      and c.shop_id = v_shop_id
    order by m.created_at asc, m.id asc
    limit 200;
end;
$$;

revoke all on function public.get_admin_dispute_messages(uuid) from public;
revoke all on function public.get_admin_dispute_messages(uuid) from anon;
grant execute on function public.get_admin_dispute_messages(uuid) to authenticated;

-- ============================================================
-- add_dispute_admin_note
-- ============================================================
create or replace function public.add_dispute_admin_note(
  p_dispute_id uuid,
  p_note text
)
returns table (
  note_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_note text;
  v_note_id uuid;
  v_created_at timestamptz;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  if not exists (select 1 from public.disputes d where d.id = p_dispute_id) then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
  end if;

  v_note := btrim(p_note);
  if v_note is null or length(v_note) = 0 then
    raise exception 'A note is required.' using detail = 'NOTE_REQUIRED';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'Please shorten the note.' using detail = 'NOTE_TOO_LONG';
  end if;

  insert into public.dispute_admin_notes (dispute_id, admin_id, note)
    values (p_dispute_id, v_caller, v_note)
    returning id, created_at into v_note_id, v_created_at;

  return query
    select v_note_id, v_created_at;
end;
$$;

revoke all on function public.add_dispute_admin_note(uuid, text) from public;
revoke all on function public.add_dispute_admin_note(uuid, text) from anon;
grant execute on function public.add_dispute_admin_note(uuid, text) to authenticated;

-- ============================================================
-- update_dispute_status
-- ============================================================
-- Forward-only: opened -> under_review, opened -> resolved, or
-- under_review -> resolved. Never backward (e.g. resolved -> opened),
-- matching PRD 34.3's own linear "Opened -> Under Review -> Resolved"
-- timeline. Never touches orders.status -- see this file's own header.
create or replace function public.update_dispute_status(
  p_dispute_id uuid,
  p_status public.dispute_status_enum
)
returns table (
  dispute_id uuid,
  status public.dispute_status_enum,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_current_status public.dispute_status_enum;
  v_now timestamptz;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  -- ===================== lock the dispute row =====================
  select d.status into v_current_status
    from public.disputes d
    where d.id = p_dispute_id
    for update;

  if not found then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
  end if;

  -- ===================== idempotency: setting the same status is a safe no-op =====================
  if v_current_status = p_status then
    return query
      select p_dispute_id, v_current_status, (select d2.resolved_at from public.disputes d2 where d2.id = p_dispute_id);
    return;
  end if;

  -- ===================== forward-only transition guard =====================
  if v_current_status = 'resolved' then
    raise exception 'This dispute is already resolved.' using detail = 'DISPUTE_ALREADY_RESOLVED';
  end if;

  if v_current_status = 'under_review' and p_status = 'opened' then
    raise exception 'A dispute cannot move backward to Opened.' using detail = 'DISPUTE_STATUS_BACKWARD_NOT_ALLOWED';
  end if;

  v_now := now();

  if p_status = 'resolved' then
    update public.disputes
      set status = 'resolved',
          resolved_by = v_caller,
          resolved_at = v_now
      where id = p_dispute_id;
  else
    update public.disputes
      set status = p_status
      where id = p_dispute_id;
  end if;

  insert into public.dispute_status_history (dispute_id, from_status, to_status, changed_by)
    values (p_dispute_id, v_current_status, p_status, v_caller);

  -- ===================== notification: both order participants, only when resolved =====================
  if p_status = 'resolved' then
    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select o.buyer_id, 'dispute_resolved', v_caller, o.id, p_dispute_id::text || ':resolved'
      from public.disputes d
      join public.orders o on o.id = d.order_id
      where d.id = p_dispute_id
        and not exists (select 1 from public.profiles p where p.id = o.buyer_id and p.deleted_at is not null)
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select s.owner_id, 'dispute_resolved', v_caller, o.id, p_dispute_id::text || ':resolved'
      from public.disputes d
      join public.orders o on o.id = d.order_id
      join public.shops s on s.id = o.shop_id
      where d.id = p_dispute_id
        and not exists (select 1 from public.profiles p where p.id = s.owner_id and p.deleted_at is not null)
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;
  end if;

  return query
    select p_dispute_id, p_status, (case when p_status = 'resolved' then v_now else null end);
end;
$$;

revoke all on function public.update_dispute_status(uuid, public.dispute_status_enum) from public;
revoke all on function public.update_dispute_status(uuid, public.dispute_status_enum) from anon;
grant execute on function public.update_dispute_status(uuid, public.dispute_status_enum) to authenticated;

-- ============================================================
-- admin_cancel_disputed_order
-- ============================================================
-- Fresh function, not a widened cancel_accepted_order -- see this file's
-- own header for why. Only a currently-'disputed' order is eligible
-- (an admin cancelling a non-disputed order via this path would be
-- reaching outside this task's own scope, "cancel order where canon
-- permits" -- canon permits it specifically as a dispute-resolution
-- action, PRD 34.4).
create or replace function public.admin_cancel_disputed_order(
  p_dispute_id uuid,
  p_reason text
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_id uuid;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_reason text;
  v_now timestamptz;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_available integer[] := '{}';
  v_old_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;

  i integer;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  select d.order_id into v_order_id
    from public.disputes d
    where d.id = p_dispute_id;

  if not found then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id, o.shop_id
    into v_order_status, v_order_buyer_id, v_order_shop_id
    from public.orders o
    where o.id = v_order_id
    for update;

  if v_order_status <> 'disputed' then
    raise exception 'Order is not in a state that can be cancelled from a dispute.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  -- ===================== lock this order's order_items/active reservations (same shape as cancel_accepted_order) =====================
  perform 1 from public.order_items oi where oi.order_id = v_order_id order by oi.id for update;
  perform 1 from public.inventory_reservations ir where ir.order_id = v_order_id and ir.status = 'active' order by ir.id for update;

  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = v_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = v_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing reserved quantity is insufficient to release.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);
    v_new_available := v_new_available || (v_stock_qty - (v_reserved_qty - v_agg_qtys[i]));
    v_old_status := v_old_status || v_listing_status;
  end loop;

  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = v_order_id and ir.status = 'active';

  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set reserved_quantity = v_new_reserved[i],
          status = case
            when v_old_status[i] = 'reserved' and v_new_available[i] > 0
              then 'available'::public.listing_status_enum
            else status
          end
      where id = v_listing_ids[i];
  end loop;

  v_now := now();

  update public.orders
    set status = 'cancelled',
        cancelled_at = v_now
    where id = v_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (v_order_id, 'disputed', 'cancelled', v_caller, v_reason);

  -- ===================== notifications: both parties (admin is the actor, neither is self-notifying) =====================
  select s.owner_id into v_shop_owner_id from public.shops s where s.id = v_order_shop_id;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_cancelled', v_caller, v_order_id, v_order_id::text || ':cancelled'
  where not exists (select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null)
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_shop_owner_id, 'order_cancelled', v_caller, v_order_id, v_order_id::text || ':cancelled'
  where not exists (select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null)
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_order_id, 'cancelled'::public.order_status_enum, v_now;
end;
$$;

revoke all on function public.admin_cancel_disputed_order(uuid, text) from public;
revoke all on function public.admin_cancel_disputed_order(uuid, text) from anon;
grant execute on function public.admin_cancel_disputed_order(uuid, text) to authenticated;

-- ============================================================
-- admin_complete_disputed_order
-- ============================================================
-- Admin-authorizes, then delegates entirely to complete_order (widened
-- below) -- no reservation/stock arithmetic duplicated here at all.
create or replace function public.admin_complete_disputed_order(
  p_dispute_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_id uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  select d.order_id into v_order_id
    from public.disputes d
    where d.id = p_dispute_id;

  if not found then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
  end if;

  return query
    select c.order_id, c.order_status, c.completed_at
    from public.complete_order(v_order_id) c;
end;
$$;

revoke all on function public.admin_complete_disputed_order(uuid) from public;
revoke all on function public.admin_complete_disputed_order(uuid) from anon;
grant execute on function public.admin_complete_disputed_order(uuid) to authenticated;

-- ============================================================
-- complete_order (widened: 'disputed' is now also a valid entry status)
-- ============================================================
create or replace function public.complete_order(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_completed boolean, completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status_enum;
  v_existing_completed_at timestamptz;
  v_now timestamptz;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_from_status public.order_status_enum;

  v_accepted_count integer;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_stock integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;
  v_other_active_exists boolean;

  i integer;
begin
  -- ===================== lock order row (universal serialization point; service-role only, no auth.uid()) =====================
  select o.status, o.completed_at, o.buyer_id, o.shop_id
    into v_order_status, v_existing_completed_at, v_order_buyer_id, v_order_shop_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== idempotency: already-completed is success, zero mutation, checked before any deeper lock =====================
  if v_order_status = 'completed' then
    return query
      select p_order_id, v_order_status, true, v_existing_completed_at;
    return;
  end if;

  -- ===================== received_confirmed OR disputed orders may progress to completed (widened for admin dispute resolution, PRD 34.4) =====================
  if v_order_status not in ('received_confirmed', 'disputed') then
    raise exception 'Order is not in a state that can be completed.' using detail = 'ORDER_NOT_COMPLETABLE';
  end if;

  v_from_status := v_order_status;

  -- ===================== transaction-stable time, captured after eligibility, before deeper locking/mutation =====================
  v_now := now();

  -- ===================== lock this order's order_items (their locked status/quantity back every check below) =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  -- ===================== at least one accepted item is required =====================
  select count(*) into v_accepted_count
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'accepted';

  if v_accepted_count = 0 then
    raise exception 'Order has no accepted items to complete.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== lock this order's active reservations =====================
  perform 1 from public.inventory_reservations ir where ir.order_id = p_order_id and ir.status = 'active' order by ir.id for update;

  -- ===================== coverage guard: every accepted item must have exactly one matching active reservation =====================
  if exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.status = 'accepted'
      and not exists (
        select 1
        from public.inventory_reservations ir
        where ir.order_item_id = oi.id
          and ir.status = 'active'
          and ir.quantity = oi.quantity
      )
  ) then
    raise exception 'An accepted item is missing a valid active reservation.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== consistency guard: every active reservation for this order must belong to an accepted item with matching quantity =====================
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = p_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== aggregate consumed quantity per listing from this order's locked active reservations =====================
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = p_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- ===================== lock affected listings in deterministic order, validate arithmetic, compute resulting values =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if not found then
      raise exception 'Reserved listing no longer exists.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    if v_stock_qty < v_agg_qtys[i] or v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing stock/reserved quantity is insufficient to complete.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    if (v_stock_qty - v_agg_qtys[i]) < (v_reserved_qty - v_agg_qtys[i]) then
      raise exception 'Resulting listing quantities would be inconsistent.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_stock := v_new_stock || (v_stock_qty - v_agg_qtys[i]);
    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);

    -- status algorithm: only 'reserved' with no other order's active
    -- reservation remaining transitions to 'sold'; every other current
    -- status (available/paused/archived/sold/draft) is left untouched
    select exists (
      select 1
      from public.inventory_reservations ir2
      where ir2.listing_id = v_listing_ids[i]
        and ir2.status = 'active'
        and ir2.order_id <> p_order_id
    ) into v_other_active_exists;

    v_new_status := v_new_status || (
      case
        when v_listing_status = 'reserved' and not v_other_active_exists
          then 'sold'::public.listing_status_enum
        else v_listing_status
      end
    );
  end loop;

  -- ===================== consume this order's active reservations (the ledger is authoritative, updated before the cached aggregates) =====================
  update public.inventory_reservations ir
    set status = 'consumed',
        resolved_at = v_now
    where ir.order_id = p_order_id and ir.status = 'active';

  -- ===================== apply computed stock/reserved/status per listing =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set stock_quantity = v_new_stock[i],
          reserved_quantity = v_new_reserved[i],
          status = v_new_status[i]
      where id = v_listing_ids[i];
  end loop;

  -- ===================== parent completion: status + lifecycle timestamp together, nothing else touched =====================
  update public.orders as o
    set status = 'completed',
        completed_at = v_now
    where o.id = p_order_id;

  -- ===================== recalculate Trusted Seller eligibility now that this shop's completed-order count may have changed =====================
  perform public.recalculate_trusted_seller(v_order_shop_id);

  -- ===================== exactly one parent history row, honest from_status (widened: was a hardcoded 'received_confirmed' literal) =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_from_status, 'completed', null, null);

  -- ===================== notifications: both buyer and seller receive completion event =====================
  -- actor is NULL: this function has no auth.uid() (trusted/system-callable
  -- path per its own existing comment), so fabricating an actor would be
  -- incorrect rather than merely incomplete.
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_completed', null, p_order_id, p_order_id::text || ':completed'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_shop_owner_id, 'order_completed', null, p_order_id, p_order_id::text || ':completed'
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'completed'::public.order_status_enum, false, v_now;
end;
$$;

revoke all on function public.complete_order(uuid) from public;
revoke all on function public.complete_order(uuid) from anon;
revoke all on function public.complete_order(uuid) from authenticated;
grant execute on function public.complete_order(uuid) to service_role;
