-- The third trusted inventory-adjacent RPC in the acceptance/confirmation
-- sequence: buyer direct-cancel of a changes_pending order (the seller's
-- partial-acceptance offer). Creates ONLY the function and its
-- grants/revokes. No pending-order direct-cancel RPC, no accepted-order
-- cancellation-request RPC, no seller-cancellation RPC, no completion/
-- expiry RPCs, no notifications, no RLS policies, no cron, no other
-- schema objects.
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 23.1 defines exactly two buyer-cancellation paths: while Pending,
-- the buyer cancels immediately; after Accepted, the buyer submits a
-- request the seller must confirm. It is silent on changes_pending --
-- already flagged as a genuine open question in 0015's own header
-- comment ("the buyer has not yet agreed to the seller's revised offer
-- at all -- there is nothing for the buyer to be 'requesting permission'
-- to walk away from... deferred to the future trusted RPC design"). This
-- task's approved product decision resolves that open question exactly
-- along the lines 0015 anticipated: changes_pending behaves like pending
-- in this respect (direct cancel, no request row), not like accepted
-- (no seller confirmation step). This does not contradict PRD 23.1 --
-- it extends its existing two-path dichotomy to cover the one state PRD
-- 23.1 never named, using the same reasoning PRD 23.1 already applies to
-- the Pending case (buyer hasn't committed to anything the seller need
-- confirm walking away from). No other canonical doc (ARCHITECTURE.md,
-- ARCHITECTURE_ESSENTIALS.md, AGENTS.md, CLAUDE.md) names changes_pending
-- cancellation behavior or proposes different terminology. No
-- contradiction found; nothing beyond the approved decision is invented.
--
-- =============================================================================
-- public.cancel_order_changes
-- =============================================================================
--
-- Signature: p_order_id uuid only, matching the approved MVP scope (no
-- cancellation-reason parameter). This RPC handles exactly one transition:
-- changes_pending -> cancelled. It is deliberately NOT the generic buyer
-- cancellation entry point -- a pending order's direct cancellation and
-- an accepted order's cancellation-request flow are separate, not-yet-
-- built RPCs; calling this function against any other status is a hard
-- error, never silently reinterpreted as one of those other flows.
--
-- Security: identical hardening to accept_order_items (0016) and
-- confirm_order_changes (0017) -- SECURITY DEFINER, SET search_path = ''
-- with every object reference fully schema-qualified, auth.uid() as the
-- sole source of caller identity (no client-supplied buyer/user/shop id
-- is ever trusted), EXECUTE revoked from PUBLIC/anon and granted only to
-- authenticated. No admin bypass -- an admin-initiated cancellation, if
-- ever needed, is a separate future concern, not a hidden path through
-- this buyer-only function.
--
-- Authorization: caller must equal orders.buyer_id. A correct seller for
-- this order, or any unrelated user, both fail with NOT_ORDER_BUYER --
-- symmetric with confirm_order_changes' own buyer-only check, and the
-- mirror image of accept_order_items' seller-only check.
--
-- Lock strategy (deliberately narrower than accept_order_items/
-- confirm_order_changes): ONLY the orders row is locked, FOR UPDATE, as
-- the universal serialization point shared by every order-state RPC in
-- this schema. This function makes no per-item decision and never
-- mutates order_items, so no order_items lock is acquired (the task's
-- own instruction: "Do NOT lock order_items unless truly required" --
-- it is not required here, unlike accept_order_items/confirm_order_changes
-- which must read and classify individual items). No listing is locked
-- or touched at all, since a genuine changes_pending order holds no
-- reservation and this function performs no inventory mutation. Holding
-- the orders lock for the duration of this function is still sufficient
-- to serialize against every other RPC that could race on this same
-- order (accept_order_items, confirm_order_changes, a future accepted-
-- order cancellation-request flow), because all of them acquire the same
-- orders-row lock first, before doing anything else.
--
-- Idempotency: if the locked order's status is already 'cancelled',
-- return the current durable state with was_already_cancelled = true and
-- ZERO mutation -- correct regardless of which cancellation path
-- originally produced that state (this RPC today is the only one that
-- can produce it, but the check is written against the state, not
-- against "did I do this," matching the same idempotency philosophy as
-- 0016/0017). Any OTHER non-changes_pending status (pending, accepted,
-- declined, expired, disputed, completed, ready, handed_over_or_shipped,
-- received_confirmed) is NOT treated as success -- ORDER_NOT_CANCELLABLE
-- is raised instead, since this function is not the generic cancellation
-- entry point for those states.
--
-- Active-reservation corruption guard: a genuine changes_pending order
-- never holds an active inventory_reservations row -- accept_order_items'
-- partial-outcome branch deliberately never creates one (0016), and
-- confirm_order_changes is the only function that ever creates one for a
-- changes_pending order, at which point the order is no longer
-- changes_pending (it becomes accepted in that same transaction, 0017).
-- Finding an ACTIVE reservation on a changes_pending order is therefore
-- unreachable through this schema's own normal logic and indicates
-- structural/business corruption from outside the expected flow. Per
-- the approved design, this is NOT auto-repaired (not released, not
-- consumed, listing/reserved_quantity left completely untouched) and
-- does NOT proceed with cancellation -- RESERVATION_ALREADY_EXISTS is
-- raised instead, failing safely rather than risking permanently
-- stranded inventory. Historical reservations in 'released' or
-- 'consumed' status do not block cancellation -- only 'active' rows are
-- inspected. This check is a plain read (not a FOR UPDATE lock on
-- inventory_reservations): the orders-row lock already held by this
-- function serializes against the only two functions that ever write a
-- reservation row (both of which lock the same orders row first), so no
-- additional lock is needed to make this check race-safe.
--
-- Malformed order_item state: this function deliberately does NOT
-- inspect or validate order_items shape beyond what's already implied by
-- orders.status = 'changes_pending' with no active reservation. A
-- leftover pending item, zero accepted items, zero declined items, or
-- any other unexpected combination does NOT block cancellation --
-- cancellation is the safe escape path for a malformed, non-reserved
-- order, and refusing to let the buyer cancel out of an already-broken
-- order would only compound the problem. No order_items row is read,
-- locked, or written by this function.
--
-- order_items: never updated. Seller decisions remain permanent
-- historical facts -- an item already marked 'accepted' stays 'accepted'
-- and one marked 'declined' stays 'declined' (and, per the paragraph
-- above, an unexpected leftover 'pending' item is also left exactly as
-- is). The parent order's cancellation records that the buyer chose not
-- to continue with the seller's revised offer; it does not retroactively
-- rewrite what the seller decided.
--
-- Parent mutation: a fresh cancellation writes status = 'cancelled' and
-- cancelled_at = now() in the SAME UPDATE statement, per the project-wide
-- lifecycle-timestamp convention adopted in 0018 ("trusted order-state
-- transitions populate the matching lifecycle timestamp atomically on
-- first entry and never erase or overwrite historical lifecycle
-- timestamps"). No other lifecycle timestamp column is touched --
-- accepted_at and declined_at (if either happens to be set from an
-- earlier stage of this same order's history) are left exactly as they
-- are, preserved as permanent historical fact, matching 0018's own
-- preservation guarantee.
--
-- order_status_history: exactly one row on the success path -- from_status
-- = 'changes_pending', to_status = 'cancelled', changed_by = auth.uid()
-- (the buyer), note always NULL (there is no cancellation-reason
-- parameter in this MVP signature, so there is nothing to record). No
-- per-item history rows. No order_cancellation_requests row is ever
-- created by this function -- that table exists for the future accepted-
-- order request/confirm flow, not this direct-cancel path.
--
-- Notifications: none. Per instruction and per AGENTS.md's "email
-- failure must not roll back successful core marketplace state," any
-- future notification telling the seller their revised offer was
-- declined belongs to application code reacting after this transaction
-- commits, never inside it.
--
-- Confirm-vs-cancel race: both confirm_order_changes and this function
-- lock the SAME orders row first, so whichever transaction acquires that
-- lock first commits its transition, and the other -- upon acquiring the
-- lock afterward -- observes the already-changed status. If confirm wins
-- first, this function sees 'accepted' and raises ORDER_NOT_CANCELLABLE
-- (the buyer must then use the future accepted-order cancellation-request
-- flow). If this function wins first, confirm_order_changes sees
-- 'cancelled' -- not 'changes_pending' and not its own idempotent-success
-- 'accepted' case -- and raises ORDER_NOT_CONFIRMABLE; no reservation can
-- ever be created after cancellation, since confirm_order_changes' own
-- reservation-creation code is only reachable past that status check.
-- This deterministic, lock-ordered outcome requires no special-casing in
-- either function beyond the status checks each already has.
--
-- Seller-action race: accept_order_items invoked against an already-
-- changes_pending order already takes its own non-pending idempotent
-- zero-mutation return path (0016) -- it never re-decides items or
-- creates a reservation for an order that isn't 'pending'. Combined with
-- the same orders-row-lock-first discipline, no inventory conflict can
-- arise between a concurrent accept_order_items retry and this function.
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. A successful fresh cancellation
-- commits orders.status, orders.cancelled_at, and the single
-- order_status_history row together; any RAISE EXCEPTION (including
-- ORDER_NOT_CANCELLABLE and RESERVATION_ALREADY_EXISTS) leaves ZERO
-- mutation, with no intermediate state ever visible to another session.
--
-- Return shape: a typed table, no jsonb -- order_id, order_status,
-- was_already_cancelled -- matching the plain-typed-table philosophy
-- already used by accept_order_items and confirm_order_changes. No item
-- arrays: this function makes no per-item decision, so there is nothing
-- item-shaped to report back.

create or replace function public.cancel_order_changes(
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

  -- ===================== only changes_pending may be cancelled by this RPC =====================
  if v_order_status <> 'changes_pending' then
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
    values (p_order_id, 'changes_pending', 'cancelled', v_caller, null);

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false;
end;
$$;

revoke all on function public.cancel_order_changes(uuid) from public;
revoke all on function public.cancel_order_changes(uuid) from anon;
grant execute on function public.cancel_order_changes(uuid) to authenticated;
