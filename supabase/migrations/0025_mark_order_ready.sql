-- First explicit seller progression RPC after acceptance: accepted ->
-- ready. Creates ONLY the function and its grants/revokes. No shared
-- helper, no handoff/shipping RPC, no buyer-confirmation/completion
-- RPCs, no notification logic, no tables/enums/indexes/triggers/
-- policies, no application code, no changes to any existing function.
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 22 / 22.1: core progression is "Pending -> Accepted -> Ready ->
-- Handed Over/Shipped -> Buyer Confirms Received -> Completed"; "Seller
-- may mark an accepted order Ready" -- "mark" is the PRD's own verb for
-- this transition and the next one, confirming the RPC name below. No
-- document differentiates Ready by fulfillment_method -- the method-
-- specific branch belongs to the NEXT transition's wording ("Handed
-- Over / Shipped depending on fulfillment method"), not to Ready itself.
-- No document assigns any item-level or inventory role to Ready --
-- acceptance already reserved stock; Ready is a pure parent-lifecycle
-- signal. "Order marked Ready" is a listed in-app notification event
-- (PRD 35.1 / ARCHITECTURE_ESSENTIALS 18), left entirely to the
-- application layer per this schema's established isolation principle.
-- The pending-cancellation-request freeze enforced below is the
-- previously-approved forward requirement from 0021's own design
-- ("a pending buyer request freezes future progression RPCs") rather
-- than PRD/ARCHITECTURE text -- binding because it was explicitly
-- approved in this project's own prior task. Nothing beyond the
-- approved design is invented here.
--
-- =============================================================================
-- public.mark_order_ready
-- =============================================================================
--
-- Signature: p_order_id uuid only. Handles exactly one transition:
-- accepted -> ready. It is deliberately not a generic "advance order"
-- RPC -- each lifecycle transition owns its own small, auditable
-- function, matching every RPC in this schema since 0016.
--
-- Security: SECURITY DEFINER, SET search_path = '' with every relation
-- fully schema-qualified, auth.uid() as the sole identity source, EXECUTE
-- revoked from PUBLIC/anon and granted only to authenticated -- the
-- standard user-facing hardening pattern (this is a genuine seller
-- action with a real human actor, unlike the system-only
-- expire_pending_orders).
--
-- Ambiguity-bug defense (0021 lesson applied proactively): this
-- function's own RETURNS TABLE declares order_id, order_status,
-- was_already_ready, and ready_at. orders.ready_at and
-- order_cancellation_requests.order_id are real columns sharing a name
-- with an output column. Every table reference therefore carries an
-- explicit alias (o for orders, s for shops, ocr for
-- order_cancellation_requests) and every read of a column sharing a
-- name with an output column is alias-qualified (o.ready_at,
-- ocr.order_id). UPDATE ... SET target-list column names (status,
-- ready_at) remain bare -- Postgres does not accept an alias-qualified
-- SET target, and a bare SET target is never ambiguous regardless of
-- alias presence, per the same reasoning already documented and
-- empirically proven in 0022 and reused in 0023/0024.
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
-- cancel_accepted_order, accept_order_items, and concurrent
-- mark_order_ready calls.
--
-- Idempotency: if the locked order's status is already 'ready', return
-- the current durable state unchanged -- was_already_ready = true,
-- ready_at = the existing value -- with ZERO mutation, checked before
-- any other check. Every other non-accepted, non-ready status (pending,
-- changes_pending, handed_over_or_shipped, received_confirmed,
-- completed, declined, cancelled, expired, disputed) raises
-- ORDER_NOT_READYABLE -- later lifecycle states are deliberately NOT
-- reinterpreted as idempotent Ready; a single-target-state RPC's
-- idempotency contract means "this exact state is already achieved,"
-- not "the order has moved past the point where this action would
-- matter" (the same reasoning already applied to cancel_pending_order's
-- own status-specific idempotency check).
--
-- Cancellation-request freeze: for a fresh accepted order, before any
-- mutation, a plain EXISTS check looks for a pending
-- order_cancellation_requests row for this order. If one exists,
-- CANCELLATION_REQUEST_PENDING is raised with zero mutation -- this is
-- an approved business rule, not corruption handling: the request is
-- never confirmed, rejected, deleted, or otherwise mutated by this
-- function, and neither is the parent order or any inventory. The
-- request row is deliberately NOT locked (no FOR UPDATE) -- every
-- legitimate path that creates or resolves a pending request
-- (request_order_cancellation's insert, resolve_order_cancellation's
-- update, cancel_accepted_order's auto-confirm update) locks the same
-- orders row first, so once this function holds that lock, the pending-
-- request state cannot legitimately change concurrently until this
-- transaction ends -- an unlocked EXISTS read is reading a value that
-- cannot move out from under it. Locking the request row here would add
-- lock surface for no safety benefit, since this function never writes
-- to it.
--
-- Inventory: performs NO inventory validation and references neither
-- public.inventory_reservations nor public.listings anywhere in this
-- function. Ready is a pure parent-lifecycle transition, not an
-- inventory-mutating one -- acceptance already reserved stock and
-- already validated it; this function creates no new inventory risk, so
-- it introduces no new inventory check. A malformed accepted order
-- (active reservation on a declined/pending item, a quantity mismatch,
-- an accepted item missing its reservation, or a listing
-- reserved_quantity mismatch) is NOT inspected and does NOT block
-- progression -- any such corruption is caught, if at all, by whichever
-- function actually touches inventory (cancel_accepted_order's existing
-- consistency guard, or a future completion RPC), not duplicated here
-- without any corresponding repair capability.
--
-- order_items: never referenced anywhere in this function. Accepted and
-- declined item decisions remain permanent, unread, unmutated seller-
-- decision history.
--
-- Parent mutation (fresh transition only): one UPDATE -- status =
-- 'ready', ready_at = now() -- in the same statement, leaving
-- accepted_at, cancelled_at, declined_at, expired_at, disputed_at,
-- handed_over_or_shipped_at, received_confirmed_at, completed_at, and
-- every other lifecycle timestamp untouched, per the project-wide
-- lifecycle-timestamp convention (0018).
--
-- History: exactly one order_status_history row on the fresh-transition
-- path -- from_status = 'accepted', to_status = 'ready', changed_by =
-- the seller's auth.uid() (a genuine human actor, unlike
-- expire_pending_orders' NULL), note = NULL (Ready carries no reason/
-- text input anywhere in the canon, unlike seller cancellation). No
-- history row is written on the idempotent-retry path or the blocked-
-- cancellation-request path.
--
-- Return shape: a typed table -- order_id, order_status,
-- was_already_ready, ready_at -- matching the established
-- was_already_*-plus-state-timestamp shape used by cancel_pending_order/
-- cancel_order_changes/cancel_accepted_order. No cancellation-request
-- info is included -- that is an error-path concern (surfaced via the
-- exception's DETAIL), not a success-path field.
--
-- Fulfillment method: never inspected or branched on. Ready applies
-- uniformly to meet-up, pickup, local delivery, and shipping; the
-- fulfillment-method-specific wording belongs to the NEXT transition
-- (ready -> handed_over_or_shipped), which is not created here.
--
-- Race interactions (all resolved deterministically by the shared
-- orders-row-lock-first discipline): a buyer cancellation request that
-- wins the lock first leaves a pending request this function then
-- correctly blocks on; if this function wins first, the order becomes
-- ready and a buyer's later request_order_cancellation call still
-- succeeds (it already accepts accepted OR ready), creating a pending
-- request against a now-ready order -- a future handoff/shipping
-- progression RPC must enforce the identical freeze. A seller direct
-- cancellation that wins the lock first leaves the order cancelled and
-- this function later raises ORDER_NOT_READYABLE; if this function wins
-- first, the order becomes ready and cancel_accepted_order remains
-- valid afterward (it already accepts accepted OR ready) -- zero
-- modification to either function required or made. If a blocking
-- request is rejected via resolve_order_cancellation, the order stays
-- accepted and a retried mark_order_ready call proceeds normally; if it
-- is confirmed instead, the order becomes cancelled and a retried call
-- raises ORDER_NOT_READYABLE. expire_pending_orders only ever selects
-- status = 'pending' rows while this function's only valid source is
-- 'accepted' -- a single order can never satisfy both predicates at
-- once, so there is no possible overlap between the two functions at
-- all, by construction. accept_order_items produces the 'accepted'
-- state this function later acts on; the two are sequential, not
-- concurrent-contending, and are deliberately kept as separate
-- functions rather than combined.
--
-- Notifications: none. Future application events (fresh accepted ->
-- ready -> notify buyer) belong to application code reacting after
-- commit, per AGENTS.md's isolation principle -- an idempotent retry
-- (was_already_ready = true) must not re-notify. Fulfillment-specific
-- notification wording is an application-layer concern reading the
-- order's own fulfillment_method column, not something this function
-- needs to know.
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. A successful fresh transition
-- commits the parent update and the single history row together; any
-- RAISE EXCEPTION (including ORDER_NOT_READYABLE and
-- CANCELLATION_REQUEST_PENDING) leaves ZERO mutation.

create or replace function public.mark_order_ready(
  p_order_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_ready boolean,
  ready_at timestamptz
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
  v_existing_ready_at timestamptz;
  v_new_ready_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.ready_at
    into v_order_status, v_order_shop_id, v_existing_ready_at
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

  -- ===================== idempotency: already-ready is success, zero mutation =====================
  if v_order_status = 'ready' then
    return query
      select p_order_id, v_order_status, true, v_existing_ready_at;
    return;
  end if;

  -- ===================== only accepted orders may progress to ready =====================
  if v_order_status <> 'accepted' then
    raise exception 'Order is not in a state that can be marked ready.' using detail = 'ORDER_NOT_READYABLE';
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
  v_new_ready_at := now();

  update public.orders as o
    set status = 'ready',
        ready_at = v_new_ready_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'accepted', 'ready', v_caller, null);

  return query
    select p_order_id, 'ready'::public.order_status_enum, false, v_new_ready_at;
end;
$$;

revoke all on function public.mark_order_ready(uuid) from public;
revoke all on function public.mark_order_ready(uuid) from anon;
grant execute on function public.mark_order_ready(uuid) to authenticated;
