-- The second trusted inventory-mutating RPC: buyer confirmation of a
-- seller's partial acceptance. Creates ONLY the function and its
-- grants/revokes. No direct-cancel/cancellation-request/completion/
-- expiry RPCs, no notifications, no RLS policies, no cron, no other
-- schema objects.
--
-- Canonical-doc recheck before writing: PRD 21.5 ("Buyer must tap
-- Confirm Changes before remaining accepted items continue") is the sole
-- canonical basis for this RPC's existence — it establishes that Confirm
-- Changes ratifies a specific, already-shown item set, not a second
-- decision point. PRD 21.6 (never oversell) is the general principle
-- this RPC upholds via the same aggregate-then-lock discipline already
-- proven in 0016. PRD 23.1 is silent on changes_pending cancellation,
-- already resolved by the prior approved decision (direct cancel, no
-- request row — out of scope for this migration). No canonical doc
-- addresses stock revalidation timing, listing eligibility at
-- confirmation, or a "stuck order" recovery mechanism — every such rule
-- below is the approved engineering decision from the prior design-
-- analysis task, not a canonical requirement, and is documented as such.
-- No contradiction found between the approved design and canonical docs.
--
-- =============================================================================
-- public.confirm_order_changes
-- =============================================================================
--
-- Signature: p_order_id uuid only. Seller decisions already live
-- durably in order_items.status (accepted/declined) — the buyer ratifies
-- that exact revised offer and cannot renegotiate which items are
-- included by supplying their own item list.
--
-- Security: identical hardening to accept_order_items (0016) —
-- SECURITY DEFINER, SET search_path = '' with every object reference
-- fully schema-qualified, auth.uid() as the sole source of caller
-- identity, EXECUTE revoked from PUBLIC/anon and granted only to
-- authenticated. This is a direct continuation of the same pattern, not
-- a new privilege model.
--
-- Authorization: caller must equal orders.buyer_id (the inverse check
-- from accept_order_items, which checked shops.owner_id). A correct
-- seller for this order, or any unrelated user, both fail with
-- NOT_ORDER_BUYER — they are not authorized for this specific action
-- regardless of their other relationship to the order.
--
-- Lock order (same universal ordering preserved across every order-state
-- RPC in this schema): (1) orders row FOR UPDATE — the serialization
-- point that makes this RPC safely race against a concurrent direct-
-- cancel or a duplicate/retried confirm call; (2) this order's own
-- order_items FOR UPDATE ORDER BY id — cheap, exclusively owned by the
-- already-locked order; (3) distinct listings referenced by accepted
-- items, FOR UPDATE in ascending id order — the genuinely shared,
-- contended resource, locked in one global deterministic order to stay
-- deadlock-compatible with accept_order_items and every future order-
-- state RPC touching overlapping listings.
--
-- Idempotency: status = 'accepted' returns idempotent success
-- (was_already_confirmed = true, current durable item-id arrays, zero
-- mutation) — this is correct regardless of which RPC actually produced
-- 'accepted' (full seller acceptance also lands here), since from the
-- buyer's perspective "already accepted" always satisfies their intent.
-- Any OTHER non-changes_pending status (cancelled, declined, expired,
-- disputed, completed, or an unreachable pending) is NOT treated as
-- success — raising ORDER_NOT_CONFIRMABLE instead, because silently
-- returning success would misleadingly imply this call is what resolved
-- the order when something else already did.
--
-- Item-state invariants: a genuine changes_pending order always has
-- zero pending items, at least one accepted item, and at least one
-- declined item (guaranteed by construction — changes_pending is only
-- ever reached via accept_order_items' partial-outcome branch, which
-- requires both a nonzero accepted and nonzero declined count). Any
-- violation (a pending item found, zero accepted items, or zero declined
-- items) indicates structural corruption from outside the expected flow
-- and is NOT auto-repaired — INVALID_ORDER_ITEM_STATE is raised instead.
-- Likewise, a changes_pending order must never already have reservations
-- for its accepted items (accept_order_items' partial branch never
-- creates any); finding one is also corruption, raised as
-- RESERVATION_ALREADY_EXISTS rather than silently reused or deduplicated.
--
-- Listing eligibility and the all-or-nothing stock-conflict rule: a
-- NULL listing_id, a missing listing row, a blocked status (draft,
-- archived, sold), or insufficient available_quantity for a listing's
-- aggregate demand ALL raise ORDER_NO_LONGER_FULFILLABLE and abort the
-- ENTIRE call immediately, before any write. available, reserved
-- (governed by available_quantity, not the status label), and paused
-- (the seller already explicitly accepted this item; pausing new
-- discovery does not retract a recorded acceptance) are all eligible to
-- proceed to the quantity check. This is deliberately stricter than
-- accept_order_items, which converts an individual conflicting item into
-- a stock-conflict decline while other accepted items still proceed:
-- here, the buyer is confirming the EXACT set of items they were shown,
-- so a conflict on any one of them must fail the whole confirmation
-- rather than silently produce a different accepted set than what the
-- buyer agreed to — order_items.status is never rewritten by this
-- function under any circumstance, matching the approved design.
--
-- Aggregation: accepted items are grouped by listing_id and summed
-- before any stock check, never assuming one order_item per listing —
-- same reasoning as 0016. All accepted listings are validated (locked,
-- checked) in one pass before any write occurs anywhere; the first
-- listing that fails aborts the whole function via RAISE EXCEPTION,
-- which naturally leaves nothing written since nothing was written yet.
--
-- Reservation creation and reserved_quantity: identical mechanics to
-- accept_order_items' accepted-outcome path — one active
-- inventory_reservations row per accepted item (quantity copied exactly
-- from order_items.quantity), inserted before the cached aggregate
-- update (the ledger is authoritative, per 0014's own design). Each
-- listing's reserved_quantity is updated using the value read under its
-- own FOR UPDATE lock, never available_quantity directly (a generated
-- column). Listing status flips to 'reserved' only when the resulting
-- available_quantity = 0 AND the current status is 'available' or
-- 'reserved'; 'paused' is never touched; any available_quantity > 0
-- outcome leaves status completely untouched, for the same reason
-- already established in 0016 — this function's own pre-validation
-- makes an inconsistent "reserved-with-slack" result unreachable through
-- its own logic, so an unexplained inconsistency is left alone rather
-- than guessed at.
--
-- order_items.status is NEVER written by this function — accepted stays
-- accepted, declined stays declined. This function's only role is to
-- ratify an already-fully-decided item set, not to decide anything
-- itself, which is the key structural difference from accept_order_items.
--
-- order_status_history: exactly one row on the success path —
-- from_status = 'changes_pending', to_status = 'accepted', changed_by =
-- auth.uid() (the buyer, correctly attributed since changed_by is
-- actor-agnostic by design), note always NULL — there is no partial or
-- annotated success on this RPC (per the all-or-nothing rule above), so
-- there is never a case within a successful confirmation that needs an
-- explanatory note. No per-item history rows.
--
-- Race behavior: this RPC and any future direct-cancel-from-
-- changes_pending RPC both lock the orders row first, so whichever
-- acquires it first wins. If confirm wins, the order becomes 'accepted'
-- and a losing concurrent cancel attempt must reject (an accepted order
-- requires the cancellation-request flow from 0013, not a direct
-- cancel) — that rejection belongs to the future cancel RPC, not here.
-- If cancel wins, this RPC observes a non-changes_pending, non-accepted
-- status and raises ORDER_NOT_CONFIRMABLE. A competing order racing for
-- the same listing's last unit is resolved by whichever transaction
-- locks that listing row first; the loser's fresh read under its own
-- lock correctly detects insufficient stock and raises
-- ORDER_NO_LONGER_FULFILLABLE, leaving the order in changes_pending with
-- zero mutation — no overselling.
--
-- Return shape: a typed table, no jsonb — order_id, order_status,
-- was_already_confirmed, accepted_item_ids, declined_item_ids. No
-- stock_conflict_item_ids column: unlike accept_order_items, a stock
-- conflict here is always a hard exception (ORDER_NO_LONGER_FULFILLABLE)
-- with zero mutation, never a soft/partial outcome with something
-- structured to report in a success row. The conflicting item/listing
-- details are deliberately not embedded in the exception text; the
-- frontend can re-derive the exact conflict via a normal read (accepted
-- order_items joined against live listings.available_quantity), which
-- avoids inventing a text-encoding convention inside an exception.
--
-- Atomicity: identical guarantee to accept_order_items — this function
-- body is the one Postgres transaction the RPC call runs in; every write
-- (inventory_reservations, listings, orders, order_status_history)
-- either all commit together or, on any RAISE EXCEPTION (including
-- ORDER_NO_LONGER_FULFILLABLE), all roll back together with zero
-- intermediate state ever visible to another session.

create or replace function public.confirm_order_changes(
  p_order_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_confirmed boolean,
  accepted_item_ids uuid[],
  declined_item_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;

  v_accepted_ids uuid[];
  v_declined_ids uuid[];
  v_pending_count integer;
  v_existing_reservation_count integer;

  v_listing_ids uuid[] := '{}';
  v_listing_new_reserved integer[] := '{}';
  v_listing_new_available integer[] := '{}';
  v_listing_old_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_avail_qty integer;
  v_listing_status public.listing_status_enum;

  v_derived_accepted uuid[];
  v_derived_declined uuid[];

  i integer;
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

  -- ===================== idempotency / status precondition =====================
  if v_order_status = 'accepted' then
    select coalesce(array_agg(oi.id) filter (where oi.status = 'accepted'), '{}'),
           coalesce(array_agg(oi.id) filter (where oi.status = 'declined'), '{}')
      into v_derived_accepted, v_derived_declined
      from public.order_items oi
      where oi.order_id = p_order_id;

    return query
      select p_order_id, v_order_status, true, v_derived_accepted, v_derived_declined;
    return;
  end if;

  if v_order_status <> 'changes_pending' then
    raise exception 'Order is not awaiting buyer confirmation.' using detail = 'ORDER_NOT_CONFIRMABLE';
  end if;

  -- ===================== lock this order's order_items rows =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  select coalesce(array_agg(oi.id order by oi.id) filter (where oi.status = 'accepted'), '{}'),
         coalesce(array_agg(oi.id order by oi.id) filter (where oi.status = 'declined'), '{}'),
         count(*) filter (where oi.status = 'pending')
    into v_accepted_ids, v_declined_ids, v_pending_count
    from public.order_items oi
    where oi.order_id = p_order_id;

  -- ===================== required item-state invariants =====================
  if v_pending_count > 0
     or coalesce(array_length(v_accepted_ids, 1), 0) = 0
     or coalesce(array_length(v_declined_ids, 1), 0) = 0 then
    raise exception 'This order is not in a valid changes-pending state.' using detail = 'INVALID_ORDER_ITEM_STATE';
  end if;

  select count(*) into v_existing_reservation_count
    from public.inventory_reservations r
    where r.order_item_id = any(v_accepted_ids);

  if v_existing_reservation_count > 0 then
    raise exception 'An inventory reservation already exists for this order.' using detail = 'RESERVATION_ALREADY_EXISTS';
  end if;

  -- ===================== NULL listing_id on an accepted item: whole call fails =====================
  if exists (
    select 1 from public.order_items oi
    where oi.id = any(v_accepted_ids) and oi.listing_id is null
  ) then
    raise exception 'This order can no longer be fulfilled as offered.' using detail = 'ORDER_NO_LONGER_FULFILLABLE';
  end if;

  -- ===================== validate every accepted listing before any write =====================
  for v_listing_id, v_agg_qty in
    select oi.listing_id, sum(oi.quantity)::integer
      from public.order_items oi
      where oi.id = any(v_accepted_ids)
      group by oi.listing_id
      order by oi.listing_id
  loop
    select l.stock_quantity, l.reserved_quantity, l.available_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_avail_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_id
      for update;

    if not found
       or v_listing_status in ('draft', 'archived', 'sold')
       or v_avail_qty < v_agg_qty then
      raise exception 'This order can no longer be fulfilled as offered.' using detail = 'ORDER_NO_LONGER_FULFILLABLE';
    end if;

    v_listing_ids := v_listing_ids || v_listing_id;
    v_listing_new_reserved := v_listing_new_reserved || (v_reserved_qty + v_agg_qty);
    v_listing_new_available := v_listing_new_available || (v_avail_qty - v_agg_qty);
    v_listing_old_status := v_listing_old_status || v_listing_status;
  end loop;

  -- ===================== all validations passed: create reservations, update listings =====================
  insert into public.inventory_reservations (listing_id, order_id, order_item_id, shop_id, quantity)
    select oi.listing_id, oi.order_id, oi.id, oi.shop_id, oi.quantity
      from public.order_items oi
      where oi.id = any(v_accepted_ids);

  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set reserved_quantity = v_listing_new_reserved[i],
          status = case
            when v_listing_new_available[i] = 0 and v_listing_old_status[i] in ('available', 'reserved')
              then 'reserved'::public.listing_status_enum
            else status
          end
      where id = v_listing_ids[i];
  end loop;

  -- ===================== parent order + history =====================
  update public.orders set status = 'accepted' where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'changes_pending', 'accepted', v_caller, null);

  return query
    select p_order_id, 'accepted'::public.order_status_enum, false, v_accepted_ids, v_declined_ids;
end;
$$;

revoke all on function public.confirm_order_changes(uuid) from public;
revoke all on function public.confirm_order_changes(uuid) from anon;
grant execute on function public.confirm_order_changes(uuid) to authenticated;
