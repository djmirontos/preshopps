-- Seller Order Management read layer: two SECURITY DEFINER RPCs,
-- get_my_shop_orders and get_my_shop_order_detail. No schema/table/RLS/
-- enum changes -- everything these functions need already exists.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0042_buyer_orders_read_rpcs; this is the next
-- migration, no drift. A full-text search of every migration for a
-- seller-facing order-list/order-detail read RPC found none -- only
-- write/lifecycle RPCs exist for the seller side: accept_order_items
-- (0016/0018/0040), mark_order_ready (0025/0040),
-- mark_order_handed_over_or_shipped (0026/0040), cancel_accepted_order
-- (0023/0040), resolve_order_cancellation (0021/0022/0040). This confirms
-- the exact gap this module needs filled.
--
-- orders/order_items/order_cancellation_requests schemas confirmed
-- unchanged (0012/0013). order_status_enum confirmed LIVE (not just from
-- migration files -- queried directly) to have eleven values: pending,
-- changes_pending, accepted, ready, handed_over_or_shipped,
-- received_confirmed, completed, declined, cancelled, expired, disputed
-- (changes_pending was added by 0015 after the enum's original definition
-- in 0002 -- this migration's frontend counterpart must account for all
-- eleven, not the ten from 0002 alone). order_item_status_enum confirmed
-- exactly {pending, accepted, declined}. cancellation_request_status_enum
-- confirmed exactly {pending, confirmed, rejected}.
-- order_cancellation_requests_one_pending_per_order (0013) is a partial
-- unique index on (order_id) where status = 'pending' -- at most one
-- pending cancellation request can exist per order, so a scalar (not
-- array) subquery for "the" pending request is always safe.
-- profiles.display_name (0004) is NOT NULL -- the one safe, already-
-- existing buyer-facing display field; profiles carries no other
-- public-safe identity column, and auth.users (email) is never touched by
-- any function in this schema and is not touched here either.
--
-- No safe seller-facing shop-ownership check needed a new RPC: shops_
-- select_owner (0031_messaging_rls_and_rpcs.sql: SELECT, `to
-- authenticated`, `using (auth.uid() = owner_id)`) already lets an
-- authenticated caller read their own shop row directly via PostgREST --
-- this is reused client-side (lib/seller/get-my-shop.ts) to distinguish
-- "no shop yet" from "shop exists, zero orders" before either RPC below
-- is ever called; no shop-lookup RPC is added by this migration.
--
-- Both functions derive the caller's shop from shops.owner_id = auth.uid()
-- internally -- neither ever accepts a shop_id parameter from the client,
-- so shop ownership can never be spoofed. A public_code belonging to a
-- different shop (or a nonexistent one) resolves to zero rows from
-- get_my_shop_order_detail, identical to "not found" -- the frontend maps
-- both to the same not-found treatment, exactly mirroring get_my_order_
-- detail's (0042) buyer-side privacy pattern.
--
-- Buyer-facing fields returned are limited to profiles.display_name --
-- never email, never any auth.* identifier, never the raw buyer_id (there
-- is no legitimate use for it in this module's UI, so it is not returned
-- at all, not merely hidden). Order line items always use order_items'
-- own immutable snapshot columns (listing_title_snapshot, listing_public_
-- code_snapshot, price_cents_snapshot, listing_cover_image_snapshot_path)
-- so historical order data remains readable even if the source listing is
-- later edited, paused, or archived -- the same reasoning as 0042's buyer-
-- side functions, and per AGENTS.md's "Later listing edits must never
-- rewrite historical order data."
--
-- get_my_shop_order_detail additionally surfaces the order's current
-- pending cancellation request (id + reason), if one exists, as
-- denormalized order-level columns -- this is the minimum the seller-
-- resolution UI needs (resolve_order_cancellation takes p_request_id, not
-- an order id) without a second round trip or a join the frontend would
-- otherwise have to construct itself from a raw table it has no read
-- access to (order_cancellation_requests carries RLS enabled with zero
-- policies, confirmed live, same posture as orders/order_items).
--
-- Cursor pagination (get_my_shop_orders only): identical keyset shape/
-- validation to get_my_orders (0042) -- (created_at, id) DESC, p_limit
-- clamped to [1, 50], p_before_created_at/p_before_id must be supplied
-- together.
--
-- Security: SECURITY DEFINER, SET search_path = '', every table reference
-- fully schema-qualified, every column alias-qualified (o., oi., p., agg.,
-- ocr.). REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only.
-- No new table, index, enum, trigger, or RLS policy. No existing function
-- is touched -- accept_order_items, mark_order_ready, mark_order_handed_
-- over_or_shipped, cancel_accepted_order, resolve_order_cancellation, and
-- every other lifecycle RPC remain byte-for-byte as they are; this
-- migration adds two read-only functions only.

-- ============================================================
-- get_my_shop_orders
-- ============================================================
create or replace function public.get_my_shop_orders(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  order_id uuid,
  order_public_code text,
  buyer_display_name text,
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
  v_shop_id uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller_id;

  if not found then
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
      p.display_name as buyer_display_name,
      o.status,
      o.fulfillment_method,
      o.created_at,
      agg.item_count,
      agg.total_cents
    from public.orders o
    join public.profiles p on p.id = o.buyer_id
    join lateral (
      select
        count(*)::integer as item_count,
        sum(oi.quantity * oi.price_cents_snapshot)::bigint as total_cents
      from public.order_items oi
      where oi.order_id = o.id
    ) agg on true
    where o.shop_id = v_shop_id
      and (
        p_before_created_at is null
        or (o.created_at, o.id) < (p_before_created_at, p_before_id)
      )
    order by o.created_at desc, o.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_shop_orders(integer, timestamptz, uuid) from public;
revoke all on function public.get_my_shop_orders(integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_shop_orders(integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_my_shop_order_detail
-- ============================================================
-- One row per order_item, order-level fields denormalized/repeated on
-- every row -- the same shape convention get_my_cart/get_my_order_detail
-- already established. A public_code belonging to a different shop (or a
-- nonexistent one) matches zero rows; the frontend maps that to
-- notFound(), never distinguishing the two cases.
create or replace function public.get_my_shop_order_detail(
  p_public_code text
)
returns table (
  order_id uuid,
  order_public_code text,
  buyer_display_name text,
  status public.order_status_enum,
  fulfillment_method public.fulfillment_method_enum,
  buyer_note text,
  created_at timestamptz,
  pending_cancellation_request_id uuid,
  pending_cancellation_reason text,
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
  v_shop_id uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller_id;

  if not found then
    return;
  end if;

  return query
    select
      o.id as order_id,
      o.public_code as order_public_code,
      p.display_name as buyer_display_name,
      o.status,
      o.fulfillment_method,
      o.buyer_note,
      o.created_at,
      ocr.id as pending_cancellation_request_id,
      ocr.reason as pending_cancellation_reason,
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
    join public.profiles p on p.id = o.buyer_id
    left join public.order_cancellation_requests ocr
      on ocr.order_id = o.id and ocr.status = 'pending'
    where o.shop_id = v_shop_id
      and o.public_code = p_public_code
    order by oi.created_at asc, oi.id asc;
end;
$$;

revoke all on function public.get_my_shop_order_detail(text) from public;
revoke all on function public.get_my_shop_order_detail(text) from anon;
grant execute on function public.get_my_shop_order_detail(text) to authenticated;
