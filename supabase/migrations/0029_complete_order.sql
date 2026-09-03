-- Final core order-lifecycle transaction: received_confirmed -> completed.
-- Creates ONLY public.complete_order(uuid) and its grants/revokes. No
-- tables/enums/indexes/triggers/policies/helper functions/application code
-- are touched, and no existing function is modified.
--
-- Canonical recheck before writing
-- -----------------------------------------------------------------------
-- PRD 22.3/22.4: "Order becomes Completed only after buyer confirms
-- receipt. No automatic completion in MVP." / "Completed status unlocks
-- verified review eligibility." PRD 29.2: a fully committed quantity-1
-- listing becomes Sold on completion; a partially-consumed quantity>1
-- listing remains Available "until remaining available quantity reaches
-- zero." Per the locked architecture (0027's header, and this session's
-- explicit product decision), this RPC is the SECOND of two steps:
-- confirm_order_received (0027) already persists received_confirmed as a
-- durable, independently-auditable buyer action; a trusted server process
-- invokes this function immediately afterward. This function is therefore
-- the only order-lifecycle RPC in this schema with no human caller at
-- all -- it is system/service-role-only, mirroring expire_pending_orders
-- (0024), not the auth.uid()-authorized shape of every other progression
-- RPC (accept_order_items, mark_order_ready,
-- mark_order_handed_over_or_shipped, confirm_order_received).
--
-- 0028_allow_zero_listing_stock.sql was applied specifically to unblock
-- this migration: listings_stock_quantity_check now allows
-- stock_quantity = 0, so a single-unit listing's completion (stock 1 -> 0,
-- reserved 1 -> 0) no longer violates a CHECK constraint. That migration's
-- own header already documented this function's locked inventory math;
-- this migration implements it.
--
-- Pre-inspection findings (read-only, immediately before writing this
-- file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0028_allow_zero_listing_stock; this is the
-- next migration. public.complete_order does not yet exist (confirmed
-- live). orders.status/completed_at/received_confirmed_at and every other
-- lifecycle timestamp column are exactly as used by confirm_order_received
-- (0027) and mark_order_handed_over_or_shipped (0026) already. order_items
-- has no "completed" status -- order_item_status_enum remains exactly
-- {pending, accepted, declined} (confirmed live) -- so accepted items are
-- never rewritten by this function. inventory_reservation_status_enum is
-- exactly {active, released, consumed} (confirmed live) -- "consumed" is
-- reused, not invented. inventory_reservations_order_item_id_key is a
-- plain UNIQUE(order_item_id) index (confirmed live) -- at most one
-- reservation row can ever exist per order_item, so duplicate active
-- reservations for one item are structurally impossible and need no
-- runtime detection. inventory_reservations_order_item_ownership_fkey --
-- FOREIGN KEY (order_item_id, order_id, shop_id, listing_id) REFERENCES
-- order_items(id, order_id, shop_id, listing_id) -- structurally
-- guarantees that any reservation row referencing an order_item already
-- carries that order_item's own order_id/shop_id/listing_id, so a
-- listing/order/shop ownership mismatch cannot occur at runtime and needs
-- no separate check here. listings.stock_quantity/reserved_quantity
-- remain plain integer columns (default 1 / default 0); available_quantity
-- remains "generated always as (stock_quantity - reserved_quantity)
-- stored" (confirmed live, unchanged by this migration and never written
-- by it). listings_stock_quantity_check is exactly CHECK (stock_quantity
-- >= 0) (post-0028, confirmed live). listings_reserved_quantity_check
-- remains exactly CHECK (reserved_quantity >= 0 AND reserved_quantity <=
-- stock_quantity) (confirmed live, untouched). listing_status_enum remains
-- exactly {draft, available, reserved, paused, sold, archived} (confirmed
-- live) -- no additional state exists beyond what this design already
-- covers. order_status_history's shape (order_id, from_status, to_status,
-- changed_by nullable, note nullable, created_at default now()) is
-- unchanged and reused exactly as in every prior progression RPC. No
-- disputes table and no reviews table exist anywhere in this schema
-- (confirmed live) -- disputed orders are already and fully rejected by
-- this function's own generic eligibility check with zero additional
-- code, and no review row is created here.
--
-- Existing lock-order audit (read-only, against live accept_order_items /
-- cancel_accepted_order / resolve_order_cancellation source immediately
-- before writing this migration) -- no contradiction found; the sequence
-- below is reused, not reinvented:
--   1. orders row FOR UPDATE (universal serialization point)
--   2. this order's order_items rows FOR UPDATE, ORDER BY id
--   3. this order's active inventory_reservations rows FOR UPDATE, ORDER
--      BY id
--   4. validation against the locked rows (no mutation yet)
--   5. aggregate quantity per listing_id from the locked reservations,
--      ORDER BY listing_id
--   6. listings locked FOR UPDATE in a loop, ORDER BY id, one row at a
--      time, reading current values before computing new ones
-- complete_order follows this exact sequence. It has no buyer/seller
-- authorization branch (unlike every other function that reuses this
-- sequence), since it is service-role-only and calls auth.uid() nowhere.
--
-- Security: SECURITY DEFINER, SET search_path = '' with every relation
-- fully schema-qualified -- the standard hardening pattern used throughout
-- this schema. Unlike every human-facing RPC, this function never calls
-- auth.uid() and performs no runtime role check; enforcement is entirely
-- through EXECUTE privilege (REVOKE PUBLIC/anon/authenticated, GRANT
-- service_role only), mirroring expire_pending_orders (0024) exactly. No
-- client (anon or authenticated) can invoke this function at all -- it is
-- reachable only from a trusted server process holding the service-role
-- key.
--
-- Ambiguity-bug defense (0021 lesson, applied proactively): this
-- function's own RETURNS TABLE declares order_id, order_status,
-- was_already_completed, completed_at. orders.completed_at and several
-- other tables' order_id columns share names with these output columns.
-- Every table reference in this function therefore carries an explicit
-- alias, and every read of a column sharing a name with an output column
-- is alias-qualified. UPDATE ... SET target-list column names (status,
-- completed_at, stock_quantity, reserved_quantity, resolved_at) and the
-- order_status_history INSERT column list remain bare -- Postgres does not
-- accept an alias-qualified SET target or INSERT column list, and neither
-- position is ever ambiguous regardless of alias presence, exactly as
-- already proven in 0022 and reused in every migration since. The two
-- listings UPDATE statements below intentionally omit a table alias and
-- use a bare "id" WHERE target, exactly matching the unaliased shape
-- already used by cancel_accepted_order's and resolve_order_cancellation's
-- own listings UPDATE loops -- "id" is not one of this function's output
-- column names, so no ambiguity exists either way.
--
-- Caller / authorization: none. There is no human actor left to
-- authorize -- the buyer's one explicit action (confirm_order_received)
-- already happened and was durably committed in a prior, separate
-- transaction. This function trusts its caller entirely via the
-- privilege grant, per the locked two-step completion architecture.
--
-- Locking: orders row FOR UPDATE first, unconditionally -- the same
-- universal serialization point used by every order-state RPC in this
-- schema.
--
-- Idempotency: if the locked order's status is already 'completed',
-- return the current durable state unchanged -- was_already_completed =
-- true, completed_at = the existing value -- with ZERO further locking
-- and ZERO mutation, checked immediately after the order lock and before
-- any order_items/reservations/listings lock is ever acquired. This is
-- the single most safety-critical property of this function: a duplicate
-- invocation (the trusted server retrying after its own crash, or after
-- an already-completed order) must never re-consume a reservation,
-- re-decrement a quantity, or insert a second history row. Every other
-- non-received_confirmed, non-completed status raises
-- ORDER_NOT_COMPLETABLE -- 'completed' is deliberately the only status
-- treated as idempotent success, matching the same exact-target-state
-- idempotency principle already applied by every prior progression RPC in
-- this schema.
--
-- Eligibility: only 'received_confirmed' may freshly transition. Every
-- other status (pending, changes_pending, accepted, ready,
-- handed_over_or_shipped, declined, cancelled, expired, disputed) raises
-- ORDER_NOT_COMPLETABLE with zero mutation.
--
-- Accepted-item / reservation validation (the part of this function with
-- no precedent in the three prior progression RPCs, since none of them
-- touch order_items or inventory at all): after locking this order's
-- order_items, at least one 'accepted' item is required -- zero accepted
-- items is treated as corruption (RESERVATION_STATE_INVALID), not a
-- separate ORDER_NO_ACCEPTED_ITEMS code, keeping the error surface
-- minimal. After locking this order's active reservations, two guards
-- run, both zero-mutation: (1) coverage -- every accepted item must have
-- exactly one active reservation with matching quantity; a missing or
-- quantity-mismatched reservation fails the whole transaction; (2)
-- consistency -- every active reservation for this order must belong to
-- an accepted item with matching quantity; an active reservation
-- pointing at a declined or (structurally near-impossible) pending item
-- fails the whole transaction. Both guards raise RESERVATION_STATE_INVALID
-- and are checked before any mutation. Listing/order/shop ownership
-- mismatch cannot occur at all, per
-- inventory_reservations_order_item_ownership_fkey, so no runtime check
-- exists for it. Duplicate active reservations for one item cannot occur
-- at all, per inventory_reservations_order_item_id_key's plain
-- UNIQUE(order_item_id), so no runtime check exists for that either.
--
-- Aggregation: multiple accepted order_items may reference the same
-- listing (no UNIQUE(order_id, listing_id) constraint exists on
-- order_items). This order's locked active reservation quantities are
-- summed per listing_id, ORDER BY listing_id, before any listing is
-- locked or mutated -- exactly the same aggregate-then-loop shape already
-- used by accept_order_items and cancel_accepted_order.
--
-- Listing locks and numeric validation: each affected listing is locked
-- FOR UPDATE in the aggregate loop, ORDER BY id (deterministic, matching
-- every other inventory-mutating RPC in this schema, avoiding deadlock
-- against accept_order_items/cancel_accepted_order/resolve_order_cancellation/
-- a concurrent second complete_order call touching an overlapping listing
-- set). A referenced listing unexpectedly not existing is
-- RESERVATION_STATE_INVALID. For each listing, the consumed aggregate
-- quantity q must not exceed either stock_quantity or reserved_quantity --
-- otherwise RESERVATION_STATE_INVALID (no separate STOCK_STATE_INVALID
-- code). The resulting reserved_quantity <= stock_quantity relationship is
-- also explicitly re-validated after computing the new values -- this can
-- only ever hold given a valid pre-state (subtracting the same q from both
-- sides preserves the pre-existing relationship already enforced by
-- listings_reserved_quantity_check), but the check exists so that any
-- unforeseen drift surfaces as a clean RESERVATION_STATE_INVALID business
-- error rather than an uncontrolled raw CHECK-constraint violation
-- surfacing from the UPDATE statement itself.
--
-- Stock/reserved mutation: for each affected listing, stock_quantity -= q
-- and reserved_quantity -= q, applied together in one UPDATE per listing.
-- available_quantity is never written -- it remains the native GENERATED
-- column (stock_quantity - reserved_quantity) and is unaffected in net
-- terms by this pair of equal decrements (a completed order does not free
-- new availability, it permanently retires already-committed units).
--
-- Reservation consumption: this order's active reservations are updated
-- to status = 'consumed', resolved_at = the same transaction-stable
-- v_now used for completed_at -- never deleted, preserving the ledger as
-- permanent history, matching 'released' rows' existing precedent from
-- cancel_accepted_order/resolve_order_cancellation. Only this order's own
-- active reservations are ever touched; another order's active
-- reservations against a shared listing are never read for mutation
-- purposes, only for the status-algorithm check below.
--
-- Listing-status algorithm: presentation status never blocks completion
-- (a valid reservation ledger completes regardless of whether the listing
-- is available/reserved/paused/sold/archived), and this function only
-- ever WRITES a status value in exactly one case: current status =
-- 'reserved' AND, excluding this order's own reservations entirely (by
-- order_id, independent of their pre- or post-consumption row state), no
-- other 'active' reservation remains for that listing -> transition to
-- 'sold'. If another order's active reservation remains, the listing
-- stays 'reserved'. Every other current status (available, paused,
-- archived, sold, draft) is left completely untouched -- this function
-- never writes into or out of those states, exactly mirroring the existing
-- guard shape already used by accept_order_items (only ever writes
-- 'reserved' from 'available'/'reserved') and
-- cancel_accepted_order/resolve_order_cancellation (only ever writes
-- 'available' from 'reserved'). A seller/admin's deliberate paused or
-- archived override is never silently reversed by this automatic
-- lifecycle transition.
--
-- Partial acceptance: only 'accepted' order_items and their reservations
-- are ever processed. Declined items were never reserved (accept_order_items
-- only ever inserts a reservation for a finally-accepted item) and are
-- never referenced here -- they remain permanent, unread, unmutated
-- seller-decision history. order_items.status is never written by this
-- function at all -- there is no 'completed' item status, so accepted
-- items remain accepted and declined items remain declined forever.
--
-- Parent mutation (fresh transition only): one UPDATE -- status =
-- 'completed', completed_at = v_now -- in the same statement, leaving
-- accepted_at, ready_at, handed_over_or_shipped_at, received_confirmed_at,
-- and every other lifecycle timestamp untouched, per the project-wide
-- lifecycle-timestamp convention (0018).
--
-- History: exactly one order_status_history row on the fresh-transition
-- path -- from_status = 'received_confirmed', to_status = 'completed',
-- changed_by = NULL, note = NULL. changed_by is explicitly NULL, not an
-- attempted auth.uid() call (which this function never makes) -- this is
-- a system-triggered transition with no human actor to attribute, exactly
-- matching expire_pending_orders' own NULL-changed_by precedent. The
-- history INSERT is the last mutation in the function body, so a late
-- injected failure (e.g. a sentinel trigger on order_status_history) can
-- prove every prior write -- reservation consumption, listing numeric and
-- status changes, parent completion -- rolls back together as one atomic
-- unit. No history row is written on the idempotent-retry path.
--
-- Return shape: a typed table -- order_id, order_status,
-- was_already_completed, completed_at -- matching the established
-- was_already_*-plus-state-timestamp shape used by every prior
-- progression RPC. No jsonb, no consumed-reservation/item counts --
-- inventory effects remain inspectable directly via
-- inventory_reservations/order_items and do not belong in this minimal,
-- stable lifecycle contract.
--
-- Cancellation: order_cancellation_requests is never referenced anywhere
-- in this function. request_order_cancellation/cancel_accepted_order/
-- resolve_order_cancellation all remain limited to accepted/ready
-- (unchanged, not re-verified in this migration since 0027 already
-- confirmed this boundary and nothing has touched those functions since)
-- -- a legitimate pending cancellation request is structurally
-- unreachable once an order reaches received_confirmed, let alone
-- completed. Any stale/malformed request row, if one somehow exists
-- through corruption, is never inspected and never blocks this
-- transition.
--
-- Disputes: never referenced anywhere in this function, and no dispute
-- object of any kind is created. No disputes table exists. The only
-- possible representation of a dispute is orders.status = 'disputed'
-- itself, already and fully rejected by this function's own eligibility
-- check via ORDER_NOT_COMPLETABLE, with zero additional code.
--
-- Reviews: no review row is created here and no reviews table exists.
-- Completed status merely becomes the future eligibility gate a review
-- feature will check against directly (orders.status = 'completed').
--
-- Notifications: none. A future application event (fresh completion ->
-- notify buyer/seller, prompt review eligibility) belongs to application
-- code reacting after commit, per AGENTS.md's isolation principle -- an
-- idempotent retry (was_already_completed = true) must not re-notify.
--
-- Failure after buyer confirmation: if this function raises for any
-- reason (ORDER_NOT_FOUND, ORDER_NOT_COMPLETABLE, RESERVATION_STATE_INVALID,
-- or any unexpected error), the entire transaction rolls back -- orders
-- remains received_confirmed, every reservation remains exactly as it
-- was, every listing remains exactly as it was. The buyer's receipt
-- confirmation, already durably committed by confirm_order_received in a
-- prior, separate, already-committed transaction, is never lost and the
-- buyer never needs to confirm again. A trusted server may repair the
-- underlying corruption and retry complete_order(order_id) safely and
-- indefinitely -- this is the entire reason the two-step architecture was
-- locked.
--
-- Trusted-server orchestration (not implemented here, documented only):
-- after confirm_order_received returns -- whether was_already_received_confirmed
-- is true or false -- a trusted server may invoke complete_order(order_id).
-- Because this function is itself exact-target-state idempotent, invoking
-- it redundantly (after a retried confirm_order_received, or after a
-- previously failed complete_order attempt) is always safe.
--
-- Error codes: exactly ORDER_NOT_FOUND, ORDER_NOT_COMPLETABLE,
-- RESERVATION_STATE_INVALID. No NOT_AUTHENTICATED (no auth.uid() call
-- exists in this function). No NOT_ORDER_BUYER/NOT_ORDER_SELLER (no
-- human caller to authorize). No STOCK_STATE_INVALID or
-- ORDER_NO_ACCEPTED_ITEMS (both folded into RESERVATION_STATE_INVALID,
-- keeping the error surface minimal). No ORDER_DISPUTE_ACTIVE (folded
-- into the generic ORDER_NOT_COMPLETABLE eligibility rejection).
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. A successful fresh completion commits
-- reservation consumption, listing numeric/status changes, the parent
-- completed/completed_at update, and the single history row together; any
-- RAISE EXCEPTION leaves ZERO mutation.

create or replace function public.complete_order(
  p_order_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_completed boolean,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status_enum;
  v_existing_completed_at timestamptz;
  v_now timestamptz;

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
  select o.status, o.completed_at
    into v_order_status, v_existing_completed_at
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

  -- ===================== only received_confirmed orders may progress to completed =====================
  if v_order_status <> 'received_confirmed' then
    raise exception 'Order is not in a state that can be completed.' using detail = 'ORDER_NOT_COMPLETABLE';
  end if;

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
  -- ownership (order/shop/listing) is already structurally guaranteed by
  -- inventory_reservations_order_item_ownership_fkey; only status and
  -- quantity need checking here
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

  -- ===================== exactly one parent history row, last mutation for late-failure rollback testability =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'received_confirmed', 'completed', null, null);

  return query
    select p_order_id, 'completed'::public.order_status_enum, false, v_now;
end;
$$;

revoke all on function public.complete_order(uuid) from public;
revoke all on function public.complete_order(uuid) from anon;
revoke all on function public.complete_order(uuid) from authenticated;
grant execute on function public.complete_order(uuid) to service_role;
