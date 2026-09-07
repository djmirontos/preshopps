-- Buyer Orders read layer: two SECURITY DEFINER RPCs, get_my_orders and
-- get_my_order_detail. No schema/table/RLS/enum changes -- everything
-- these functions need already exists.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0041_get_my_cart_projection_fix; this is the
-- next migration, no drift. Confirmed live (via direct introspection of
-- the configured project, not just the migration files): public.orders and
-- public.order_items both have row-level security ENABLED with ZERO
-- policies -- identical posture to carts/cart_items/favorites before
-- 0037. No RLS policy or RPC anywhere currently lets a client read order
-- data through PostgREST; a full-text search of every migration for
-- "get_my_order"/"get_order"/any order-list or order-detail read RPC
-- found none -- only write/lifecycle RPCs exist (submit_cart_order,
-- accept_order_items, mark_order_ready, mark_order_handed_over_or_shipped,
-- confirm_order_received, complete_order, cancel_pending_order,
-- cancel_order_changes, confirm_order_changes, cancel_accepted_order,
-- request_order_cancellation, resolve_order_cancellation,
-- expire_pending_orders). This confirms the exact gap the Buyer Orders
-- module needs filled: a safe buyer-facing read path for order list,
-- order detail, and order items did not exist before this migration.
--
-- orders (0012_orders.sql, unchanged) columns confirmed: id, public_code,
-- buyer_id, shop_id, status order_status_enum, fulfillment_method
-- fulfillment_method_enum, buyer_note, seller_note, per-state timestamps,
-- created_at, updated_at. order_items (0012, unchanged) columns confirmed:
-- id, order_id, shop_id, listing_id (nullable), status
-- order_item_status_enum, quantity, listing_title_snapshot,
-- listing_public_code_snapshot, price_cents_snapshot, shop_name_snapshot,
-- listing_cover_image_snapshot_path, created_at. order_status_enum
-- (0002_enums.sql) confirmed exactly: pending, accepted, ready,
-- handed_over_or_shipped, received_confirmed, completed, declined,
-- cancelled, expired, disputed -- ten values, no more, no fewer; the
-- frontend must never invent an eleventh. shops (0007_shops.sql) columns
-- confirmed: id, owner_id, name, slug, ..., status shop_status_enum.
--
-- Every order returned by these functions is scoped to o.buyer_id =
-- auth.uid() by construction (never a caller-supplied buyer id anywhere
-- in either function) -- a public_code belonging to a different buyer, or
-- a nonexistent one, simply matches zero rows in get_my_order_detail,
-- which is indistinguishable from "not found" at the SQL level and is
-- mapped identically by the frontend to Next's notFound(), exactly
-- mirroring get_listing_detail's (0036) established privacy pattern for
-- "another buyer's order must behave like inaccessible."
--
-- Suspension/hiding is deliberately NOT applied here (locked decision,
-- diverging from get_my_cart's is_hidden gate on purpose)
-- -----------------------------------------------------------------------
-- get_my_cart nulls out listing/shop fields for a paused/draft listing or
-- a suspended shop, because a cart row is a forward-looking "can I still
-- buy this" question. An order is the opposite: it is the buyer's own
-- completed, historical, contractual record. AGENTS.md's Suspension
-- section is explicit that a seller suspension must "preserve orders" --
-- a buyer's own order history must remain fully visible to that buyer
-- regardless of what later happens to the shop or the source listing.
-- Accordingly, neither function ever nulls a field based on shop status,
-- listing status, or listing existence. This is also why every buyer-
-- facing display field is sourced from order_items' own immutable
-- snapshot columns (listing_title_snapshot, listing_public_code_snapshot,
-- price_cents_snapshot, shop_name_snapshot, listing_cover_image_snapshot_
-- path) rather than the live listings/shops row wherever a snapshot
-- equivalent exists -- per AGENTS.md's Order Rules ("Later listing edits
-- must never rewrite historical order data") and this task's own
-- instruction 9 ("historical order snapshots remain readable even if the
-- listing later changes"). shops is joined only for `slug`, which has no
-- snapshot column and is needed purely to link to the shop's current
-- page -- not for shop_name, which always comes from shop_name_snapshot.
-- Because one order belongs to exactly one shop (orders.shop_id, enforced
-- structurally since 0012 via orders_id_shop_id_key + order_items'
-- composite FKs), every order_items row for a given order carries an
-- identical shop_name_snapshot value by construction (all inserted in the
-- same submit_cart_order transaction from the same source value) --
-- get_my_orders' per-order aggregate uses min() over that column as a
-- safe, deterministic way to collapse the guaranteed-identical value to
-- one scalar, not as a real aggregation.
--
-- No order can have zero order_items -- submit_cart_order (0039/0040)
-- always inserts at least one order_items row in the same transaction
-- that creates the order, and no approved code path ever deletes an
-- order_item afterward (order_items_order_id_shop_id_fkey is ON DELETE
-- RESTRICT). Both functions below therefore use a plain (inner) join to
-- order_items, never a left join.
--
-- Cursor pagination (get_my_orders only; get_my_order_detail returns a
-- single order's items and needs none): identical keyset shape/validation
-- to get_my_favorites (0037) -- (created_at, id) DESC, p_limit clamped to
-- [1, 50], p_before_created_at/p_before_id must be supplied together.
--
-- Soft-deleted/missing caller profile: same defensive pattern as
-- get_my_cart/get_my_favorites -- returns zero rows rather than raising,
-- so a caller in this rare state sees an empty list, not an error.
--
-- Security: SECURITY DEFINER, SET search_path = '', every table reference
-- fully schema-qualified, every column alias-qualified (o., oi., s.,
-- agg.), no ON CONFLICT anywhere (0037/0039 ambiguity class does not
-- apply). REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only
-- -- orders are a sign-in-only surface, matching cart/favorites. No new
-- table, index, enum, trigger, or RLS policy. No existing function is
-- touched.
--
-- Scope: exactly two new functions (get_my_orders, get_my_order_detail)
-- plus their privilege statements. No buyer-action RPCs (cancel, confirm
-- receipt, dispute) are added here -- those already exist
-- (cancel_pending_order, request_order_cancellation,
-- confirm_order_received, cancel_order_changes, confirm_order_changes)
-- and are intentionally left unwired by the frontend in this module, per
-- instruction, since Buyer Orders is scoped to a read-only view for now.

-- ============================================================
-- get_my_orders
-- ============================================================
create or replace function public.get_my_orders(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  order_id uuid,
  order_public_code text,
  shop_id uuid,
  shop_slug text,
  shop_name text,
  status public.order_status_enum,
  fulfillment_method public.fulfillment_method_enum,
  created_at timestamptz,
  item_count integer,
  total_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    return;
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    select
      o.id as order_id,
      o.public_code as order_public_code,
      s.id as shop_id,
      s.slug as shop_slug,
      agg.shop_name_snapshot as shop_name,
      o.status,
      o.fulfillment_method,
      o.created_at,
      agg.item_count,
      agg.total_cents
    from public.orders o
    join public.shops s on s.id = o.shop_id
    join lateral (
      select
        count(*)::integer as item_count,
        sum(oi.quantity * oi.price_cents_snapshot)::bigint as total_cents,
        min(oi.shop_name_snapshot) as shop_name_snapshot
      from public.order_items oi
      where oi.order_id = o.id
    ) agg on true
    where o.buyer_id = v_caller_id
      and (
        p_before_created_at is null
        or (o.created_at, o.id) < (p_before_created_at, p_before_id)
      )
    order by o.created_at desc, o.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_orders(integer, timestamptz, uuid) from public;
revoke all on function public.get_my_orders(integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_orders(integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_my_order_detail
-- ============================================================
-- One row per order_item, order-level fields denormalized/repeated on
-- every row -- the same shape convention get_my_cart already established
-- for shop_name/shop_slug being repeated per cart row. A public_code the
-- caller does not own (or that does not exist at all) matches zero rows;
-- the frontend maps that to notFound(), never distinguishing the two
-- cases, exactly like get_listing_detail's LISTING_NOT_FOUND.
create or replace function public.get_my_order_detail(
  p_public_code text
)
returns table (
  order_id uuid,
  order_public_code text,
  shop_id uuid,
  shop_slug text,
  shop_name text,
  status public.order_status_enum,
  fulfillment_method public.fulfillment_method_enum,
  buyer_note text,
  created_at timestamptz,
  order_item_id uuid,
  listing_id uuid,
  listing_public_code_snapshot text,
  listing_title_snapshot text,
  listing_cover_image_snapshot_path text,
  item_quantity integer,
  item_price_cents_snapshot bigint,
  item_status public.order_item_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    return;
  end if;

  return query
    select
      o.id as order_id,
      o.public_code as order_public_code,
      s.id as shop_id,
      s.slug as shop_slug,
      oi.shop_name_snapshot as shop_name,
      o.status,
      o.fulfillment_method,
      o.buyer_note,
      o.created_at,
      oi.id as order_item_id,
      oi.listing_id,
      oi.listing_public_code_snapshot,
      oi.listing_title_snapshot,
      oi.listing_cover_image_snapshot_path,
      oi.quantity as item_quantity,
      oi.price_cents_snapshot as item_price_cents_snapshot,
      oi.status as item_status
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.shops s on s.id = o.shop_id
    where o.buyer_id = v_caller_id
      and o.public_code = p_public_code
    order by oi.created_at asc, oi.id asc;
end;
$$;

revoke all on function public.get_my_order_detail(text) from public;
revoke all on function public.get_my_order_detail(text) from anon;
grant execute on function public.get_my_order_detail(text) to authenticated;
