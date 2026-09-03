-- The accepted/ready-order buyer cancellation-request workflow: two
-- trusted RPCs. Creates ONLY these functions and their grants/revokes.
-- No seller direct-cancel RPC, no order progression RPCs, no expiry RPC,
-- no completion RPC, no shared reservation-release helper, no
-- notification logic, no tables/enums/triggers/indexes/policies/cron.
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 22 lists `Accepted/Ready/etc. -> Cancelled` alongside
-- `Accepted -> Cancellation Requested` as valid outcomes, and PRD 23.1/
-- ARCHITECTURE_ESSENTIALS 15 confirm that after acceptance the buyer
-- submits a request the seller must confirm (never a direct cancel).
-- Per the approved product model, cancellation requests operate only
-- while the parent order is 'accepted' or 'ready' -- once
-- handed_over_or_shipped, a cancellation request is no longer offered
-- (that territory belongs to disputes/returns, a separate PRD 34 flow
-- this migration does not touch). No contradiction found; nothing beyond
-- the approved design is invented here.
--
-- =============================================================================
-- public.request_order_cancellation
-- =============================================================================
--
-- Signature: p_order_id uuid, p_reason text (reason mandatory, no
-- optional-reason path). Handles exactly one thing: opening a pending
-- cancellation request against an accepted/ready order. It never mutates
-- orders, order_items, inventory, or listings -- creating a request is
-- explicitly NOT a parent order-state transition.
--
-- Security: identical hardening to every prior RPC in this schema --
-- SECURITY DEFINER, SET search_path = '' with every reference fully
-- schema-qualified, auth.uid() as the sole identity source, EXECUTE
-- revoked from PUBLIC/anon and granted only to authenticated. No admin
-- bypass.
--
-- Authorization: caller must equal orders.buyer_id. A seller or any
-- unrelated user fails with NOT_ORDER_BUYER.
--
-- Locking: the orders row is locked FOR UPDATE immediately after
-- authentication, before any other check -- the universal serialization
-- point shared by every order-state RPC in this schema, essential here
-- specifically because request creation must race safely against seller
-- progression, seller direct-cancellation, and any other concurrent
-- cancellation-request attempt. No order_items lock, no listing lock, no
-- inventory_reservations lock -- this function touches none of them.
--
-- Status eligibility: only 'accepted' or 'ready' may open a request;
-- every other status (pending, changes_pending,
-- handed_over_or_shipped, received_confirmed, completed, cancelled,
-- declined, expired, disputed) raises ORDER_NOT_CANCELLABLE. Pending and
-- changes_pending buyers already have their own direct-cancel RPCs
-- (cancel_pending_order, cancel_order_changes) -- this function is
-- deliberately not a substitute for either.
--
-- Reason validation: p_reason is normalized with btrim() and rejected as
-- INVALID_CANCELLATION_REASON if NULL, empty, or whitespace-only -- no
-- invented minimum length beyond non-blank, matching the reason column's
-- own existing non-blank CHECK. Validated after the order-eligibility
-- check and before the existing-pending-request check, so a caller with
-- a genuinely invalid reason never succeeds merely because a pending
-- request already happens to exist.
--
-- Idempotency: if a pending request already exists for this order (the
-- partial UNIQUE index on order_cancellation_requests already enforces
-- at most one), that EXACT existing row is returned unchanged --
-- was_already_pending = true. The reason is NOT compared, updated, or
-- replaced, and requested_at is NOT touched: the pending reason is
-- immutable in this MVP. A caller who wants to change their stated
-- reason has no amend path here (not asked for by any canonical doc);
-- they see their original request returned as-is.
--
-- New request: insert exactly one order_cancellation_requests row --
-- order_id, requested_by = auth.uid(), status = 'pending', reason = the
-- trimmed value. requested_at uses the column's own default (now()),
-- matching every other timestamp-default column already relied on
-- elsewhere in this schema rather than setting it explicitly.
--
-- No order_status_history row: no parent transition occurred, and the
-- table's own from_status <> to_status CHECK would reject a same-status
-- entry structurally even if one were attempted. order_cancellation_
-- requests is itself the durable audit record for the request.
--
-- Return shape: a typed table -- request_id, order_id, request_status,
-- was_already_pending, requested_at -- no jsonb, matching the plain-
-- typed-table philosophy already used throughout this schema.
--
-- Atomicity: the entire function body is the one transaction the RPC
-- call runs in. A fresh request commits the single insert; any RAISE
-- EXCEPTION leaves zero mutation.

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
  select r.id, r.status, r.requested_at
    into v_existing_id, v_existing_status, v_existing_requested_at
    from public.order_cancellation_requests r
    where r.order_id = p_order_id and r.status = 'pending';

  if found then
    return query
      select v_existing_id, p_order_id, v_existing_status, true, v_existing_requested_at;
    return;
  end if;

  -- ===================== fresh request =====================
  insert into public.order_cancellation_requests (order_id, requested_by, status, reason)
    values (p_order_id, v_caller, 'pending', v_reason)
    returning id, requested_at into v_new_id, v_new_requested_at;

  return query
    select v_new_id, p_order_id, 'pending'::public.cancellation_request_status_enum, false, v_new_requested_at;
