-- Seller direct cancellation of an accepted/ready order. Creates ONLY the
-- function and its grants/revokes. No shared reservation-release helper,
-- no progression/expiry/completion RPCs, no notification logic, no
-- tables/enums/indexes/triggers/policies, no application code, no
-- changes to any existing function (resolve_order_cancellation included).
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 23.2 / ARCHITECTURE_ESSENTIALS 15: "Seller may cancel an accepted
-- order and must choose a reason such as: Item unavailable / Buyer
-- requested cancellation / Unable to fulfill / Other" -- an explicit,
-- non-exhaustive ("such as") reason list, confirming free-text storage
-- is correct, not a closed enum. PRD's listing-status rule ("Cancelled
-- accepted order may return listing to Available") matches the reopening
-- behavior already proven in resolve_order_cancellation. Per the approved
-- design, eligibility is extended from PRD's literal "accepted order" to
-- "accepted or ready" for the same reason already applied to the buyer
-- cancellation-request workflow (0021): a pending buyer request can only
-- exist while the order is accepted/ready, and seller direct cancellation
-- must be able to reach every state a pending request could be sitting
-- in, to resolve it. No contradiction found; nothing beyond the approved
-- design is invented here.
--
-- =============================================================================
-- public.cancel_accepted_order
-- =============================================================================
--
-- Signature: p_order_id uuid, p_reason text (reason mandatory). Handles
-- exactly one thing: a seller directly cancelling their own accepted/
-- ready order, with or without an existing buyer cancellation request.
-- It is deliberately NOT a substitute for cancel_pending_order,
-- cancel_order_changes, or the buyer request_order_cancellation /
-- resolve_order_cancellation pair -- each already owns its own distinct
-- lifecycle territory.
--
-- Security: identical hardening to every prior RPC in this schema --
-- SECURITY DEFINER, SET search_path = '' with every reference fully
-- schema-qualified, auth.uid() as the sole identity source, EXECUTE
-- revoked from PUBLIC/anon and granted only to authenticated. No admin
-- bypass.
--
-- Ambiguity-bug defense (0021 lesson applied proactively): this function's
-- own RETURNS TABLE declares order_id and cancelled_at -- both real
-- column names on tables this function reads and writes
-- (order_cancellation_requests.order_id, order_items.order_id,
-- inventory_reservations.order_id, orders.cancelled_at). Every table
-- reference in this function therefore carries an explicit alias (o for
-- orders, s for shops, ocr for order_cancellation_requests, oi for
-- order_items, ir for inventory_reservations, l for listings) and every
-- read of a column sharing a name with an output column is alias-
-- qualified. UPDATE ... SET target lists are the one place bare column
-- names remain (status, cancelled_at, reserved_quantity, reviewed_at,
-- etc.) -- Postgres does not accept an alias-qualified SET target, and a
-- bare SET target is never ambiguous regardless of alias presence, since
-- it always resolves against the one table being updated (the same
-- reasoning already documented and empirically proven in 0022).
--
-- Authorization: caller must own orders.shop_id -> shops.owner_id,
-- derived from the LOCKED orders row. A buyer or any unrelated user
-- fails with NOT_ORDER_SELLER. No client-supplied id trusted.
--
-- Locking: the orders row is locked FOR UPDATE immediately after
-- authentication -- the universal serialization point shared by every
-- order-state RPC in this schema, serializing this function against
-- request_order_cancellation, resolve_order_cancellation, any future
-- progression RPC, and concurrent direct-cancel attempts.
--
-- Idempotency: if the locked order's status is already 'cancelled',
-- return the current durable state unchanged -- was_already_cancelled =
-- true, cancelled_at = the existing value -- with ZERO mutation,
-- regardless of which path originally produced that state (buyer
-- pending-cancel, buyer changes_pending-cancel, buyer request
-- confirmation, this function, or any future valid cancellation path).
-- This check runs before eligibility and before reason validation,
-- matching cancel_pending_order/cancel_order_changes' own idempotency-
-- first precedent -- an already-cancelled order needs no reason to
-- acknowledge it is cancelled.
--
-- Eligibility: only 'accepted' or 'ready' may be seller-cancelled through
-- this function; every other non-cancelled status (pending,
-- changes_pending, handed_over_or_shipped, received_confirmed, completed,
-- declined, expired, disputed) raises ORDER_NOT_CANCELLABLE. Disputed
-- orders are deliberately excluded -- dispute resolution owns that state,
-- not this function.
--
-- Reason validation: p_reason is normalized with btrim() and rejected as
-- INVALID_CANCELLATION_REASON if NULL, empty, or whitespace-only -- no
-- invented minimum length beyond non-blank. Validated after the
-- idempotency and eligibility checks (so a caller retrying against an
-- already-cancelled order never fails on reason, and a caller targeting
-- an ineligible order sees the more fundamental ORDER_NOT_CANCELLABLE
-- first), and before any lock or mutation beyond the orders row itself.
--
-- Reason storage: the trimmed reason is stored durably in
-- order_status_history.note on the single parent-transition history row
-- -- no new table, no new column, no cancellation-request row created
-- merely to hold it. order_status_history.note already exists precisely
-- for this purpose (0013: "free-text context for a transition"), and is
-- already the natural audit/dashboard/buyer-display source for every
-- other order-timeline event. This intentionally differs from the buyer-
-- request-confirmation path (resolve_order_cancellation writes note =
-- NULL, because that reason already lives on the request row) -- here
-- there may be no request row at all, so history.note is the reason's
-- primary and only durable home.
--
-- Pending buyer cancellation request interaction: after the eligibility
-- and reason checks, the current pending order_cancellation_requests row
-- for this order (at most one, enforced by the existing partial unique
-- index) is looked up and locked FOR UPDATE if it exists -- a plain read
-- otherwise. Its presence never blocks seller direct cancellation. On
-- successful cancellation, if a pending request existed, it is resolved
-- as status = 'confirmed', reviewed_by = the seller, reviewed_at =
-- now(), review_note = the SAME trimmed seller reason (a natural, non-
-- duplicative fit -- review_note's designed purpose is "context from
-- whoever resolves the request," which the seller's own cancellation
-- reason directly satisfies). requested_by, reason, and requested_at on
-- the request row are left completely untouched -- the buyer's original
-- ask remains a permanent historical fact. No order_status_history row is
-- written for this side effect -- the request row itself is the durable
-- record of it. Historical rejected or already-confirmed request rows
-- are never inspected or touched; only a genuinely 'pending' row (if one
-- exists) is ever written.
--
-- Reservation release: duplicates (does not refactor or call into) the
-- proven confirm-path logic from resolve_order_cancellation (0021/0022)
-- -- lock this order's order_items FOR UPDATE ORDER BY id, lock this
-- order's active inventory_reservations FOR UPDATE ORDER BY id, validate
-- every active reservation's owning item is genuinely 'accepted' with a
-- matching quantity (mismatch -> RESERVATION_STATE_INVALID; ownership is
-- already structurally guaranteed by the composite FK
-- inventory_reservations_order_item_ownership_fkey, so only status and
-- quantity need runtime checking), tolerate an accepted item with no
-- active reservation (nothing to release, nothing at risk -- APPROVED
-- TOLERANCE, not repaired, not fabricated). Release aggregates are
-- computed per listing (never assuming one reservation per listing), and
-- each affected listing must show reserved_quantity >= the aggregate
-- being released, else RESERVATION_STATE_INVALID -- never clamped to
-- zero. Reservations are released (status = 'released', resolved_at =
-- now()) before the cached listings.reserved_quantity is decremented --
-- ledger first, cache second, matching every prior inventory-mutating
-- RPC in this schema. stock_quantity is never touched. The listing-
-- status reopening rule reopens 'reserved' to 'available' only when the
-- resulting available_quantity > 0; 'paused', 'archived', and 'sold' are
-- never reopened. The "reserved remains reserved after this order's own
-- positive release" outcome is intentionally NOT special-cased: it is
-- structurally unreachable under the existing reserved_quantity <=
-- stock_quantity CHECK constraint (already proven in the 0022
-- verification task), so no logic is written for an impossible state.
--
-- order_items: never written. Accepted stays accepted, declined stays
-- declined -- item rows are permanent seller-decision history regardless
-- of how the parent order is later cancelled.
--
-- Parent mutation: one UPDATE -- status = 'cancelled', cancelled_at =
-- now() -- leaving accepted_at, ready_at, and every other lifecycle
-- timestamp untouched, per the project-wide lifecycle-timestamp
-- convention (0018).
--
-- History: exactly one order_status_history row -- from_status = the
-- order's actual captured prior status ('accepted' or 'ready'), to_status
-- = 'cancelled', changed_by = the seller's auth.uid(), note = the
-- trimmed seller reason. No per-item history, no second row for the
-- cancellation-request auto-confirmation.
--
-- Race interactions (all resolved deterministically by the shared
-- orders-row-lock-first discipline, requiring no special-casing beyond
-- each function's own existing checks): a buyer request that wins the
-- lock first leaves a pending request this function later finds and
-- resolves; if this function wins first, a buyer's later request attempt
-- observes a non-accepted/non-ready order and raises
-- ORDER_NOT_CANCELLABLE, and no request row is ever created. A later
-- resolve_order_cancellation(request_id, true, ...) call against a
-- request this function auto-confirmed is handled entirely by that
-- function's existing, unmodified, purely state-based idempotency check
-- (it does not distinguish who or what produced the 'confirmed' state)
-- -- it returns idempotent success with was_already_resolved = true. A
-- later resolve_order_cancellation(request_id, false, ...) against that
-- same auto-confirmed request hits that function's existing mismatched-
-- idempotency branch and raises REQUEST_ALREADY_RESOLVED. If a seller
-- rejects a request first (via resolve_order_cancellation), the order
-- remains accepted/ready and this function may still be called
-- afterward for an independent seller reason, leaving the rejected
-- request permanently untouched. A pending buyer request freezes future
-- progression RPCs (0021's forward requirement) but never blocks this
-- function -- seller direct cancellation is not progression, it is the
-- mechanism that resolves the freeze.
--
-- Notifications: none. Future application events (fresh seller
-- cancellation -> notify buyer) belong to application code reacting
-- after commit, per AGENTS.md's isolation principle. A single
-- notification is expected to suffice even when a pending request was
-- auto-confirmed as a side effect -- not implemented here.
--
-- Return shape: a typed table -- order_id, order_status,
-- was_already_cancelled, cancelled_at -- matching cancel_order_changes/
-- cancel_pending_order's established shape exactly. No reason, no
-- resolved-request id, no released-reservation count -- all secondary
-- details the caller does not need synchronously.
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. A successful fresh cancellation
-- commits every reservation release, every affected listing's
-- reserved_quantity/status update, the parent order update, the request
-- auto-confirmation (if applicable), and the single history row
-- together; any RAISE EXCEPTION (including RESERVATION_STATE_INVALID and
-- ORDER_NOT_CANCELLABLE) leaves ZERO mutation.

create or replace function public.cancel_accepted_order(
  p_order_id uuid,
  p_reason text
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_cancelled boolean,
  cancelled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_existing_cancelled_at timestamptz;
  v_reason text;
  v_req_id uuid;
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

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.cancelled_at
    into v_order_status, v_order_shop_id, v_existing_cancelled_at
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-cancelled is success, zero mutation, origin-agnostic =====================
  if v_order_status = 'cancelled' then
    return query
      select p_order_id, v_order_status, true, v_existing_cancelled_at;
    return;
  end if;

  -- ===================== only accepted/ready orders may be seller-cancelled here =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state that can be directly cancelled.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reason validation (after idempotency/eligibility, before any lock beyond orders) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  v_from_status := v_order_status;

  -- ===================== lock the current pending buyer cancellation request, if any =====================
  select ocr.id into v_req_id
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
    for update;

  -- ===================== lock this order's order_items (their locked status/quantity back the reservation check below) =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  -- ===================== lock this order's active reservations =====================
  perform 1 from public.inventory_reservations ir where ir.order_id = p_order_id and ir.status = 'active' order by ir.id for update;

  -- ===================== reservation/item consistency guard =====================
  -- ownership is already structurally guaranteed by inventory_reservations_order_item_ownership_fkey;
  -- only status and quantity need checking here
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

  -- ===================== aggregate release quantity per listing =====================
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

  -- ===================== lock affected listings in deterministic order, validate, compute resulting values =====================
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

  -- ===================== release reservations (the ledger is authoritative, updated before the cached aggregate) =====================
  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = p_order_id and ir.status = 'active';

  -- ===================== update the cached listing aggregates and reopen visibility only where safe =====================
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

  -- ===================== parent order cancellation: status + lifecycle timestamp together, nothing else touched =====================
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  -- ===================== auto-confirm the pending buyer cancellation request, if one existed =====================
  if v_req_id is not null then
    update public.order_cancellation_requests
      set status = 'confirmed',
          reviewed_by = v_caller,
          reviewed_at = now(),
          review_note = v_reason
      where id = v_req_id;
  end if;

  -- ===================== exactly one parent history row, carrying the seller's reason =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_from_status, 'cancelled', v_caller, v_reason);

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false, now();
end;
$$;

revoke all on function public.cancel_accepted_order(uuid, text) from public;
revoke all on function public.cancel_accepted_order(uuid, text) from anon;
grant execute on function public.cancel_accepted_order(uuid, text) to authenticated;
