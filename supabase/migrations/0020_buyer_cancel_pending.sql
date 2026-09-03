-- The fourth trusted order-state RPC in this sequence: buyer direct-cancel
-- of a still-pending order (before the seller has acted at all). Creates
-- ONLY the function and its grants/revokes. No accepted-order
-- cancellation-request RPC, no seller accepted-order cancellation RPC, no
-- expiry RPC, no completion/progression RPCs, no notifications, no RLS
-- policies, no cron, no other schema objects.
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- Re-confirmed live across PRD.md 21.7/23.1/23.2, ARCHITECTURE.md 15, and
-- ARCHITECTURE_ESSENTIALS.md 15 (all phrase this identically): "Buyer may
-- directly cancel while pending" / "After acceptance, buyer submits
-- cancellation request" -- an explicit, unambiguous product rule that
-- pending cancellation is direct, buyer-only, requires no seller
-- involvement, and is a genuinely different workflow from the
-- accepted-order request/confirm flow. "Submitting request does not
-- reserve stock" / "Seller acceptance reserves stock" (ARCHITECTURE_
-- ESSENTIALS 15) confirms a legitimate pending order structurally holds
-- zero inventory reservations. PRD 23.2's mandatory cancellation-reason
-- rule is textually scoped to seller cancellation of an ACCEPTED order
-- only -- no canonical doc mentions a reason for buyer pending-
-- cancellation, confirming the no-reason-parameter decision. No
-- contradiction found; nothing beyond the previously approved
-- design-analysis decision is invented here.
--
-- =============================================================================
-- public.cancel_pending_order
-- =============================================================================
--
-- Signature: p_order_id uuid only -- no cancellation-reason parameter,
-- per the canonical-doc finding above. This RPC handles exactly one
-- transition: pending -> cancelled. It is deliberately NOT the same
-- function as public.cancel_order_changes(uuid) (changes_pending ->
-- cancelled, 0019) and is not a substitute for the still-unbuilt
-- accepted-order cancellation-request flow -- calling this function
-- against any status other than pending (or the idempotent cancelled
-- case) is a hard error, never silently reinterpreted as one of those
-- other flows.
--
-- Security: identical hardening to accept_order_items (0016),
-- confirm_order_changes (0017), and cancel_order_changes (0019) --
-- SECURITY DEFINER, SET search_path = '' with every object reference
-- fully schema-qualified, auth.uid() as the sole source of caller
-- identity (no client-supplied buyer/user/shop id is ever trusted),
-- EXECUTE revoked from PUBLIC/anon and granted only to authenticated. No
-- admin bypass.
--
-- Authorization: caller must equal orders.buyer_id. A seller, or any
-- unrelated user, both fail with NOT_ORDER_BUYER -- identical shape to
-- cancel_order_changes' own buyer-only check.
--
-- Lock strategy: ONLY the orders row is locked, FOR UPDATE, as the
-- universal serialization point shared by every order-state RPC in this
-- schema. This function makes no per-item decision, never mutates
-- order_items, and never mutates a listing, so neither an order_items
-- lock nor any listing lock is acquired -- matching cancel_order_changes'
-- own "order-row lock only" design exactly.
--
-- Idempotency: if the locked order's status is already 'cancelled',
-- return the current durable state with was_already_cancelled = true and
-- ZERO mutation -- correct regardless of which cancellation path
-- originally produced that state (today either this function or
-- cancel_order_changes; in the future, potentially other paths too). Any
-- OTHER non-pending status (changes_pending, accepted, declined, expired,
-- disputed, completed, ready, handed_over_or_shipped, received_confirmed)
-- is NOT treated as success -- ORDER_NOT_CANCELLABLE is raised instead.
-- This keeps workflow boundaries sharp: a changes_pending order must go
-- through cancel_order_changes, an accepted order must go through the
-- future cancellation-request flow -- neither is blurred into this
-- function.
--
-- Active-reservation corruption guard: a legitimate pending order never
-- holds an active inventory_reservations row -- accept_order_items is the
-- only function in this schema that ever creates one, and it only does
-- so in the same transaction that moves the order OFF pending (0016). An
-- ACTIVE reservation coexisting with status = 'pending' is therefore
-- structurally unreachable through this schema's own normal logic and
-- indicates corruption from outside the expected flow. Per the approved
-- design, this is NOT auto-repaired (not released, not consumed, no
-- listing/reserved_quantity mutation) and does NOT proceed with
-- cancellation -- RESERVATION_ALREADY_EXISTS is raised instead, failing
-- safely rather than risking permanently stranded inventory. Historical
-- reservations in 'released' or 'consumed' status do not block --
-- only 'active' rows are inspected. This check is a plain read, not a
-- FOR UPDATE lock on inventory_reservations: the orders-row lock already
-- held by this function serializes against the only function that ever
-- writes a reservation row (which itself locks the same orders row
-- first), so no additional lock is needed to make this check race-safe.
--
-- Malformed order_item state: this function deliberately does NOT
-- inspect or validate order_items shape beyond what's already implied by
-- orders.status = 'pending' with no active reservation. An unexpectedly
-- accepted, declined, or mixed item-state combination does NOT block
-- cancellation -- the active-reservation ledger is the schema's single
-- inventory-safety authority (matching cancel_order_changes' own "the
-- ledger is authoritative" reasoning), and item-status shape alone is
-- never treated as authoritative for inventory risk. Cancellation
-- remains the safe escape path for a malformed, non-reserved pending
-- order. No order_items row is read, locked, or written by this
-- function.
--
-- order_items: never touched. Seller decisions (if any exist,
-- unexpectedly, on a still-pending order) remain permanent historical
-- facts; normal pending items simply remain pending. The parent order's
-- cancellation records that the buyer ended the request before the
-- seller acted; it does not retroactively inspect or rewrite item rows.
--
-- Parent mutation: a fresh cancellation writes status = 'cancelled' and
-- cancelled_at = now() in the SAME UPDATE statement, per the project-wide
-- lifecycle-timestamp convention (0018): trusted order-state transitions
-- populate the matching timestamp atomically on first entry and never
-- erase or overwrite earlier lifecycle timestamps. No other lifecycle
-- timestamp column (accepted_at, declined_at, ready_at,
-- handed_over_or_shipped_at, received_confirmed_at, completed_at,
-- expired_at, disputed_at) is touched.
--
-- order_status_history: exactly one row on the success path -- from_status
-- = 'pending', to_status = 'cancelled', changed_by = auth.uid() (the
-- buyer), note always NULL (no reason parameter, nothing to record). No
-- per-item history rows. No order_cancellation_requests row is ever
-- created by this function -- that table remains reserved for the future
-- accepted-order request/confirm flow.
--
-- Notifications: none. Per instruction and per AGENTS.md's "email
-- failure must not roll back successful core marketplace state," any
-- future notification telling the seller the buyer withdrew the request
-- belongs to application code reacting after this transaction commits,
-- never inside it.
--
-- Seller-acceptance race: accept_order_items already locks the same
-- orders row first (0016). If this function wins the lock first, the
-- order becomes 'cancelled' and accept_order_items, arriving after, sees
-- a non-pending status and takes its own existing idempotent
-- zero-mutation return path -- since order_items may still all be
-- pending at that point, its derived accepted_item_ids/declined_item_ids
-- arrays may come back empty while order_status correctly reports
-- 'cancelled'; this is expected and acceptable, not a defect. If
-- accept_order_items wins the lock first, the order becomes accepted,
-- changes_pending, or declined, and this function, arriving after, sees
-- a non-pending, non-cancelled status and raises ORDER_NOT_CANCELLABLE.
-- No race-specific code is needed beyond the shared orders-row lock
-- already present in both functions.
--
-- Future expiry race (forward requirement, not built here): a future
-- pending-order expiry mechanism MUST also lock the orders row FOR
-- UPDATE first, before any of its own mutation, for the following
-- deterministic outcome to hold: if this function wins the lock first,
-- pending -> cancelled commits and the expiry path, arriving after, sees
-- a non-pending status and skips; if the expiry path wins first,
-- pending -> expired commits and this function, arriving after, sees
-- 'expired' -- already in its rejection list -- and raises
-- ORDER_NOT_CANCELLABLE. This requirement is documented here for that
-- future RPC's own design task; no expiry logic is created, simulated,
-- or assumed to exist by this migration.
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. A successful fresh cancellation
-- commits orders.status, orders.cancelled_at, and the single
-- order_status_history row together; any RAISE EXCEPTION (including
-- ORDER_NOT_CANCELLABLE and RESERVATION_ALREADY_EXISTS) leaves ZERO
-- mutation, with no intermediate state ever visible to another session.
--
-- Return shape: identical typed table to cancel_order_changes -- order_id,
-- order_status, was_already_cancelled -- deliberately shared rather than
-- independently shaped, since neither cancellation RPC carries any
-- item-decision payload; this lets calling code use one shared response
-- type for "any cancellation outcome" regardless of which RPC produced
-- it.

create or replace function public.cancel_pending_order(
  p_order_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_cancelled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_active_reservation_exists boolean;
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

  -- ===================== idempotency: already-cancelled is success, zero mutation =====================
  if v_order_status = 'cancelled' then
    return query
      select p_order_id, v_order_status, true;
    return;
  end if;

  -- ===================== only pending may be cancelled by this RPC =====================
  if v_order_status <> 'pending' then
    raise exception 'Order is not in a state this cancellation can be applied to.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== corruption guard: an active reservation must never exist here =====================
  select exists (
    select 1 from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
  ) into v_active_reservation_exists;

  if v_active_reservation_exists then
    raise exception 'An active inventory reservation exists for this order.' using detail = 'RESERVATION_ALREADY_EXISTS';
  end if;

  -- ===================== parent mutation: status + lifecycle timestamp together =====================
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'pending', 'cancelled', v_caller, null);

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false;
end;
$$;

revoke all on function public.cancel_pending_order(uuid) from public;
revoke all on function public.cancel_pending_order(uuid) from anon;
grant execute on function public.cancel_pending_order(uuid) to authenticated;
