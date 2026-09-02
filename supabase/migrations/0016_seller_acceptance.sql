-- The first trusted inventory-mutating RPC: seller acceptance of a
-- pending order's items. Creates ONLY the function and its
-- grants/revokes. No new tables, no buyer-confirmation/cancellation/
-- completion/expiry RPCs, no notifications, no RLS policies, no cron.
--
-- Canonical-doc recheck before writing: PRD 21.4/21.5 (accept/decline/
-- partial accept, buyer must confirm partial changes), PRD 21.6 (no
-- reservation at submission, reserve only at acceptance, prevent
-- acceptance beyond available quantity), PRD 29.2 (qty-1 accepted ->
-- Reserved; qty>1 stays Available until available_quantity reaches
-- zero), and the explicitly approved decisions from the two prior tasks
-- in this sequence (0015's changes_pending state; this task's own
-- itemized acceptance-behavior spec). No contradiction found between
-- those approved decisions and canonical docs; this migration implements
-- exactly what was approved, inventing nothing beyond it.
--
-- =============================================================================
-- public.accept_order_items
-- =============================================================================
--
-- Signature: p_order_id uuid, p_accepted_item_ids uuid[],
-- p_declined_item_ids uuid[]. Every currently-pending order_item for the
-- order must receive an explicit decision — omission is never treated as
-- an implicit decline (per the approved design-analysis recommendation).
--
-- Security: SECURITY DEFINER (RLS will eventually default-deny direct
-- client writes; this function performs its own authorization instead of
-- relying on RLS), SET search_path = '' with every object reference
-- fully schema-qualified (matching the hardened pattern already
-- established for handle_new_user in 0004). auth.uid() is the sole
-- source of caller identity — no client-supplied user/shop/seller id is
-- ever trusted. EXECUTE is revoked from PUBLIC and anon and granted only
-- to authenticated, so an unauthenticated/guest caller cannot invoke
-- this function at all (in addition to the internal auth.uid() check,
-- which still applies as defense in depth and produces a clean domain
-- error rather than a bare permission failure for any caller that
-- somehow reaches the function body without a valid session).
--
-- Lock order (matches the universal order this schema will preserve
-- across accept/cancel/complete/expire): (1) the orders row FOR UPDATE —
-- the universal serialization point every order-state-changing RPC must
-- acquire first, so that a concurrent buyer-direct-cancel, expiry sweep,
-- or a duplicate/retried acceptance call is always safely serialized
-- against this one; (2) this order's own order_items rows FOR UPDATE,
-- ordered by id — cheap and exclusively owned by the already-locked
-- order, so not strictly load-bearing for cross-transaction safety once
-- the order lock is held, but acquired anyway as defense in depth; (3)
-- the distinct listings referenced by seller-selected accepted items,
-- locked FOR UPDATE in ascending id order — the genuinely shared,
-- contended resource across many orders, so it must always be locked in
-- one global deterministic order to prevent cross-transaction deadlocks
-- with any other RPC touching overlapping listings.
--
-- Idempotency: if the locked order's status is not 'pending', NOTHING is
-- validated or mutated. The function returns the order's current,
-- durable state with was_already_processed = true, derived directly from
-- order_items.status (accepted/declined item id arrays) rather than
-- raising an error — a retried/duplicated call (network retry, seller
-- double-click, a losing concurrent session) is not a caller error, it
-- is "the thing you wanted already happened." Because historical
-- stock-conflict attribution is not stored per item anywhere in the
-- schema, stock_conflict_item_ids is always returned as an empty array
-- on this path — documented here and in the final report as a known,
-- accepted limitation, not an oversight: a caller cannot retroactively
-- learn which items (if any) were auto-declined for stock reasons on a
-- call whose original response was lost, only that the order is already
-- resolved and what its final item-level outcome was.
--
-- Input validation (in this order, each a hard RAISE EXCEPTION with a
-- stable machine-readable code carried in the exception DETAIL, per the
-- approved error strategy — no custom SQLSTATEs invented):
--   1. NULL arrays are normalized to empty arrays first (coalesce), then
--      completeness validation below decides whether the resulting
--      payload is actually valid — matches the approved preference.
--   2. Duplicate IDs within either array, or the same ID appearing in
--      both arrays -> DUPLICATE_ITEM_DECISION. A NULL element inside
--      either array is treated the same way (never a valid item id).
--   3. Any decided ID that does not belong to this order ->
--      ITEM_NOT_IN_ORDER.
--   4. Any decided ID whose order_item is not currently 'pending' ->
--      ITEM_ALREADY_DECIDED.
--   5. Any currently-pending order_item absent from both arrays ->
--      INVALID_ITEM_DECISIONS (the completeness rule: the decision union
--      must equal exactly the pending set, no more, no less).
--   6. An order with zero pending order_items at the moment of decision
--      (a defensive, not-normally-reachable guard, since order
--      submission always creates at least one order_item) also raises
--      INVALID_ITEM_DECISIONS rather than silently producing a
--      zero-item "declined" order.
--
-- Listing eligibility and aggregation for seller-selected accepted
-- items: quantities are summed per distinct listing_id BEFORE any stock
-- check (never assuming one order_item per listing — nothing in the
-- schema forbids multiple order_items against the same listing within
-- one order). For each distinct listing: a NULL listing_id, a listing
-- row that no longer exists, a listing whose status is draft/archived/
-- sold, or an aggregate quantity exceeding available_quantity all
-- produce the same outcome — every order_item selected for acceptance
-- against that listing (or, for a NULL listing_id, that specific item)
-- becomes a STOCK-CONFLICT DECLINE. available/reserved/paused listings
-- are eligible to proceed to the quantity check (paused is deliberately
-- included: the seller is knowingly honoring an already-pending request
-- for a listing they separately chose to hide from new discovery, and
-- this function never reopens a paused listing's visibility). One
-- deliberate, explicitly-flagged design choice: when an aggregate
-- exceeds available_quantity for a listing referenced by MULTIPLE
-- accepted order_items in this same order, ALL of that listing's
-- selected items become stock-conflict declines together, rather than
-- partially satisfying some of them — no canonical doc or approved
-- decision defines a fairness/tie-breaking rule for splitting a
-- constrained listing's stock across several lines of the same order,
-- and inventing one here would be exactly the kind of silent behavior
-- this project avoids. A single order_item is never partially accepted
-- by quantity, matching the approved product model.
--
-- Outcome determination, after final item classification: if every
-- currently-pending item ends up accepted -> 'accepted' (full
-- acceptance; this is only reachable when zero stock conflicts occurred,
-- since any conflict removes at least one item from the accepted set).
-- If zero items end up accepted -> 'declined' (full decline — reached
-- either because the seller explicitly declined everything, or because
-- every seller-selected accepted item failed stock validation; either
-- way the schema-level outcome is identical, and the history note
-- distinguishes the stock-conflict case). Otherwise -> 'changes_pending'
-- (partial acceptance).
--
-- Reservation/inventory mutation happens ONLY on the 'accepted' (full
-- acceptance) outcome — this is the critical, explicitly approved
-- constraint of this whole design. For 'declined', nothing inventory-
-- related is touched. For 'changes_pending', item-level order_items
-- status is still written (accepted/declined per final classification,
-- so no item is left 'pending'), but NO inventory_reservations rows are
-- created, NO listings.reserved_quantity is mutated, and NO
-- listings.status is mutated — even though this function already had to
-- classify and lock the referenced listings to determine the item-level
-- outcome. This intentionally leaves stock unblocked for an offer the
-- buyer has not yet agreed to; the future buyer-confirmation RPC must
-- independently re-lock and re-validate inventory before actually
-- reserving anything, since stock may have changed in the interim.
--
-- On the 'accepted' outcome specifically, in this sequence within the
-- same transaction: (1) insert one inventory_reservations row per
-- finally-accepted item (quantity copied exactly from order_items.
-- quantity, status defaults to 'active', resolved_at stays NULL) —
-- UNIQUE(order_item_id) is the structural idempotency backstop against
-- ever double-reserving the same item, on top of this function's own
-- pending-status precondition; (2) update listings.reserved_quantity +=
-- the aggregate accepted quantity per listing, using the values already
-- read under the FOR UPDATE lock (never available_quantity directly —
-- it is a generated column); (3) update listings.status only when the
-- resulting available_quantity = 0 AND the current status is 'available'
-- or 'reserved' (-> 'reserved'); a 'paused' listing is never touched by
-- this function, matching "do not reopen/reinterpret a deliberate seller
-- visibility state." When available_quantity remains > 0 after the
-- update, status is left completely untouched: reasoned through
-- explicitly here because this function's own pre-validation (available_
-- quantity >= aggregate) makes it structurally impossible, via this
-- function's own logic, for a listing to reach this point with
-- available_quantity > 0 while its status is already 'reserved' from an
-- earlier, smaller reservation against the same available pool in THIS
-- transaction — if that were true, the aggregate check would already
-- have failed. A 'reserved' status found here could therefore only be a
-- pre-existing, externally-caused inconsistency, and the safest response
-- to an unexplained inconsistency is to leave it alone rather than guess
-- a correction.
--
-- order_status_history: exactly one row is inserted per call that
-- actually mutates state (never on the idempotent no-op path) —
-- from_status = 'pending', to_status = the resolved outcome, changed_by
-- = auth.uid(), note = NULL when no stock conflicts occurred, or a short
-- system-generated summary of how many items were auto-declined for
-- stock reasons when they did. No per-item history rows are written;
-- item-level outcomes already live durably in order_items.
--
-- Notifications: none. Per instruction and per AGENTS.md's "email
-- failure must not roll back successful core database operations," any
-- future notification dispatch belongs to application code reacting
-- after this transaction commits, never inside it.
--
-- Cancellation/expiry race: this function does not query
-- order_cancellation_requests at all. Per the approved interaction
-- model, a Pending order's buyer cancellation is direct (no request-
-- table row involved), and the real protection against a concurrent
-- buyer-cancel or expiry-sweep race is that every order-state-changing
-- RPC — this one included — locks the same orders row FOR UPDATE before
-- checking status. Whichever transaction acquires that lock first
-- commits its transition; the loser, upon acquiring the lock afterward,
-- observes the already-changed status and (via the idempotency check
-- above) safely takes the no-mutation path rather than corrupting state.
--
-- Return shape: a typed table, not jsonb — order_id, order_status,
-- was_already_processed, accepted_item_ids, declined_item_ids,
-- stock_conflict_item_ids — chosen for clean TypeScript typing through
-- Supabase's generated types, mirroring the plain-array philosophy
-- already used for this function's own input parameters.
--
-- Atomicity: this entire function body executes as the one Postgres
-- transaction the RPC call runs in. Every write (order_items, orders,
-- inventory_reservations, listings, order_status_history) either all
-- commit together or, on any RAISE EXCEPTION, all roll back together —
-- no intermediate state is ever visible to another session, and no
-- external side effect (email, notification) exists inside this
-- function to break that guarantee.

