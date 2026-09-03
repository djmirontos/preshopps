-- System-only batch expiry of overdue pending orders. Creates ONLY the
-- function and its grants/revokes. No scheduler, no cron, no Edge
-- Function, no reminder infrastructure, no single-order expiry RPC, no
-- tables/enums/indexes/triggers/policies, no application code, no
-- changes to any existing function.
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 21.7 / ARCHITECTURE.md 16 / ARCHITECTURE_ESSENTIALS 15 / AGENTS.md
-- Order State Machine all state this identically: "Unanswered order
-- requests expire after 72 hours" / "Accepted orders do not auto-expire."
-- No document names a source column for the 72h measurement and no
-- separate requested_at/submitted_at timestamp exists anywhere in the
-- schema -- orders.created_at IS the order-request submission instant by
-- construction, confirmed by elimination. No document frames expiry as a
-- buyer/seller UI action; it is treated here as system-only, consistent
-- with the approved design analysis. The ~24h seller reminder remains a
-- documented product requirement but is explicitly deferred (see the
-- forward-requirement comment near the end of this file) -- nothing here
-- blocks it, and nothing here implements it. Nothing beyond the approved
-- design is invented here.
--
-- =============================================================================
-- public.expire_pending_orders
-- =============================================================================
--
-- Signature: p_limit integer DEFAULT 100. The only function in this
-- schema with no buyer/seller actor at all -- there is no auth.uid() to
-- check, because the caller is not a person. It is invoked only by a
-- trusted server-side/service-role caller (a scheduler-triggered
-- operational route, or manual operational use), never by application
-- code running on a user's behalf.
--
-- Security: LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = ''
-- with every relation fully schema-qualified -- kept for consistency
-- with every other RPC in this schema and as defense-in-depth against
-- search_path hijacking, even though service_role already bypasses RLS
-- on its own. Privileges are the new part: EXECUTE is revoked from
-- PUBLIC, anon, AND authenticated, and granted only to service_role --
-- the first function in this schema where authenticated is deliberately
-- excluded rather than being the intended caller.
--
-- Ambiguity-bug defense (0021 lesson applied proactively): this
-- function's own RETURNS TABLE declares order_id, expired_at, and
-- anomaly. orders.expired_at is a real column sharing a name with an
-- output column, and inventory_reservations.order_id is a real column
-- sharing a name with another output column. Every table reference
-- therefore carries an explicit alias (o for orders, ir for
-- inventory_reservations) and every read of a column sharing a name with
-- an output column is alias-qualified (o.id, o.created_at, o.status,
-- ir.order_id, ir.status). orders.expired_at itself is never read
-- anywhere in this function (only ever written, as a bare UPDATE ... SET
-- target, which is always unambiguous regardless of alias presence per
-- the same reasoning already documented and empirically proven in 0022
-- and reused in 0023). Plain PL/pgSQL variable assignments to the output
-- columns (order_id := r.id; expired_at := v_now; anomaly := true/false;)
-- are host-language assignments, not SQL expressions resolved against a
-- FROM-list, and carry no ambiguity risk regardless of any column name
-- collision.
--
-- Batch-limit validation: p_limit is validated BEFORE any row is
-- touched. NULL, less than 1, or greater than 1000 raises
-- INVALID_BATCH_LIMIT. Although only a trusted service-role caller can
-- ever execute this function, an accidental NULL/unbounded/excessive
-- call must not defeat the purpose of bounded batching -- this is an
-- operational safety rail, not a defense against an adversarial caller.
-- Default remains 100.
--
-- Eligibility / cutoff: orders.status = 'pending' AND orders.created_at
-- <= now() - interval '72 hours'. orders.created_at is the immutable
-- submission-time source (timestamptz, NOT NULL) -- updated_at is
-- deliberately never used, since any unrelated future write could
-- silently and incorrectly extend a pending order's effective life.
-- Boundary is inclusive: an order becomes eligible the instant 72 hours
-- have fully elapsed (71h59m59s old is not yet eligible; exactly 72h00m00s
-- and anything older is eligible). timestamptz + now() are both absolute
-- instants on the UTC timeline internally, so the comparison is correct
-- regardless of the connecting session's timezone.
--
-- Selection / locking: ALL overdue pending orders are selected first --
-- the active-reservation anomaly check happens AFTER locking, per row,
-- not as a NOT EXISTS filter in the selection WHERE clause (a deliberate
-- refinement over the earlier design-analysis draft, so that an
-- anomalous order is actually surfaced in the return set rather than
-- silently vanishing from consideration). SELECT ... FOR UPDATE SKIP
-- LOCKED ORDER BY created_at, id LIMIT p_limit is the standard Postgres
-- job-queue pattern: a row already locked by a concurrent
-- accept_order_items or cancel_pending_order transaction (both lock
-- orders first, the same universal serialization point used by every
-- order-state RPC in this schema) is skipped rather than blocked on --
-- correct, since that row is, by definition, about to leave 'pending'.
-- Every selected row counts toward p_limit regardless of whether it is
-- later expired or surfaced as an anomaly, keeping every call
-- predictably bounded. Rows are processed oldest-first
-- (created_at, id -- id as a deterministic tiebreaker for orders sharing
-- the same created_at instant, matching the ORDER BY id tiebreak
-- convention already used elsewhere in this schema), and results are
-- returned in that same order.
--
-- Active-reservation anomaly: a legitimate pending order structurally
-- holds zero active reservations (submitting a request never reserves
-- stock; accept_order_items is the only function in this schema that
-- ever creates a reservation, and it does so in the same transaction
-- that moves the order OFF pending). An active reservation coexisting
-- with a locked, overdue, still-pending order is therefore corruption
-- from outside the expected flow. Once this function holds the order's
-- row lock, no legitimate concurrent reservation-creating transaction
-- can newly create a reservation for that order until this transaction
-- resolves -- so this check is a defensive corruption detector reading a
-- point-in-time fact under the order's own lock, not an inventory
-- workflow, and the reservation row itself is deliberately never locked
-- or touched. On a detected anomaly: the order is NOT expired, NOT
-- mutated in any way (status remains 'pending', expired_at remains
-- NULL), no history row is written (parent state did not change), and
-- processing continues with the rest of the batch -- one corrupted order
-- must never block legitimate overdue orders in the same batch from
-- expiring. No exception is raised for this business condition; it is
-- returned as anomaly = true. An anomalous order remains pending and may
-- legitimately surface as anomaly = true again on later invocations
-- until the underlying corruption is corrected -- that repeat visibility
-- is intentional, not a bug.
--
-- order_items: never inspected, locked, or mutated, on either the
-- expiry path or the anomaly path. Normal pending items remain pending.
-- A malformed pending parent whose items are already marked accepted,
-- declined, or a mix, still expires normally provided no active
-- reservation exists -- the reservation ledger, not item-status shape,
-- is this schema's sole authority for inventory risk (the same
-- reasoning already established in cancel_pending_order and reused in
-- cancel_accepted_order).
--
-- order_cancellation_requests: never inspected, locked, or mutated. A
-- legitimate pending parent cannot have one -- request_order_cancellation
-- only proceeds from 'accepted'/'ready'. If corrupt data somehow
-- produces a pending parent with a cancellation-request row, expiry
-- still proceeds provided there is no active reservation: unlike a
-- reservation, a stray request row carries zero inventory risk, so
-- treating it as a selection-blocking anomaly would be unwarranted
-- caution over a row this function was never going to touch either way.
-- It is not auto-confirmed, rejected, or deleted -- this RPC owns only
-- pending expiry.
--
-- Parent mutation (expiry path only): one UPDATE -- status = 'expired',
-- expired_at = now() -- in the same statement, leaving created_at,
-- accepted_at, ready_at, handed_over_or_shipped_at, received_confirmed_at,
-- completed_at, declined_at, cancelled_at, and disputed_at all
-- untouched, per the project-wide lifecycle-timestamp convention (0018).
--
-- Inventory neutrality: successful expiry performs ZERO reservation
-- creation, release, or consumption, ZERO stock_quantity or
-- reserved_quantity mutation, and ZERO listing status mutation.
-- public.listings is never referenced anywhere in this function.
--
-- History: exactly one order_status_history row per successfully
-- expired order -- from_status = 'pending', to_status = 'expired',
-- changed_by = NULL, note = NULL. changed_by is nullable
-- (ON DELETE SET NULL to profiles) and NULL is used deliberately to
-- represent a system transition -- no synthetic system user UUID is
-- invented, matching this schema's existing precedent of never
-- fabricating identity or data. An anomaly produces no history row at
-- all, since parent state did not change.
--
-- Idempotency: because selection strictly requires status = 'pending',
-- an already-expired order structurally cannot be reselected -- it
-- simply falls out of the eligibility predicate on every later
-- invocation. No duplicate expiry, no duplicate history, and no explicit
-- was_already_expired field is needed, unlike the single-order
-- idempotent-return RPCs elsewhere in this schema -- there is no
-- meaningful way to call this batch function "again" against one
-- specific already-expired order.
--
-- Buyer-cancel race: cancel_pending_order locks orders first (confirmed
-- read-only against its live definition before writing this migration).
-- If cancellation wins the lock first, pending -> cancelled commits and
-- this function's SELECT ... SKIP LOCKED either skips the row while
-- locked or, arriving after commit, no longer matches status = 'pending'
-- at all. If this function wins the lock first, pending -> expired
-- commits and a later cancel_pending_order call sees a non-pending,
-- non-cancelled status and raises its own existing ORDER_NOT_CANCELLABLE
-- -- zero modification to cancel_pending_order required or made.
--
-- Seller-accept race: accept_order_items locks orders first (confirmed
-- read-only against its live definition before writing this migration).
-- Its own non-pending branch is generic to any non-pending status, not
-- specific to any one value -- applied to a freshly-expired order it
-- returns was_already_processed = true, order_status = 'expired', and
-- empty accepted/declined-id arrays (since expiry never touches
-- order_items, every item is still 'pending', so nothing can be derived
-- as decided) -- a correct, zero-mutation idempotent response with zero
-- modification to accept_order_items required or made.
--
-- Other workflows: request_order_cancellation, cancel_order_changes, and
-- cancel_accepted_order all require a starting status other than
-- 'pending' (accepted/ready, changes_pending, and accepted/ready
-- respectively) -- none of them can ever observe a pending order, so
-- none of them can race against this function at all.
--
-- Transaction scope: one invocation is one Postgres transaction, matching
-- every other RPC in this schema. No per-row BEGIN/EXCEPTION
-- subtransactions are used -- the active-reservation anomaly is handled
-- through normal branching (an ordinary IF, not a caught exception),
-- since it is a detected condition read under the row's own lock, never
-- a failed write. A genuinely unexpected SQL failure rolls back the
-- whole batch, exactly like every other multi-row mutation in this
-- schema; the next scheduled invocation retries whatever is still
-- eligible.
--
-- Reminder -- forward requirement only, NOT implemented here: the
-- canonical ~24h-before-expiry seller reminder is a read-only
-- observation at a different age threshold than the 72h mutation this
-- function performs, and requires no mutation here at all. A future
-- reminder task should independently identify pending orders around 48
-- hours old and deduplicate notifications using whatever notification
-- infrastructure exists at that time (for example a reminded_at column
-- or a notifications-table entry) -- that decision belongs to that
-- future task, not this one. No reminded_at column, notification table,
-- or email logic is added by this migration.
--
-- Scheduler -- forward requirement only, NOT implemented here: pg_cron
-- is confirmed not installed in this project (re-confirmed read-only
-- immediately before writing this migration, consistent with the
-- earlier design-analysis finding). The approved MVP direction is an
-- external scheduler (for example a scheduled platform job) invoking
-- expire_pending_orders(100) approximately hourly through a thin
-- server-side route authenticated with service-role credentials -- all
-- business logic remains entirely inside this trusted SQL function; the
-- scheduler is a dumb, replaceable trigger with zero business logic. No
-- scheduler, cron configuration, Edge Function, or server route is
-- created by this migration.
--
-- Manual operation: service_role may invoke this function directly for
-- an operational sweep, a controlled backfill, or debugging. No
-- authenticated buyer/seller session can invoke it under any
-- circumstance -- there is no product concept of a buyer or seller
-- forcing expiry, and this function has no per-row ownership check by
-- design, since it operates system-wide across every shop.
--
-- Error codes: INVALID_BATCH_LIMIT is the only approved business input
-- error. There is no NOT_AUTHENTICATED, NOT_ORDER_SELLER, or
-- NOT_ORDER_BUYER, because this function has no caller identity to
-- check -- it is system-only. The active-reservation anomaly is
-- returned as anomaly = true, never raised as an exception. An
-- unexpected genuine SQL problem may still raise an ordinary Postgres
-- error, exactly as it would anywhere else in this schema.

