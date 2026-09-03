-- First explicit buyer progression RPC: handed_over_or_shipped ->
-- received_confirmed. Creates ONLY the function and its grants/revokes.
-- No completion RPC, no inventory mutation, no dispute infrastructure,
-- no review infrastructure, no notification logic, no
-- tables/enums/indexes/triggers/policies, no application code, no
-- changes to any existing function.
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 22 / 22.3: lifecycle is "... -> Handed Over/Shipped -> Buyer
-- Confirms Received -> Completed"; "Order becomes Completed only after
-- buyer confirms receipt. No automatic completion in MVP." Per the
-- locked product decision: this sentence forbids the system completing
-- an order on its own initiative absent buyer action (a timer, a
-- seller-side mark) -- it does NOT require a second buyer click.
-- received_confirmed and completed have been distinct, separate
-- order_status_enum values since 0012, long before this task -- this
-- migration respects that existing architecture rather than relitigate
-- it. This RPC is the buyer's one explicit "Confirm Received" action
-- and persists received_confirmed as a durable, independently-auditable
-- intermediate state; a future trusted server flow invokes a SEPARATE
-- completion transaction immediately afterward -- not built here -- so
-- that if completion ever fails, the buyer's receipt confirmation is
-- never lost and completion can be safely retried. PRD 26.1 requires
-- Completed specifically for verified review eligibility -- confirmed
-- live that no reviews table exists yet, so there is nothing for this
-- RPC to touch regarding reviews. Confirmed live that no disputes table
-- exists yet either -- the only current representation of a dispute is
-- orders.status = 'disputed' itself, already and fully handled by this
-- function's own eligibility check with zero additional code. Nothing
-- beyond the approved design is invented here.
--
-- =============================================================================
-- public.confirm_order_received
-- =============================================================================
--
-- Signature: p_order_id uuid only. Handles exactly one transition:
-- handed_over_or_shipped -> received_confirmed. "Confirm" is the PRD's
-- own verb for this buyer action ("Buyer Confirms Received"), matching
-- the naming convention already established for the seller's "mark_*"
-- progression RPCs while deliberately using a different verb, since a
-- buyer confirming a fact and a seller asserting one are different
-- kinds of action.
--
-- Security: SECURITY DEFINER, SET search_path = '' with every relation
-- fully schema-qualified, auth.uid() as the sole identity source, EXECUTE
-- revoked from PUBLIC/anon and granted only to authenticated -- the
-- standard user-facing hardening pattern, identical in shape to every
-- prior RPC in this schema.
--
-- Ambiguity-bug defense (0021 lesson applied proactively): this
-- function's own RETURNS TABLE declares order_id, order_status,
-- was_already_received_confirmed, and received_confirmed_at.
-- orders.received_confirmed_at is a real column sharing a name with an
-- output column. Every table reference therefore carries an explicit
-- alias (o for orders) and every read of a column sharing a name with
-- an output column is alias-qualified (o.received_confirmed_at).
-- UPDATE ... SET target-list column names (status, received_confirmed_at)
-- remain bare -- Postgres does not accept an alias-qualified SET
-- target, and a bare SET target is never ambiguous regardless of alias
-- presence, per the same reasoning already documented and empirically
-- proven in 0022 and reused in 0023/0024/0025/0026.
--
-- Authorization: caller must equal orders.buyer_id, derived from the
-- LOCKED orders row -- a direct column comparison, simpler than the
-- seller RPCs' shops-ownership join, matching cancel_pending_order's
-- own buyer-authorization shape exactly. A seller or any unrelated user
-- fails with NOT_ORDER_BUYER. No admin bypass, no client-supplied id
-- trusted.
--
-- Locking: the orders row is locked FOR UPDATE immediately after
-- authentication -- the universal serialization point shared by every
-- order-state RPC in this schema, serializing this function against
-- concurrent calls to itself and a future completion transaction (which
-- will lock orders first too, per this schema's own unbroken
-- convention, once built).
--
-- Idempotency: if the locked order's status is already
-- 'received_confirmed', return the current durable state unchanged --
-- was_already_received_confirmed = true, received_confirmed_at = the
-- existing value -- with ZERO mutation, checked before any other check.
-- Every other non-handed_over_or_shipped, non-received_confirmed status
-- (pending, accepted, ready, changes_pending, completed, declined,
-- cancelled, expired, disputed) raises ORDER_NOT_RECEIVABLE --
-- 'completed' is deliberately NOT reinterpreted as idempotent success,
-- matching the same exact-target-state idempotency principle already
-- applied to mark_order_ready and mark_order_handed_over_or_shipped: a
-- single-target-state RPC's idempotency contract means "this exact
-- state is already achieved," never "the order has moved past the
-- point where this action would matter."
--
-- Cancellation requests: never referenced anywhere in this function.
-- request_order_cancellation and cancel_accepted_order both remain
-- limited to accepted/ready (confirmed read-only against their live
-- definitions before writing this migration) -- a legitimate pending
-- cancellation request is therefore structurally unreachable once an
-- order reaches handed_over_or_shipped, the same reasoning already
-- established for other structurally-unreachable states elsewhere in
-- this schema. A malformed/stale cancellation-request row, if one
-- somehow exists through corruption, is never inspected and never
-- blocks this transition -- this RPC does not own the cancellation
-- workflow and has no relationship to it at this stage.
--
-- Disputes: never referenced anywhere in this function, and no dispute
-- object of any kind is created by this migration. No disputes table
-- exists in this schema (confirmed read-only immediately before writing
-- this migration) -- the only possible current representation of a
-- dispute is orders.status = 'disputed' itself, which the function's own
-- eligibility check already and fully rejects via ORDER_NOT_RECEIVABLE,
-- with zero additional code. No ORDER_DISPUTE_ACTIVE error code exists,
-- since inventing one now would be speculative infrastructure for a
-- table that does not exist.
--
-- Inventory: performs NO inventory validation and references neither
-- public.inventory_reservations nor public.listings anywhere in this
-- function. This transition still does not consume or release stock --
-- the reservation ledger created at acceptance must remain fully intact
-- and untouched (active, resolved_at still NULL) all the way through
-- this step too, so that a future completion transaction inherits a
-- reliable ledger to validate and consume. Any inventory corruption
-- (missing reservation, quantity mismatch, wrong-status active
-- reservation, listing reserved_quantity drift) is NOT inspected and
-- does NOT block this transition -- blocking this call cannot undo the
-- buyer's physical receipt of the item, which by definition already
-- happened before they confirm; any such corruption remains the sole
-- responsibility of the future completion RPC to detect, matching the
-- same reasoning already applied to mark_order_ready and
-- mark_order_handed_over_or_shipped.
--
-- order_items: never referenced anywhere in this function. Accepted and
-- declined item decisions remain permanent, unread, unmutated seller-
-- decision history.
--
-- fulfillment_method: never read or branched on. Receipt confirmation
-- behaves identically for meetup, pickup, local_delivery, and shipping.
--
-- Parent mutation (fresh transition only): one UPDATE -- status =
-- 'received_confirmed', received_confirmed_at = now() -- in the same
-- statement, leaving accepted_at, ready_at, handed_over_or_shipped_at,
-- declined_at, cancelled_at, expired_at, disputed_at, and every other
-- lifecycle timestamp untouched, per the project-wide lifecycle-
-- timestamp convention (0018). completed_at is deliberately never set
-- here -- this RPC does not complete the order.
--
-- History: exactly one order_status_history row on the fresh-transition
-- path -- from_status = 'handed_over_or_shipped', to_status =
-- 'received_confirmed', changed_by = the buyer's auth.uid(), note =
-- NULL (this action carries no free-text input anywhere in the canon,
-- matching the note = NULL precedent from both prior progression RPCs).
-- No history row is written on the idempotent-retry path.
--
-- Return shape: a typed table -- order_id, order_status,
-- was_already_received_confirmed, received_confirmed_at -- matching the
-- established was_already_*-plus-state-timestamp shape used by every
-- prior progression RPC in this schema. The long, exact-state field
-- name is deliberate -- a shorter alternative such as
-- was_already_received is ambiguous about what was received or by whom,
-- where the exact enum-matching name is not.
--
-- Completion separation (the locked forward architecture): this
-- function persists received_confirmed and nothing more. It does NOT
-- set status = 'completed', does NOT set completed_at, does NOT touch
-- inventory_reservations or listings in any way, and creates no review-
-- eligibility side effect. A future trusted server flow is expected to
-- invoke a separate, not-yet-built completion transaction immediately
-- after a fresh confirmation succeeds -- that transaction is
-- deliberately not created by this migration. Keeping the two states
-- and the two transactions separate means that if the future completion
-- transaction ever fails, the buyer's receipt confirmation already
-- committed here is never lost, the buyer never needs to confirm again,
-- and completion can be retried safely and independently.
--
-- Reviews: no review-eligibility logic exists in this function, and no
-- reviews table exists in this schema. PRD 26.1 requires Completed
-- specifically for verified review eligibility -- received_confirmed
-- must not and does not unlock it.
--
-- Notifications: none. A future application event (fresh receipt
-- confirmation -> notify seller) belongs to application code reacting
-- after commit, per AGENTS.md's isolation principle -- an idempotent
-- retry (was_already_received_confirmed = true) must not re-notify. A
-- future completion transaction produces its own separate event.
--
-- Double confirm: concurrent or duplicate confirmation attempts
-- serialize on the same orders-row lock -- the first call performs the
-- fresh transition, and any call arriving after observes the exact
-- target state and returns idempotent success with the same persisted
-- timestamp, zero mutation, no duplicate history.
--
-- Future completion compatibility: a future completion transaction must
-- begin only from received_confirmed. This function leaves the entire
-- reservation ledger, every order_item, and every prior lifecycle
-- timestamp exactly as they stood at handed_over_or_shipped, so that
-- transaction inherits a reservation state exactly as it stood at
-- acceptance (subject only to any pre-existing corruption, which
-- remains solely that future transaction's responsibility to detect,
-- validate, and consume).
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. A successful fresh transition
-- commits the parent update and the single history row together; any
-- RAISE EXCEPTION (including ORDER_NOT_RECEIVABLE) leaves ZERO
-- mutation.

create or replace function public.confirm_order_received(
  p_order_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_received_confirmed boolean,
  received_confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_existing_received_confirmed_at timestamptz;
  v_new_received_confirmed_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id, o.received_confirmed_at
    into v_order_status, v_order_buyer_id, v_existing_received_confirmed_at
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

  -- ===================== idempotency: already-received-confirmed is success, zero mutation =====================
  if v_order_status = 'received_confirmed' then
    return query
      select p_order_id, v_order_status, true, v_existing_received_confirmed_at;
    return;
  end if;

  -- ===================== only handed_over_or_shipped orders may progress to received_confirmed =====================
  if v_order_status <> 'handed_over_or_shipped' then
    raise exception 'Order is not in a state that can be marked received.' using detail = 'ORDER_NOT_RECEIVABLE';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_received_confirmed_at := now();

  update public.orders as o
    set status = 'received_confirmed',
        received_confirmed_at = v_new_received_confirmed_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'handed_over_or_shipped', 'received_confirmed', v_caller, null);

  return query
    select p_order_id, 'received_confirmed'::public.order_status_enum, false, v_new_received_confirmed_at;
end;
$$;

revoke all on function public.confirm_order_received(uuid) from public;
revoke all on function public.confirm_order_received(uuid) from anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;