create or replace function public.accept_order_items(
  p_order_id uuid,
  p_accepted_item_ids uuid[],
  p_declined_item_ids uuid[]
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_processed boolean,
  accepted_item_ids uuid[],
  declined_item_ids uuid[],
  stock_conflict_item_ids uuid[]
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

  v_accepted_ids uuid[];
  v_declined_ids uuid[];
  v_all_decided_ids uuid[];
  v_pending_ids uuid[];
  v_bad_ids uuid[];
  v_missing_ids uuid[];

  v_stock_conflict_ids uuid[] := '{}';
  v_final_accepted_ids uuid[];
  v_final_declined_ids uuid[];
  v_conflict_batch uuid[];

  v_ok_listing_ids uuid[] := '{}';
  v_ok_listing_qty integer[] := '{}';
  v_ok_listing_new_reserved integer[] := '{}';
  v_ok_listing_new_available integer[] := '{}';
  v_ok_listing_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_avail_qty integer;
  v_listing_status public.listing_status_enum;

  v_accepted_count integer;
  v_total_count integer;
  v_outcome_status public.order_status_enum;
  v_note text;

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
  select o.status, o.shop_id
    into v_order_status, v_order_shop_id
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

  -- ===================== idempotency: only a pending order may be processed =====================
  if v_order_status <> 'pending' then
    select coalesce(array_agg(oi.id) filter (where oi.status = 'accepted'), '{}'),
           coalesce(array_agg(oi.id) filter (where oi.status = 'declined'), '{}')
      into v_derived_accepted, v_derived_declined
      from public.order_items oi
      where oi.order_id = p_order_id;

    return query
      select p_order_id, v_order_status, true, v_derived_accepted, v_derived_declined, '{}'::uuid[];
    return;
  end if;

  -- ===================== normalize input =====================
  v_accepted_ids := coalesce(p_accepted_item_ids, '{}');
  v_declined_ids := coalesce(p_declined_item_ids, '{}');

  if exists (select 1 from unnest(v_accepted_ids) u where u is null)
     or exists (select 1 from unnest(v_declined_ids) u where u is null) then
    raise exception 'Item decision arrays may not contain a null item id.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- duplicate ids within either array, or the same id in both arrays
  if (select count(*) from unnest(v_accepted_ids)) <> (select count(distinct u) from unnest(v_accepted_ids) u)
     or (select count(*) from unnest(v_declined_ids)) <> (select count(distinct u) from unnest(v_declined_ids) u)
     or exists (
       select 1 from unnest(v_accepted_ids) a join unnest(v_declined_ids) d on a = d
     ) then
    raise exception 'Duplicate or overlapping item decisions are not allowed.' using detail = 'DUPLICATE_ITEM_DECISION';
  end if;

  v_all_decided_ids := v_accepted_ids || v_declined_ids;

  -- ===================== lock this order's order_items rows =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  select coalesce(array_agg(oi.id order by oi.id), '{}') into v_pending_ids
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'pending';

  v_total_count := coalesce(array_length(v_pending_ids, 1), 0);
  if v_total_count = 0 then
    raise exception 'Order has no pending items to decide.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- every decided id must belong to this order
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    where not exists (
      select 1 from public.order_items oi where oi.id = x and oi.order_id = p_order_id
    );
  if v_bad_ids is not null then
    raise exception 'One or more item IDs do not belong to this order.' using detail = 'ITEM_NOT_IN_ORDER';
  end if;

  -- every decided id must currently be pending
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    join public.order_items oi on oi.id = x and oi.order_id = p_order_id
    where oi.status <> 'pending';
  if v_bad_ids is not null then
    raise exception 'One or more items have already been decided.' using detail = 'ITEM_ALREADY_DECIDED';
  end if;

  -- every pending item must receive an explicit decision (completeness rule)
  select array_agg(x) into v_missing_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_all_decided_ids));
  if v_missing_ids is not null then
    raise exception 'Every pending item must receive an explicit decision.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- ===================== stock-conflict items with a NULL listing_id =====================
  select array_agg(oi.id) into v_conflict_batch
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and oi.listing_id is null;
  if v_conflict_batch is not null then
    v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
  end if;

  -- ===================== lock referenced listings in deterministic order, classify =====================
  for v_listing_id, v_agg_qty in
    select oi.listing_id, sum(oi.quantity)::integer
      from public.order_items oi
      where oi.id = any(v_accepted_ids) and oi.listing_id is not null
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
      select array_agg(oi.id) into v_conflict_batch
        from public.order_items oi
        where oi.id = any(v_accepted_ids) and oi.listing_id = v_listing_id;
      v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
      continue;
    end if;

    v_ok_listing_ids := v_ok_listing_ids || v_listing_id;
    v_ok_listing_qty := v_ok_listing_qty || v_agg_qty;
    v_ok_listing_new_reserved := v_ok_listing_new_reserved || (v_reserved_qty + v_agg_qty);
    v_ok_listing_new_available := v_ok_listing_new_available || (v_avail_qty - v_agg_qty);
    v_ok_listing_status := v_ok_listing_status || v_listing_status;
  end loop;

  -- ===================== final item classification =====================
  select coalesce(array_agg(oi.id), '{}') into v_final_accepted_ids
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and not (oi.id = any(v_stock_conflict_ids));

  select coalesce(array_agg(x), '{}') into v_final_declined_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_final_accepted_ids));

  v_accepted_count := coalesce(array_length(v_final_accepted_ids, 1), 0);

  if v_accepted_count = v_total_count then
    v_outcome_status := 'accepted';
  elsif v_accepted_count = 0 then
    v_outcome_status := 'declined';
  else
    v_outcome_status := 'changes_pending';
  end if;

  v_note := case
    when coalesce(array_length(v_stock_conflict_ids, 1), 0) > 0
      then format('%s item(s) auto-declined due to insufficient stock or an unavailable listing.', array_length(v_stock_conflict_ids, 1))
    else null
  end;

  -- ===================== item status writes (all outcomes) =====================
  update public.order_items set status = 'accepted' where id = any(v_final_accepted_ids);
  update public.order_items set status = 'declined' where id = any(v_final_declined_ids);

  -- ===================== outcome-specific mutation =====================
  if v_outcome_status = 'accepted' then
    -- reservations first (the ledger is authoritative), then the cached aggregate
    insert into public.inventory_reservations (listing_id, order_id, order_item_id, shop_id, quantity)
      select oi.listing_id, p_order_id, oi.id, v_order_shop_id, oi.quantity
        from public.order_items oi
        where oi.id = any(v_final_accepted_ids);

    for i in 1 .. coalesce(array_length(v_ok_listing_ids, 1), 0) loop
      update public.listings
        set reserved_quantity = v_ok_listing_new_reserved[i],
            status = case
              when v_ok_listing_new_available[i] = 0 and v_ok_listing_status[i] in ('available', 'reserved')
                then 'reserved'::public.listing_status_enum
              else status
            end
        where id = v_ok_listing_ids[i];
    end loop;
  end if;

  -- (no listing/reservation mutation for 'declined' or 'changes_pending' outcomes)

  update public.orders set status = v_outcome_status where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'pending', v_outcome_status, v_caller, v_note);

  return query
    select p_order_id, v_outcome_status, false, v_final_accepted_ids, v_final_declined_ids, v_stock_conflict_ids;
end;
$$;

revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from public;
revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from anon;
grant execute on function public.accept_order_items(uuid, uuid[], uuid[]) to authenticated;
