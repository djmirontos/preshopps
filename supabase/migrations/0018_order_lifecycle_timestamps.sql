-- Corrective migration: populates the two existing lifecycle-timestamp
-- gaps in the already-implemented seller-acceptance and buyer-
-- confirmation RPCs. CREATE OR REPLACE FUNCTION only, for the two
-- functions named below. No tables, enums, triggers, indexes, RLS
-- policies, storage, cron, or data mutation/backfill of any kind.
--
-- Background
-- -----------------------------------------------------------------------
-- orders.accepted_at, orders.declined_at (and the other per-state
-- lifecycle timestamp columns) were added in 0012 as deliberately plain
-- nullable columns with no default and no auto-population trigger,
-- explicitly deferring population to "trusted state-transition business
-- logic that does not exist yet" (0012's own header comment). That logic
-- now exists (0016 accept_order_items, 0017 confirm_order_changes), but
-- neither function's original task specification asked for lifecycle-
-- timestamp population, so neither set accepted_at or declined_at when
-- transitioning an order into those states — an omission flagged
-- explicitly in each migration's own review rather than silently decided
-- either way at the time. This migration closes that gap for the three
-- currently-implemented first-entry transitions:
--   accept_order_items:    pending -> accepted          (accepted_at)
--   accept_order_items:    pending -> declined           (declined_at)
--   confirm_order_changes: changes_pending -> accepted   (accepted_at)
--
-- Approved invariant (reviewed and approved in a prior design/analysis
-- task): whenever a trusted RPC's UPDATE first transitions an order INTO
-- a lifecycle state that has a matching timestamp column, that SAME
-- UPDATE populates the matching timestamp with now(). The timestamp
-- records when the order first entered that state; once set, it is never
-- overwritten on an idempotent retry and never cleared by a later
-- transition to a different state. This migration applies that invariant
-- to the two already-implemented functions and their three affected
-- outcomes ONLY. accept_order_items' third outcome (pending ->
-- changes_pending) has no matching timestamp column in the current schema
-- and is correspondingly left untouched. Every other lifecycle timestamp
-- (ready_at, handed_over_or_shipped_at, received_confirmed_at,
-- completed_at, cancelled_at, expired_at, disputed_at) belongs to a
-- transition no RPC in this schema implements yet, so none of them are
-- touched here; future RPCs implementing those transitions are expected
-- to follow the same convention when they are built.
--
-- Pre-inspection (re-confirmed live immediately before writing this
-- migration, per instruction)
-- -----------------------------------------------------------------------
-- - Migration history ends at 0017_buyer_confirm_changes (no newer
--   migration exists to conflict with this one).
-- - Both public.accept_order_items(uuid, uuid[], uuid[]) and
--   public.confirm_order_changes(uuid) exist live with exactly the
--   signatures and return types declared below (verified via pg_proc /
--   pg_get_function_identity_arguments / pg_get_function_result) --
--   REPLACE, not CREATE, and no signature or return-type change.
-- - orders.accepted_at and orders.declined_at both exist, both
--   `timestamp with time zone`, both nullable, both with no default
--   (verified via information_schema.columns).
-- - No constraint on public.orders references accepted_at or declined_at
--   in its definition (verified via pg_constraint / pg_get_constraintdef
--   -- zero matching rows).
-- - public.orders currently contains zero rows at all (verified via a
--   live COUNT(*) with per-status/per-timestamp FILTER breakdowns --
--   every count, including accepted/declined with and without their
--   timestamp, is 0). No backfill is needed or performed by this
--   migration.
-- - No function in the public schema currently references accepted_at or
--   declined_at anywhere in its source (verified via a live search of
--   pg_proc.prosrc across the public schema -- zero matching rows), so
--   this migration is not duplicating or conflicting with any existing
--   write path.
--
-- now() / order_status_history semantics
-- -----------------------------------------------------------------------
-- PostgreSQL's now() is transaction-stable (constant for the whole
-- transaction, not re-evaluated per statement). Both affected functions
-- write their orders UPDATE and their single order_status_history INSERT
-- within the same transaction as the RPC call, so accepted_at/declined_at
-- and that history row's created_at will naturally normally carry the
-- identical transaction timestamp. This is a useful, expected consequence
-- of Postgres semantics -- it is NOT enforced by any constraint added
-- here, and no future application logic should assert exact equality
-- between them as a business rule; the actual requirement is that all of
-- an RPC's writes are transactionally consistent (commit or roll back
-- together), which both functions already guaranteed before this
-- migration and continue to guarantee unchanged after it.
--
-- Scope of change
-- -----------------------------------------------------------------------
-- Every other line of both function bodies -- authentication,
-- authorization, locking, input validation, aggregation, stock-conflict
-- handling, item-status writes, reservation creation, reserved_quantity/
-- listing-status mutation, order_status_history writes, idempotency
-- branches, return shapes, and error codes -- is reproduced byte-for-byte
-- from the live 0016/0017 definitions. The only textual differences are:
--   accept_order_items:    the final `update public.orders` statement
--                           gains conditional accepted_at/declined_at
--                           assignments (see inline comment below).
--   confirm_order_changes: the final `update public.orders` statement
--                           gains an unconditional accepted_at = now()
--                           assignment (see inline comment below).
-- CREATE OR REPLACE FUNCTION requires the full body to be restated (a
-- partial patch is not possible in PostgreSQL), which is why both
-- complete bodies appear below rather than a diff-shaped statement.