end;
$$;

revoke all on function public.request_order_cancellation(uuid, text) from public;
revoke all on function public.request_order_cancellation(uuid, text) from anon;
grant execute on function public.request_order_cancellation(uuid, text) to authenticated;

-- =============================================================================
-- public.resolve_order_cancellation
-- =============================================================================
--
-- Signature: p_request_id uuid, p_confirm boolean, p_review_note text.
-- A boolean decision flag deliberately makes an invalid "decision" (e.g.
-- passing the enum's own 'pending' value) structurally unrepresentable,
-- eliminating any need for an INVALID_REVIEW_DECISION error.
--
-- Security: identical hardening to every prior RPC -- SECURITY DEFINER,
-- SET search_path = '', fully-qualified references, auth.uid() only,
-- EXECUTE revoked from PUBLIC/anon and granted only to authenticated. No
-- admin bypass.
--
-- Request-id -> order lock routing: this RPC receives p_request_id, not
-- p_order_id, so the safe pattern is: (1) an UNLOCKED read of
-- request.order_id purely for routing; (2) lock the resolved orders row
-- FOR UPDATE; (3) lock the order_cancellation_requests row itself FOR
-- UPDATE; (4) re-verify, from the LOCKED request row, that it still
-- exists and its order_id still equals the order just locked. Every
-- subsequent decision in this function reads from the locked rows only
-- -- the initial unlocked lookup is routing information alone and is
-- never used to decide or mutate anything.
--
-- Authorization: caller must own orders.shop_id -> shops.owner_id,
-- derived from the LOCKED orders row (never from request.requested_by
-- or any client-supplied id). Mismatch -> NOT_ORDER_SELLER.
--
-- Lock order: orders FOR UPDATE, then the request row FOR UPDATE, always
-- -- both are needed regardless of outcome (authorization and the
-- resolved-request idempotency check both depend on them). order_items,
-- active inventory_reservations, and affected listings are locked ONLY
-- within the confirm branch, after the request is confirmed still
-- 'pending' and the order still eligible -- the reject path and every
-- idempotent-retry path never touch inventory at all, so acquiring those
-- locks unconditionally would be pure unneeded contention, inconsistent
-- with every other RPC in this schema's progressive-locking discipline
-- (locks are acquired only immediately before the writes that need
-- them). When the confirm branch does run, order_items for the whole
-- order are locked FOR UPDATE ORDER BY id first (their locked, stable
-- status/quantity values are what the reservation-consistency check
-- below reads), then active inventory_reservations FOR UPDATE ORDER BY
-- id, then the distinct affected listings FOR UPDATE in ascending id
-- order -- the same deterministic global ordering already established
-- by accept_order_items/confirm_order_changes, keeping this function
-- deadlock-compatible with them.
--
-- Resolved-request idempotency: if the locked request is already
-- 'confirmed' and the caller now passes p_confirm = true, return the
-- current durable state unchanged (was_already_resolved = true,
-- reviewed_at/by/note untouched, zero mutation) -- correct regardless of
-- which call actually performed the original confirmation. Symmetrically
-- for 'rejected' + p_confirm = false. A MISMATCHED retry -- already
-- 'confirmed' but now called with p_confirm = false, or already
-- 'rejected' but now called with p_confirm = true -- is not a safe
-- retry, it is a contradictory ask against an already-final state, and
-- raises REQUEST_ALREADY_RESOLVED rather than silently producing a
-- result that disagrees with what was requested.
--
-- Order-state eligibility at review: only reached when the request is
-- still genuinely 'pending'. The order's CURRENT locked status must
-- still be 'accepted' or 'ready' -- if the order has moved elsewhere
-- (handed_over_or_shipped, disputed, already cancelled via another path,
-- completed, etc.) since the request was opened, ORDER_NOT_CANCELLABLE
-- is raised. This does NOT auto-resolve the now-orphaned pending
-- request as a side effect -- silently deciding the buyer's outcome
-- inside an unrelated precondition check would be exactly the kind of
-- implicit behavior this project avoids. Cleaning up an orphaned pending
-- request when an order is cancelled by another path (e.g. a future
-- seller direct-cancel) is that future RPC's own explicit
-- responsibility -- see the forward requirement below.
--
-- Reject path: requires a non-blank normalized review_note
-- (INVALID_REVIEW_NOTE otherwise) -- a buyer whose cancellation ask is
-- refused deserves to know why. Updates only the request row (status =
-- 'rejected', reviewed_by/reviewed_at populated, review_note stored).
-- orders, order_items, inventory_reservations, and listings are all left
-- completely untouched, and no order_status_history row is written --
-- the parent order's state never changed.
--
-- Confirm path: review_note is optional (the buyer's own reason on the
-- request already explains the cancellation). Validates every active
-- reservation for the order against its owning order_item's LOCKED
-- status and quantity: the composite FK inventory_reservations_order_
-- item_ownership_fkey (order_item_id, order_id, shop_id, listing_id ->
-- order_items(id, order_id, shop_id, listing_id)) already makes it
-- structurally impossible for an active reservation to reference a
-- different order, shop, or listing than its own order_item -- so the
-- only two things this function must actually check at runtime are (a)
-- the owning item is genuinely 'accepted', and (b) the reservation's
-- quantity matches the item's quantity; either mismatch raises
-- RESERVATION_STATE_INVALID. A UNIQUE(order_item_id) constraint already
-- makes a duplicate reservation per item structurally impossible, so no
-- code guards against it. An accepted item with NO active reservation is
-- explicitly tolerated (nothing to release, nothing at risk -- APPROVED
-- TOLERANCE, not repaired). Release aggregates per listing (never
-- assuming one reservation per listing), and for each affected listing
-- requires reserved_quantity >= the aggregate being released -- a
-- shortfall also raises RESERVATION_STATE_INVALID rather than clamping
-- to zero, matching the established "the safest response to an
-- unexplained inconsistency is to leave it alone rather than guess a
-- correction" principle from 0016. Reservations are released (status =
-- 'released', resolved_at = now()) before the cached listings.
-- reserved_quantity is decremented -- the ledger updates first, the
-- cache second, mirroring accept_order_items' own insert-then-cache
-- ordering. stock_quantity is never touched -- only a future completion
-- RPC decrements it. The listing-status reopening rule reopens 'reserved'
-- to 'available' only when the resulting available_quantity > 0;
-- 'paused', 'archived', and 'sold' are never reopened (a release must
-- never resurrect a deliberate or terminal seller state), and 'reserved'
-- with zero resulting slack (other active reservations still cover full
-- stock) correctly remains 'reserved'. order_items are never written --
-- accepted stays accepted, matching the principle that item rows are
-- permanent seller-decision history. The parent order is updated once:
-- status = 'cancelled', cancelled_at = now(), leaving accepted_at,
-- ready_at, and every other lifecycle timestamp untouched, per the
-- project-wide lifecycle-timestamp convention (0018). The request row is
-- updated to 'confirmed' with reviewed_by/reviewed_at populated,
-- requested_at/requested_by/reason left untouched. Exactly one
-- order_status_history row is inserted -- from_status = the order's
-- actual captured prior status ('accepted' or 'ready'), to_status =
-- 'cancelled', changed_by = the SELLER's auth.uid() (the confirming
-- actor -- changed_by is actor-agnostic by design, per 0017's own
-- documented reasoning; the buyer's role already lives durably in
-- order_cancellation_requests.requested_by), note = NULL (the reason and
-- review_note already have their own durable home and are not
-- duplicated into history text).
--
-- Notifications: none. Future application events (buyer request created
-- -> notify seller; seller confirms/rejects -> notify buyer) belong to
-- application code reacting after commit, per AGENTS.md's isolation
-- principle, never inside this transaction.
--
-- Forward requirement -- progression freeze (not implemented here): any
-- future order-progression RPC (e.g. accepted -> ready, ready ->
-- handed_over_or_shipped) MUST lock the orders row first, then check for
-- an existing pending order_cancellation_requests row for that order,
-- and refuse to progress while one exists. This gives the request table
-- real teeth without introducing a new order-status enum value for "a
-- request exists." No progression RPC is created, simulated, or assumed
-- to exist by this migration.
--
-- Forward requirement -- seller direct-cancel interaction (not
-- implemented here): a future seller-direct-cancellation RPC for an
-- accepted/ready order, on finding an existing pending buyer
-- cancellation request, MUST resolve that request as 'confirmed' (with
-- reviewed_by = the seller, reviewed_at = now()) rather than leaving it
-- orphaned in 'pending' against an order that is no longer cancellable
-- through this workflow -- the seller's direct action delivers exactly
-- the outcome the buyer asked for, just via a different path. No seller
-- direct-cancel RPC is created here.
--
-- No shared release helper: the reservation-release/listing-reopen logic
-- above is intentionally NOT extracted into a shared private function in
-- this migration, per instruction and per this project's stated
-- discipline against speculative abstraction (AGENTS.md/CLAUDE.md) --
-- there is currently only one caller. Whether to extract a shared
-- routine is a decision for the future seller-direct-cancel RPC's own
-- design task, once that second call site's exact needs are concretely
-- known.
--
-- Return shape: a typed table -- request_id, order_id, request_status,
-- order_status, was_already_resolved, reviewed_at -- no jsonb, no
-- inventory arrays.
--
-- Atomicity: the entire function body is the one transaction the RPC
-- call runs in. A successful confirmation commits the request update,
-- every reservation release, every affected listing's reserved_quantity/
-- status update, the parent order update, and the single history row
-- together; a successful rejection commits only the request update. Any
-- RAISE EXCEPTION (including RESERVATION_STATE_INVALID and
-- ORDER_NOT_CANCELLABLE) leaves ZERO mutation.

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
  select r.order_id into v_routed_order_id
    from public.order_cancellation_requests r
    where r.id = p_request_id;

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
  select r.order_id, r.status, r.reviewed_by, r.reviewed_at
    into v_request_order_id, v_request_status, v_reviewed_by, v_reviewed_at
    from public.order_cancellation_requests r
    where r.id = p_request_id
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

  -- lock this order's order_items (their locked status/quantity back the reservation check below)
  perform 1 from public.order_items where order_id = v_order_id order by id for update;

  -- lock this order's active reservations
  perform 1 from public.inventory_reservations where order_id = v_order_id and status = 'active' order by id for update;

  -- reservation/item consistency guard: ownership is already structurally guaranteed by
  -- inventory_reservations_order_item_ownership_fkey; only status and quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations r
    join public.order_items oi on oi.id = r.order_item_id
    where r.order_id = v_order_id
      and r.status = 'active'
      and (oi.status <> 'accepted' or r.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- aggregate release quantity per listing
  for v_listing_id, v_agg_qty in
    select r.listing_id, sum(r.quantity)::integer
      from public.inventory_reservations r
      where r.order_id = v_order_id and r.status = 'active'
      group by r.listing_id
      order by r.listing_id
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
  update public.inventory_reservations
    set status = 'released',
        resolved_at = now()
    where order_id = v_order_id and status = 'active';

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
