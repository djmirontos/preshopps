-- Second explicit seller progression RPC: ready -> handed_over_or_shipped.
-- Creates ONLY the function and its grants/revokes. No buyer-confirmation
-- RPC, no completion RPC, no inventory helper, no notification logic, no
-- shipping/tracking infrastructure, no tables/enums/indexes/triggers/
-- policies, no application code, no changes to any existing function.
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 22 / 22.2: lifecycle is "Pending -> Accepted -> Ready -> Handed
-- Over/Shipped -> Buyer Confirms Received -> Completed"; "Seller
-- indicates fulfillment has occurred: Handed Over / Shipped depending on
-- fulfillment method." The seller is the sole actor; buyer confirmation
-- always remains a separate, later, explicit step regardless of method
-- (PRD 22.3: "Order becomes Completed only after buyer confirms
-- receipt"). PRD 24 / AGENTS.md confirm four fulfillment methods (Meet-
-- up, Pickup, Local delivery, Shipping) with "exact arrangements
-- discussed in messaging" and explicitly no courier integrations / no
-- shipping-fee calculation in MVP -- confirmed live: orders has no
-- tracking/courier/carrier/shipping-reference column of any kind.
-- "Order marked Handed Over/Shipped" is a listed notification event
-- (PRD 35.1 / ARCHITECTURE_ESSENTIALS 18), left entirely to the
-- application layer. The pending-cancellation-request freeze is the
-- same previously-approved forward requirement already enforced by
-- mark_order_ready (0025), applied here at the next eligible-state
-- boundary. Nothing beyond the approved design is invented here.
--
-- =============================================================================
-- public.mark_order_handed_over_or_shipped
-- =============================================================================
--
-- Signature: p_order_id uuid only. Handles exactly one transition:
-- ready -> handed_over_or_shipped. Matches the target enum value
-- literally, continuing the exact-enum-match naming convention
-- established by mark_order_ready.
--
-- Security: SECURITY DEFINER, SET search_path = '' with every relation
-- fully schema-qualified, auth.uid() as the sole identity source, EXECUTE
-- revoked from PUBLIC/anon and granted only to authenticated -- the
-- standard user-facing hardening pattern, identical to mark_order_ready.
--
-- Ambiguity-bug defense (0021 lesson applied proactively): this
-- function's own RETURNS TABLE declares order_id, order_status,
-- was_already_handed_over_or_shipped, and handed_over_or_shipped_at.
-- orders.handed_over_or_shipped_at and
-- order_cancellation_requests.order_id are real columns sharing a name
-- with an output column. Every table reference therefore carries an
-- explicit alias (o for orders, s for shops, ocr for
-- order_cancellation_requests) and every read of a column sharing a
-- name with an output column is alias-qualified (o.handed_over_or_shipped_at,
-- ocr.order_id). UPDATE ... SET target-list column names (status,
-- handed_over_or_shipped_at) remain bare -- Postgres does not accept an
-- alias-qualified SET target, and a bare SET target is never ambiguous
-- regardless of alias presence, per the same reasoning already
-- documented and empirically proven in 0022 and reused in 0023/0024/0025.
--
-- Authorization: caller must own orders.shop_id -> shops.owner_id,
-- derived from the LOCKED orders row. A buyer or any unrelated user
-- fails with NOT_ORDER_SELLER. No admin bypass, no client-supplied id
-- trusted.
--
-- Locking: the orders row is locked FOR UPDATE immediately after
-- authentication -- the universal serialization point shared by every
-- order-state RPC in this schema, serializing this function against
-- request_order_cancellation, resolve_order_cancellation,
-- cancel_accepted_order, mark_order_ready, concurrent calls to itself,
-- and a future buyer-confirmation RPC.
--
-- Idempotency: if the locked order's status is already
-- 'handed_over_or_shipped', return the current durable state unchanged
-- -- was_already_handed_over_or_shipped = true,
-- handed_over_or_shipped_at = the existing value -- with ZERO mutation,
-- checked before any other check. Every other non-ready,
-- non-handed_over_or_shipped status (pending, accepted, changes_pending,
-- received_confirmed, completed, declined, cancelled, expired, disputed)
-- raises ORDER_NOT_HANDOVERABLE -- later lifecycle states are
-- deliberately NOT reinterpreted as idempotent success; a
-- single-target-state RPC's idempotency contract means "this exact
-- state is already achieved," not "the order has moved past the point
-- where this action would matter" (the same reasoning already applied
-- to mark_order_ready's own status-specific idempotency check).
--
-- Cancellation-request freeze: for a fresh ready order, before any
-- mutation, a plain EXISTS check looks for a pending
-- order_cancellation_requests row for this order. If one exists,
-- CANCELLATION_REQUEST_PENDING is raised with zero mutation -- the same
-- code mark_order_ready already uses for the identical business rule
-- applied at its own eligible-state boundary, not a new condition
-- deserving a new code. The request is never confirmed, rejected,
-- deleted, or otherwise mutated by this function, and neither is the
-- parent order or any inventory. The request row is deliberately NOT
-- locked (no FOR UPDATE) -- every legitimate path that creates or
-- resolves a pending request (request_order_cancellation's insert,
-- resolve_order_cancellation's update, cancel_accepted_order's
-- auto-confirm update) locks the same orders row first, so once this
-- function holds that lock, the pending-request state cannot
-- legitimately change concurrently until this transaction ends.
--
-- Fulfillment method: this RPC does not accept a client-supplied action/
-- mode parameter and never reads or branches on orders.fulfillment_method
-- anywhere in its body. fulfillment_method is already an immutable,
-- NOT NULL, enum-constrained column set at order creation, and remains
-- the sole authoritative source for whichever semantic label an
-- application layer chooses to display -- trusting a client-supplied
-- mode instead would let a caller mislabel a shipping order as "handed
-- over" or vice versa, a real product-trust risk this design avoids by
-- construction. The approved application-layer wording mapping (meetup
-- -> Handed Over, pickup -> Handed Over, shipping -> Shipped,
-- local_delivery -> Out for Delivery) lives entirely outside this
-- function and outside the database -- no additional column, no
-- fulfillment-method logic, no history-note distinction records it here.
--
-- Inventory: performs NO inventory validation and references neither
-- public.inventory_reservations nor public.listings anywhere in this
-- function. This transition still does not consume or release stock --
-- the reservation ledger created at acceptance must remain fully intact
-- and untouched (active, resolved_at still NULL) all the way through
-- this step, so that a future completion transaction inherits a
-- reliable ledger to validate and consume. A malformed accepted order
-- (active reservation on a declined/pending item, a quantity mismatch,
-- an accepted item missing its reservation, or a listing
-- reserved_quantity mismatch) is NOT inspected and does NOT block this
-- transition -- blocking this call cannot prevent the physical handoff
-- or shipment it records, and would only leave the database less
-- accurate relative to real-world seller action; any such corruption
-- remains the sole responsibility of the future completion RPC to
-- detect, matching the same reasoning already applied to
-- mark_order_ready.
--
-- order_items: never referenced anywhere in this function. Accepted and
-- declined item decisions remain permanent, unread, unmutated seller-
-- decision history.
--
-- Parent mutation (fresh transition only): one UPDATE -- status =
-- 'handed_over_or_shipped', handed_over_or_shipped_at = now() -- in the
-- same statement, leaving accepted_at, ready_at, cancelled_at,
-- declined_at, expired_at, disputed_at, received_confirmed_at,
-- completed_at, and every other lifecycle timestamp untouched, per the
-- project-wide lifecycle-timestamp convention (0018).
--
-- History: exactly one order_status_history row on the fresh-transition
-- path -- from_status = 'ready', to_status = 'handed_over_or_shipped',
-- changed_by = the seller's auth.uid(), note = NULL. note is
-- deliberately left NULL rather than recording "Handed Over" / "Shipped"
-- / "Out for Delivery" -- orders.fulfillment_method already permanently
-- and structurally records the real distinction, so duplicating it into
-- free text would be redundant data with no independent audit value;
-- this schema's note fields are reserved for genuine free-text input
-- (for example a cancellation reason), not for restating a fact already
-- captured in a structured column. No history row is written on the
-- idempotent-retry path or the blocked-cancellation-request path.
--
-- Return shape: a typed table -- order_id, order_status,
-- was_already_handed_over_or_shipped, handed_over_or_shipped_at --
-- matching the established was_already_*-plus-state-timestamp shape
-- used by cancel_pending_order/cancel_order_changes/
-- cancel_accepted_order/mark_order_ready. The long, exact-state field
-- name is deliberate -- a shorter alternative such as
-- was_already_fulfilled risks being read as describing the Completed
-- state instead, the same collision risk already avoided in this
-- function's own name and error code.
--
-- Shipping/tracking: intentionally out of scope. No courier, carrier,
-- tracking-number, or shipment-reference field is read, written, or
-- assumed to exist -- confirmed absent from the schema before writing
-- this migration. This RPC remains lifecycle-only, matching the
-- canonical MVP's explicit exclusion of courier integrations.
--
-- Race interactions (all resolved deterministically by the shared
-- orders-row-lock-first discipline): a buyer cancellation request that
-- wins the lock first leaves a pending request this function then
-- correctly blocks on; if this function wins first, the order becomes
-- handed_over_or_shipped and a buyer's later request_order_cancellation
-- call correctly rejects with ORDER_NOT_CANCELLABLE (its own eligibility
-- is limited to accepted/ready, confirmed unmodified). A seller direct
-- cancellation that wins the lock first leaves the order cancelled and
-- this function later raises ORDER_NOT_HANDOVERABLE; if this function
-- wins first, the order becomes handed_over_or_shipped and
-- cancel_accepted_order correctly rejects afterward with
-- ORDER_NOT_CANCELLABLE (its own eligibility is likewise limited to
-- accepted/ready, confirmed unmodified) -- handed_over_or_shipped is
-- intentionally beyond that function's cancellation boundary. If a
-- blocking request is rejected via resolve_order_cancellation, the
-- order stays ready and a retried call here proceeds normally; if it is
-- confirmed instead, the order becomes cancelled and a retried call
-- raises ORDER_NOT_HANDOVERABLE. A stale mark_order_ready retry against
-- an already-handed_over_or_shipped order correctly raises
-- ORDER_NOT_READYABLE via that function's own existing, unmodified
-- eligibility check (its idempotency only special-cases 'ready', its
-- eligibility only special-cases 'accepted'; 'handed_over_or_shipped'
-- satisfies neither). expire_pending_orders only ever selects
-- status = 'pending' rows while this function's only valid source is
-- 'ready' -- structurally non-overlapping, by construction.
--
-- Buyer-confirmation forward requirement (not built here): a future
-- buyer-confirmation RPC must begin only from handed_over_or_shipped and
-- target received_confirmed -- this function is exactly the gate that
-- creates that precondition. No path from ready directly to
-- received_confirmed exists or is created by this migration.
--
-- Completion forward requirement (not built here): a future completion
-- transaction is expected to start from received_confirmed, validate
-- and consume active reservations, decrement listings.reserved_quantity
-- and stock_quantity, update listing state, set completed_at, insert
-- history, and enable verified review eligibility. This function
-- performs none of that and leaves the entire reservation ledger
-- untouched, so that future transaction inherits a reservation state
-- exactly as it stood at acceptance (subject only to any pre-existing
-- corruption, which remains solely that future transaction's
-- responsibility to detect).
--
-- Notifications: none. Future application events (fresh ready ->
-- handed_over_or_shipped -> notify buyer, worded per fulfillment_method)
-- belong to application code reacting after commit, per AGENTS.md's
-- isolation principle -- an idempotent retry
-- (was_already_handed_over_or_shipped = true) must not re-notify.
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. A successful fresh transition
-- commits the parent update and the single history row together; any
-- RAISE EXCEPTION (including ORDER_NOT_HANDOVERABLE and
-- CANCELLATION_REQUEST_PENDING) leaves ZERO mutation.