-- =============================================================================
-- public.accept_order_items
-- =============================================================================
--
-- Change: the single outcome-mutation UPDATE that previously wrote only
-- `status = v_outcome_status` now also writes accepted_at when the
-- resolved outcome is 'accepted', and declined_at when the resolved
-- outcome is 'declined' -- using a CASE per column so the statement stays
-- a single UPDATE for all three possible outcomes:
--   - 'accepted'         -> accepted_at = now(), declined_at unchanged
--   - 'declined'         -> declined_at = now(), accepted_at unchanged
--   - 'changes_pending'  -> neither column touched (both CASE branches
--                           fall through to the column's own current
--                           value, a no-op)
-- The idempotent early-return path (order status already not 'pending')
-- returns before this UPDATE is ever reached, so a retried call never
-- re-executes it and never disturbs an already-set timestamp.

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

  -- lifecycle timestamps: accepted_at is set only when this call's resolved
  -- outcome is 'accepted', declined_at only when it is 'declined'; the
  -- 'changes_pending' outcome touches neither (both CASE branches
  -- preserve the column's current value, a no-op for a pending-origin
  -- order where both are already NULL).
  update public.orders
    set status = v_outcome_status,
        accepted_at = case when v_outcome_status = 'accepted' then now() else accepted_at end,
        declined_at = case when v_outcome_status = 'declined' then now() else declined_at end
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'pending', v_outcome_status, v_caller, v_note);

  return query
    select p_order_id, v_outcome_status, false, v_final_accepted_ids, v_final_declined_ids, v_stock_conflict_ids;
end;
$$;

revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from public;
revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from anon;
grant execute on function public.accept_order_items(uuid, uuid[], uuid[]) to authenticated;

-- =============================================================================
-- public.confirm_order_changes
-- =============================================================================
--
-- Change: the single success-path UPDATE that previously wrote only
-- `status = 'accepted'` now also writes `accepted_at = now()`,
-- unconditionally -- this function has exactly one mutating outcome
-- (fresh success transitioning changes_pending -> accepted), so no CASE
-- is needed. declined_at is never touched by this function: it never
-- transitions an order into 'declined' and never rewrites order_items
-- status, so there is nothing for it to record here. The idempotent
-- early-return path (order already 'accepted') and the
-- ORDER_NOT_CONFIRMABLE error path both return/raise before this UPDATE
-- is reached, so neither disturbs an already-set accepted_at.

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
  -- lifecycle timestamp: this function's only mutating outcome is a fresh
  -- changes_pending -> accepted transition, so accepted_at = now() is
  -- written unconditionally alongside status. declined_at is never
  -- touched by this function.
  update public.orders set status = 'accepted', accepted_at = now() where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'changes_pending', 'accepted', v_caller, null);

  return query
    select p_order_id, 'accepted'::public.order_status_enum, false, v_accepted_ids, v_declined_ids;
end;
$$;

revoke all on function public.confirm_order_changes(uuid) from public;
revoke all on function public.confirm_order_changes(uuid) from anon;
grant execute on function public.confirm_order_changes(uuid) to authenticated;
