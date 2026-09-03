-- Corrective migration: fixes two confirmed PL/pgSQL ambiguous-column-
-- reference bugs discovered during 0021's live verification. Both are
-- the same underlying defect: an unqualified table-column reference that
-- happens to share a name with one of the function's own RETURNS TABLE
-- output columns is ambiguous in PL/pgSQL (the output column is
-- implicitly in scope as an identifier throughout the function body,
-- exactly like an OUT parameter). CREATE OR REPLACE FUNCTION only, for
-- the two functions named below. No tables, enums, triggers, indexes,
-- RLS policies, storage, cron, helper functions, or application code.
--
-- supabase/migrations/0021_order_cancellation_request_workflow.sql
-- remains completely untouched by this migration and stays exactly as
-- applied -- this is a pure follow-up correction, not a rewrite of that
-- file.
--
-- Bug A (public.request_order_cancellation): the fresh-request INSERT's
--   RETURNING id, requested_at into v_new_id, v_new_requested_at
-- left `requested_at` unqualified, colliding with this function's own
-- `requested_at timestamptz` output column -- SQLSTATE 42702, empirically
-- reproduced. Every call that would create a genuinely new pending
-- request failed; only the already-existing-pending-request idempotent
-- path (which fully qualifies every reference) was unaffected.
--
-- Bug B (public.resolve_order_cancellation): the confirm branch's
--   perform 1 from public.order_items where order_id = v_order_id ...
--   perform 1 from public.inventory_reservations where order_id = v_order_id and status = 'active' ...
--   update public.inventory_reservations set status = 'released', resolved_at = now() where order_id = v_order_id and status = 'active';
-- each left `order_id` unqualified, colliding with this function's own
-- `order_id uuid` output column. The first occurrence (the order_items
-- lock) crashed with SQLSTATE 42702 on every confirm attempt,
-- empirically reproduced; the other two were unreached but present, and
-- would have crashed identically the moment the first was fixed in
-- isolation. No call to resolve_order_cancellation(..., p_confirm =
-- true, ...) could ever succeed as previously deployed.
--
-- Full ambiguity audit performed before writing this migration: every
-- statement in both live function bodies was inspected line by line
-- against every RETURNS TABLE output column name of both functions
-- (request_id, order_id, request_status, was_already_pending,
-- requested_at, order_status, was_already_resolved, reviewed_at) plus
-- every parameter and local variable name. Parameters (p_-prefixed) and
-- local variables (v_-prefixed) carry no collision risk by construction.
-- Exactly the four occurrences named above (one in request_order_
-- cancellation, three in resolve_order_cancellation) were found to be
-- genuinely ambiguous; no additional unqualified references matching an
-- output-column name were found anywhere else in either function. Every
-- other unqualified reference in both bodies (e.g. bare `id` in `where
-- id = p_request_id`, bare `status` in `where status = 'active'`, the
-- `else status end` self-reference inside the listings UPDATE's CASE
-- expression) is safe because none of those bare names match any
-- RETURNS TABLE column of either function ("id" and "status" are not
-- "request_id"/"order_id"/etc.) -- they were left exactly as they were,
-- since qualifying an already-unambiguous reference would be an
-- unrelated stylistic change, not a correction.
--
-- Fix approach: every table reference in both function bodies now
-- carries an explicit alias, applied consistently rather than only at
-- the exact crash points, per the approved defensive standard --
-- o (orders), s (shops), ocr (order_cancellation_requests), oi
-- (order_items), ir (inventory_reservations), l (listings). This also
-- resolves the confusing prior reuse of the bare alias `r` for two
-- different tables (order_cancellation_requests in one function,
-- inventory_reservations in the other) with two distinct, self-
-- documenting aliases. The single fresh-request INSERT now names its
-- target with `AS ocr` so its RETURNING clause can unambiguously write
-- `ocr.id, ocr.requested_at`; the two previously-bare confirm-path lock
-- statements and the reservation-release UPDATE now filter through
-- `oi.order_id` / `ir.order_id` respectively. UPDATE ... SET target
-- lists are left as bare column names throughout (Postgres does not
-- accept an alias-qualified SET target, and a bare SET target is never
-- ambiguous regardless of alias presence, since it is always resolved
-- against the one table being updated).
--
-- Behavior preservation: this migration changes NOTHING beyond making
-- the previously-ambiguous statements resolve deterministically. Every
-- check, validation, lock, ordering decision, error code, timestamp
-- rule, history rule, and return shape from 0021 is reproduced exactly
-- -- authorization ordering, accepted/ready eligibility, reason
-- validation and immutability, pending-request idempotency, the request-
-- id-to-order lock-routing pattern, the order-then-request lock order,
-- resolved-request idempotency being checked before parent-order
-- eligibility, rejection's mandatory review-note requirement, the
-- reservation/item consistency guard (status = 'accepted' and quantity
-- match, ownership already guaranteed by the composite FK), the
-- accepted-item-missing-reservation tolerance, per-listing aggregation,
-- the reserved-quantity-underflow guard, the ledger-then-cache release
-- ordering, the listing-status reopening rules, stock_quantity never
-- being touched, order_items never being rewritten, the parent
-- cancelled_at/accepted_at/ready_at lifecycle-timestamp handling, the
-- single order_status_history row with note = NULL, and both functions'
-- exact typed return shapes.
--
-- Security hardening: both replacement functions remain LANGUAGE
-- plpgsql, SECURITY DEFINER, SET search_path = '', with every relation
-- fully schema-qualified and auth.uid() as the sole caller-identity
-- source. Both signatures are byte-identical to 0021 (CREATE OR REPLACE
-- FUNCTION over the same argument types, so this is a safe in-place
-- replace, not a new function). REVOKE/GRANT are repeated defensively
-- for both exact signatures, matching 0021's own privilege statements
-- exactly.