create or replace function public.mark_order_handed_over_or_shipped(
  p_order_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_handed_over_or_shipped boolean,
  handed_over_or_shipped_at timestamptz
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
  v_existing_handed_over_or_shipped_at timestamptz;
  v_new_handed_over_or_shipped_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.handed_over_or_shipped_at
    into v_order_status, v_order_shop_id, v_existing_handed_over_or_shipped_at
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

  -- ===================== idempotency: already-handed-over/shipped is success, zero mutation =====================
  if v_order_status = 'handed_over_or_shipped' then
    return query
      select p_order_id, v_order_status, true, v_existing_handed_over_or_shipped_at;
    return;
  end if;

  -- ===================== only ready orders may progress to handed_over_or_shipped =====================
  if v_order_status <> 'ready' then
    raise exception 'Order is not in a state that can be marked handed over or shipped.' using detail = 'ORDER_NOT_HANDOVERABLE';
  end if;

  -- ===================== cancellation-request freeze (approved progression blocker, not corruption handling) =====================
  if exists (
    select 1
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
  ) then
    raise exception 'A pending cancellation request must be resolved before this order can progress.' using detail = 'CANCELLATION_REQUEST_PENDING';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_handed_over_or_shipped_at := now();

  update public.orders as o
    set status = 'handed_over_or_shipped',
        handed_over_or_shipped_at = v_new_handed_over_or_shipped_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'ready', 'handed_over_or_shipped', v_caller, null);

  return query
    select p_order_id, 'handed_over_or_shipped'::public.order_status_enum, false, v_new_handed_over_or_shipped_at;
end;
$$;

revoke all on function public.mark_order_handed_over_or_shipped(uuid) from public;
revoke all on function public.mark_order_handed_over_or_shipped(uuid) from anon;
grant execute on function public.mark_order_handed_over_or_shipped(uuid) to authenticated;