create or replace function public.expire_pending_orders(
  p_limit integer default 100
)
returns table (
  order_id uuid,
  expired_at timestamptz,
  anomaly boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  r record;
  v_has_active_reservation boolean;
begin
  -- ===================== batch-limit validation (before any work) =====================
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Batch limit must be between 1 and 1000.' using detail = 'INVALID_BATCH_LIMIT';
  end if;

  v_now := now();

  -- ===================== select + lock overdue pending orders, oldest first =====================
  for r in
    select o.id
      from public.orders o
      where o.status = 'pending'
        and o.created_at <= v_now - interval '72 hours'
      order by o.created_at, o.id
      for update skip locked
      limit p_limit
  loop
    -- ===================== active-reservation anomaly check (defensive corruption detector) =====================
    select exists (
      select 1
      from public.inventory_reservations ir
      where ir.order_id = r.id and ir.status = 'active'
    ) into v_has_active_reservation;

    if v_has_active_reservation then
      order_id := r.id;
      expired_at := null;
      anomaly := true;
      return next;
      continue;
    end if;

    -- ===================== normal expiry: status + lifecycle timestamp together, nothing else touched =====================
    update public.orders as o
      set status = 'expired',
          expired_at = v_now
      where o.id = r.id;

    -- ===================== exactly one parent history row, system transition =====================
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
      values (r.id, 'pending', 'expired', null, null);

    order_id := r.id;
    expired_at := v_now;
    anomaly := false;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.expire_pending_orders(integer) from public;
revoke all on function public.expire_pending_orders(integer) from anon;
revoke all on function public.expire_pending_orders(integer) from authenticated;
grant execute on function public.expire_pending_orders(integer) to service_role;