-- =============================================================================
-- public.request_order_cancellation -- Bug A fix
-- =============================================================================

create or replace function public.request_order_cancellation(
  p_order_id uuid,
  p_reason text
)
returns table (
  request_id uuid,
  order_id uuid,
  request_status public.cancellation_request_status_enum,
  was_already_pending boolean,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_reason text;
  v_existing_id uuid;
  v_existing_status public.cancellation_request_status_enum;
  v_existing_requested_at timestamptz;
  v_new_id uuid;
  v_new_requested_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id
    into v_order_status, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must be the order's buyer =====================
  if v_order_buyer_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  -- ===================== only accepted/ready orders may open a cancellation request =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state a cancellation request can be created for.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reason validation (before the existing-pending-request check) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  -- ===================== idempotency: an existing pending request wins unchanged =====================
  select ocr.id, ocr.status, ocr.requested_at
    into v_existing_id, v_existing_status, v_existing_requested_at
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending';

  if found then
    return query
      select v_existing_id, p_order_id, v_existing_status, true, v_existing_requested_at;
    return;
  end if;

  -- ===================== fresh request =====================
  -- fix: the target alias "ocr" lets RETURNING unambiguously reference the
  -- inserted row's own columns instead of colliding with this function's
  -- identically-named "requested_at" output column.
  insert into public.order_cancellation_requests as ocr (order_id, requested_by, status, reason)
    values (p_order_id, v_caller, 'pending', v_reason)
    returning ocr.id, ocr.requested_at into v_new_id, v_new_requested_at;

  return query
    select v_new_id, p_order_id, 'pending'::public.cancellation_request_status_enum, false, v_new_requested_at;
end;
$$;

revoke all on function public.request_order_cancellation(uuid, text) from public;
revoke all on function public.request_order_cancellation(uuid, text) from anon;
grant execute on function public.request_order_cancellation(uuid, text) to authenticated;

-- =============================================================================
-- public.resolve_order_cancellation -- Bug B fix
-- =============================================================================

create or replace function public.resolve_order_cancellation(
  p_request_id uuid,
  p_confirm boolean,
  p_review_note text
)
returns table (
  request_id uuid,
  order_id uuid,
  request_status public.cancellation_request_status_enum,
  order_status public.order_status_enum,
  was_already_resolved boolean,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;

  v_routed_order_id uuid;
  v_order_id uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;

  v_request_order_id uuid;
  v_request_status public.cancellation_request_status_enum;
  v_reviewed_by uuid;
  v_reviewed_at timestamptz;

  v_normalized_note text;
  v_from_status public.order_status_enum;

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
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== request-id -> order routing (unlocked, informational only) =====================
  select ocr.order_id into v_routed_order_id
    from public.order_cancellation_requests ocr
    where ocr.id = p_request_id;

  if not found then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id
    into v_order_status, v_order_shop_id
    from public.orders o
    where o.id = v_routed_order_id
    for update;

  if not found then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  -- ===================== lock request row and revalidate against the locked order =====================
  select ocr.order_id, ocr.status, ocr.reviewed_by, ocr.reviewed_at
    into v_request_order_id, v_request_status, v_reviewed_by, v_reviewed_at
    from public.order_cancellation_requests ocr
    where ocr.id = p_request_id
    for update;

  if not found or v_request_order_id is distinct from v_routed_order_id then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  v_order_id := v_routed_order_id;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this request.' using detail = 'NOT_ORDER_SELLER';
  end if;

  v_normalized_note := nullif(btrim(p_review_note), '');

  -- ===================== resolved-request idempotency =====================
  if v_request_status = 'confirmed' then
    if p_confirm then
      return query
        select p_request_id, v_order_id, v_request_status, v_order_status, true, v_reviewed_at;
      return;
    else
      raise exception 'This cancellation request has already been resolved.' using detail = 'REQUEST_ALREADY_RESOLVED';
    end if;
  elsif v_request_status = 'rejected' then
    if not p_confirm then
      return query
        select p_request_id, v_order_id, v_request_status, v_order_status, true, v_reviewed_at;
      return;
    else
      raise exception 'This cancellation request has already been resolved.' using detail = 'REQUEST_ALREADY_RESOLVED';
    end if;
  end if;

  -- ===================== request still pending: order must still be eligible =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state this cancellation request can be resolved against.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reject path =====================
  if not p_confirm then
    if v_normalized_note is null then
      raise exception 'A review note is required to reject a cancellation request.' using detail = 'INVALID_REVIEW_NOTE';
    end if;

    update public.order_cancellation_requests
      set status = 'rejected',
          reviewed_by = v_caller,
          reviewed_at = now(),
          review_note = v_normalized_note
      where id = p_request_id;

    return query
      select p_request_id, v_order_id, 'rejected'::public.cancellation_request_status_enum, v_order_status, false, now();
    return;
  end if;

  -- ===================== confirm path =====================
  v_from_status := v_order_status;

  -- fix: alias "oi" makes the order_id filter unambiguous against this
  -- function's own "order_id" output column. Their locked, stable
  -- status/quantity values back the reservation check below.
  perform 1 from public.order_items oi where oi.order_id = v_order_id order by oi.id for update;

  -- fix: alias "ir" makes the order_id filter unambiguous, same as above.
  perform 1 from public.inventory_reservations ir where ir.order_id = v_order_id and ir.status = 'active' order by ir.id for update;

  -- reservation/item consistency guard: ownership is already structurally guaranteed by
  -- inventory_reservations_order_item_ownership_fkey; only status and quantity need checking here
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

  -- aggregate release quantity per listing
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

  -- lock affected listings in deterministic order, validate, compute resulting values
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

  -- release reservations (the ledger is authoritative, updated before the cached aggregate)
  -- fix: alias "ir" makes the order_id filter unambiguous; the SET target
  -- list stays bare (Postgres does not accept alias-qualified SET targets,
  -- and a bare SET target is never ambiguous regardless of alias presence).
  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = v_order_id and ir.status = 'active';

  -- update the cached listing aggregates and reopen visibility only where safe
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

  -- parent order cancellation: status + lifecycle timestamp together, nothing else touched
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = v_order_id;

  -- request resolution
  update public.order_cancellation_requests
    set status = 'confirmed',
        reviewed_by = v_caller,
        reviewed_at = now(),
        review_note = v_normalized_note
    where id = p_request_id;

  -- exactly one parent history row
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (v_order_id, v_from_status, 'cancelled', v_caller, null);

  return query
    select p_request_id, v_order_id, 'confirmed'::public.cancellation_request_status_enum, 'cancelled'::public.order_status_enum, false, now();
end;
$$;

revoke all on function public.resolve_order_cancellation(uuid, boolean, text) from public;
revoke all on function public.resolve_order_cancellation(uuid, boolean, text) from anon;
grant execute on function public.resolve_order_cancellation(uuid, boolean, text) to authenticated;
