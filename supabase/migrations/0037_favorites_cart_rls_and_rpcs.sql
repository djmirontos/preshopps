-- Favorites + Cart persistence: one favorites read policy plus seven
-- SECURITY DEFINER RPCs. No tables, indexes, enums, or triggers -- the
-- favorites/carts/cart_items schema already exists unchanged from earlier
-- migrations and is reused as-is.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0036_public_marketplace_read_rpcs; this is the
-- next migration, no drift.
--
-- favorites: (id uuid pk, user_id uuid not null, listing_id uuid not null,
-- created_at timestamptz not null default now()). UNIQUE(user_id,
-- listing_id). FK user_id -> profiles(id) ON DELETE CASCADE, FK listing_id
-- -> listings(id) ON DELETE CASCADE. RLS enabled, zero policies (confirmed
-- live). Indexes confirmed live: favorites_pkey, favorites_user_id_listing_id_key
-- (unique), favorites_user_created_idx (user_id, created_at desc).
--
-- carts: (id uuid pk, user_id uuid not null, created_at, updated_at). UNIQUE
-- (user_id). FK user_id -> profiles(id) ON DELETE CASCADE. RLS enabled,
-- zero policies. Index carts_user_id_key (unique) confirmed live.
--
-- cart_items: (id uuid pk, cart_id uuid not null, listing_id uuid not null,
-- quantity integer not null CHECK >= 1, price_cents_snapshot bigint not null
-- CHECK >= 0, added_at timestamptz not null default now()). UNIQUE(cart_id,
-- listing_id). FK cart_id -> carts(id) ON DELETE CASCADE, FK listing_id ->
-- listings(id) ON DELETE RESTRICT. RLS enabled, zero policies. Index
-- cart_items_cart_id_listing_id_key (unique) confirmed live.
-- price_cents_snapshot is NOT NULL (confirmed) -- every insert/update this
-- migration performs on cart_items always supplies the current listing price.
--
-- listings.available_quantity confirmed GENERATED ALWAYS AS
-- (stock_quantity - reserved_quantity), integer -- never written directly,
-- only read.
-- categories.is_inquiry_only confirmed boolean not null.
-- shops.owner_id confirmed uuid not null.
-- profiles.deleted_at confirmed timestamptz, nullable (null = active).
-- user_blocks confirmed (blocker_id uuid not null, blocked_id uuid not null,
-- created_at not null), pk (blocker_id, blocked_id).
-- user_restrictions confirmed (id, user_id, restriction_type, reason,
-- issued_by, lifted_at nullable, lifted_by nullable, created_at).
-- restriction_type_enum confirmed {seller_suspended, buyer_restricted,
-- account_suspended}. listing_status_enum confirmed {draft, available,
-- reserved, paused, sold, archived}.
--
-- Confirmed no function named add_favorite, remove_favorite,
-- get_my_favorites, set_cart_item_quantity, remove_cart_item, get_my_cart,
-- or merge_guest_cart exists anywhere in the public schema -- clean
-- namespace, no collision, no prior partial implementation to reconcile.
--
-- No assumption differed from the locked design brief; no STOP condition
-- triggered.
--
-- Security model (all seven functions identically)
-- -----------------------------------------------------------------------
-- SECURITY DEFINER, SET search_path = '', every object reference fully
-- schema-qualified (public.favorites, public.carts, public.cart_items,
-- public.listings, public.shops, public.categories, public.profiles,
-- public.user_blocks, public.user_restrictions). REVOKE ALL FROM PUBLIC and
-- FROM anon, then GRANT EXECUTE TO authenticated only -- favorites and cart
-- are sign-in-only surfaces per PRD S18/S20, so anon never receives access
-- to any of the seven. service_role/postgres owner-default EXECUTE is left
-- untouched (not explicitly revoked/granted), matching the established
-- 0034/0036 pattern.
--
-- Ambiguity-bug re-audit (0021/0022 precedent): every table column read
-- across all seven functions is alias-qualified (f., c., ci., l., s.,
-- cat., img., ur., ub., p., flags., calc.), including every column whose
-- name collides with a RETURNS TABLE output-column name of its own function
-- (listing_id, favorite_id, created_at, cart_id, quantity, price_cents,
-- status, shop_id, added_at, result, final_quantity). merge_guest_cart's
-- per-row output is built exclusively through RETURN QUERY SELECT against
-- local PL/pgSQL variables (v_item.listing_id, v_result, v_final_quantity)
-- rather than bare-name OUT-parameter assignment, so no output-column name
-- is ever read as a bare identifier anywhere in this migration. No dynamic
-- SQL anywhere.
--
-- Favorites eligibility (add_favorite only; remove_favorite performs no
-- eligibility checks at all, matching the locked "removal is always allowed
-- while account is active" rule)
-- -----------------------------------------------------------------------
-- A listing is favoritable when status = 'available' and its shop's current
-- owner carries no active (lifted_at IS NULL) seller_suspended or
-- account_suspended restriction -- the identical NOT EXISTS gate used
-- throughout 0034/0036. Inquiry-only listings ARE favoritable (no category
-- check). Peer blocking is never checked (favorite is private bookmarking,
-- not interaction, per the locked design). Own-shop listings ARE favoritable
-- (same reasoning). add_favorite is idempotent and race-safe via
-- INSERT ... ON CONFLICT (user_id, listing_id) DO NOTHING followed by an
-- unconditional re-SELECT of the row, so a concurrent duplicate call never
-- surfaces a unique_violation to the caller.
--
-- Cart eligibility (set_cart_item_quantity and merge_guest_cart share the
-- identical per-listing eligibility test, applied unconditionally on every
-- call regardless of whether a cart_items row already exists for that
-- listing -- this is what guarantees a stale existing row is never silently
-- modified by a call that would fail eligibility on a fresh add)
-- -----------------------------------------------------------------------
-- listing.status = 'available' AND category.is_inquiry_only = false AND
-- shop owner carries no active seller_suspended/account_suspended
-- restriction. Failing this (including a nonexistent listing_id) raises/
-- skips as LISTING_NOT_CARTABLE. Separately: caller = shop.owner_id raises/
-- skips as CANNOT_BUY_OWN_LISTING. Separately: an active user_blocks row in
-- either direction between caller and shop owner raises/skips under
-- INTERACTION_BLOCKED (set_cart_item_quantity) or folds into
-- skipped_not_cartable (merge_guest_cart, per the locked three-value result
-- enum). Quantity is checked last: p_quantity/desired_quantity must be
-- <= listings.available_quantity (the generated stock - reserved column),
-- never reserving anything -- cart_items is written but inventory_reservations
-- is never touched by this migration.
--
-- Price snapshot: price_cents_snapshot is refreshed to the CURRENT
-- listings.price_cents on every successful insert/update (add, quantity
-- change, or merge) -- it is never treated as an authoritative transaction
-- price; get_my_cart separately exposes both the live price and this
-- snapshot so the caller can detect drift via price_changed.
--
-- Scope: exactly one policy (favorites_select_own) and exactly seven
-- functions (add_favorite, remove_favorite, get_my_favorites,
-- set_cart_item_quantity, remove_cart_item, get_my_cart, merge_guest_cart)
-- plus their privilege statements. No tables, columns, indexes, enums,
-- triggers are created or altered. listing_metrics is never written by any
-- of the seven (favorite/cart counters remain deferred, per the locked
-- decision). orders, order_items, and inventory_reservations are never
-- touched -- no order-creation RPC exists yet in this schema, and this
-- migration does not attempt to anticipate its shape.

-- ============================================================
-- favorites RLS
-- ============================================================
-- Read-only ownership policy. No INSERT/UPDATE/DELETE policy is added --
-- favorite creation eligibility depends on cross-table business rules
-- (listing status, shop suspension) that do not compress cleanly into a
-- single RLS USING/WITH CHECK expression the way the trivial-ownership
-- user_blocks policies do, so mutation goes through add_favorite/
-- remove_favorite instead. This SELECT policy exists only for lightweight
-- "is this listing already favorited by me" existence checks that don't
-- need the full get_my_favorites card projection.
create policy favorites_select_own
  on public.favorites
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- add_favorite
-- ============================================================
create or replace function public.add_favorite(
  p_listing_id uuid
)
returns table (
  favorite_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
  v_listing_ok boolean;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  select true into v_listing_ok
    from public.listings l
    join public.shops s on s.id = l.shop_id
    where l.id = p_listing_id
      and l.status = 'available'
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      );

  if v_listing_ok is null then
    raise exception 'Listing cannot be favorited.' using detail = 'LISTING_NOT_FAVORITABLE';
  end if;

  insert into public.favorites (user_id, listing_id)
  values (v_caller_id, p_listing_id)
  on conflict (user_id, listing_id) do nothing;

  return query
    select f.id as favorite_id, f.created_at
    from public.favorites f
    where f.user_id = v_caller_id and f.listing_id = p_listing_id;
end;
$$;

revoke all on function public.add_favorite(uuid) from public;
revoke all on function public.add_favorite(uuid) from anon;
grant execute on function public.add_favorite(uuid) to authenticated;

-- ============================================================
-- remove_favorite
-- ============================================================
-- No status/block/suspension checks -- a buyer must always be able to
-- remove their own bookmark while their account is active. Idempotent: an
-- absent favorite is still a successful no-op delete.
create or replace function public.remove_favorite(
  p_listing_id uuid
)
returns void
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
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  delete from public.favorites f
    where f.user_id = v_caller_id and f.listing_id = p_listing_id;
end;
$$;

revoke all on function public.remove_favorite(uuid) from public;
revoke all on function public.remove_favorite(uuid) from anon;
grant execute on function public.remove_favorite(uuid) to authenticated;

-- ============================================================
-- get_my_favorites
-- ============================================================
-- Missing/soft-deleted caller profile returns zero rows rather than an
-- error, so the response never distinguishes "no favorites" from "account
-- state problem". available/reserved/sold/archived favorites (and a
-- non-suspended shop) return the full safe card projection -- the same
-- visibility boundary get_listing_detail (0036) already exposes publicly
-- through a direct URL. paused/draft listings and listings whose shop
-- carries an active seller_suspended/account_suspended restriction collapse
-- to a placeholder row: status = 'unavailable' with every public field NULL,
-- never revealing more than 0036's get_listing_detail would (which returns
-- LISTING_NOT_FOUND for these exact cases).
create or replace function public.get_my_favorites(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  favorite_id uuid,
  favorited_at timestamptz,
  listing_id uuid,
  status text,
  public_code text,
  slug text,
  title text,
  price_cents bigint,
  cover_image_storage_path text,
  province_name text,
  city_name text,
  shop_id uuid,
  shop_slug text,
  shop_name text
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
      f.id as favorite_id,
      f.created_at as favorited_at,
      f.listing_id,
      case when flags.is_visible then l.status::text else 'unavailable' end as status,
      case when flags.is_visible then l.public_code else null end as public_code,
      case when flags.is_visible then l.slug else null end as slug,
      case when flags.is_visible then l.title else null end as title,
      case when flags.is_visible then l.price_cents else null end as price_cents,
      case when flags.is_visible then img.storage_path else null end as cover_image_storage_path,
      case when flags.is_visible then prov.name else null end as province_name,
      case when flags.is_visible then city.name else null end as city_name,
      case when flags.is_visible then s.id else null end as shop_id,
      case when flags.is_visible then s.slug else null end as shop_slug,
      case when flags.is_visible then s.name else null end as shop_name
    from public.favorites f
    join public.listings l on l.id = f.listing_id
    join public.shops s on s.id = l.shop_id
    left join public.provinces prov on prov.id = l.province_id
    left join public.cities_municipalities city on city.id = l.city_id
    left join public.listing_images img on img.id = l.cover_image_id
    join lateral (
      select
        l.status in ('available', 'reserved', 'sold', 'archived')
        and not exists (
          select 1 from public.user_restrictions ur
          where ur.user_id = s.owner_id
            and ur.lifted_at is null
            and ur.restriction_type in ('seller_suspended', 'account_suspended')
        ) as is_visible
    ) flags on true
    where f.user_id = v_caller_id
      and (
        p_before_created_at is null
        or (f.created_at, f.id) < (p_before_created_at, p_before_id)
      )
    order by f.created_at desc, f.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_favorites(integer, timestamptz, uuid) from public;
revoke all on function public.get_my_favorites(integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_favorites(integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- set_cart_item_quantity
-- ============================================================
-- Single upsert RPC for both "add" and "quantity change" -- the database
-- operation is identical either way (INSERT ... ON CONFLICT (cart_id,
-- listing_id) DO UPDATE). The full eligibility gate (status/category/
-- suspension/own-shop/block) runs unconditionally before the upsert on
-- every call, whether or not a row already exists for this listing -- so a
-- call against an already-stale row (e.g. now reserved/sold/paused) fails
-- with LISTING_NOT_CARTABLE and never touches that row; the buyer can still
-- remove it via remove_cart_item. Quantity may be corrected DOWNWARD on an
-- existing row as long as the listing is still 'available' and the new
-- quantity fits current available_quantity, even if the row was previously
-- over-quantity due to a stock drop.
create or replace function public.set_cart_item_quantity(
  p_listing_id uuid,
  p_quantity integer
)
returns table (
  cart_item_id uuid,
  listing_id uuid,
  quantity integer,
  price_cents_snapshot bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
  v_shop_owner_id uuid;
  v_shop_eligible boolean;
  v_current_price bigint;
  v_available_quantity integer;
  v_cart_id uuid;
  v_blocked boolean;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'Account is currently restricted.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.' using detail = 'QUANTITY_INVALID';
  end if;

  select
    s.owner_id,
    (
      l.status = 'available'
      and cat.is_inquiry_only = false
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      )
    ),
    l.price_cents,
    l.available_quantity
  into v_shop_owner_id, v_shop_eligible, v_current_price, v_available_quantity
    from public.listings l
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    where l.id = p_listing_id;

  if not found or not v_shop_eligible then
    raise exception 'Listing cannot be added to cart.' using detail = 'LISTING_NOT_CARTABLE';
  end if;

  if v_shop_owner_id = v_caller_id then
    raise exception 'Cannot buy your own listing.' using detail = 'CANNOT_BUY_OWN_LISTING';
  end if;

  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_caller_id and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_caller_id)
  ) into v_blocked;

  if v_blocked then
    raise exception 'Interaction is blocked.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if p_quantity > v_available_quantity then
    raise exception 'Requested quantity exceeds available stock.' using detail = 'QUANTITY_UNAVAILABLE';
  end if;

  insert into public.carts (user_id)
  values (v_caller_id)
  on conflict (user_id) do nothing;

  select c.id into v_cart_id
    from public.carts c
    where c.user_id = v_caller_id;

  return query
    insert into public.cart_items as ci (cart_id, listing_id, quantity, price_cents_snapshot)
    values (v_cart_id, p_listing_id, p_quantity, v_current_price)
    on conflict (cart_id, listing_id) do update
      set quantity = excluded.quantity,
          price_cents_snapshot = excluded.price_cents_snapshot
    returning ci.id as cart_item_id, ci.listing_id, ci.quantity, ci.price_cents_snapshot;
end;
$$;

revoke all on function public.set_cart_item_quantity(uuid, integer) from public;
revoke all on function public.set_cart_item_quantity(uuid, integer) from anon;
grant execute on function public.set_cart_item_quantity(uuid, integer) to authenticated;

-- ============================================================
-- remove_cart_item
-- ============================================================
-- No status/block/restriction/stock checks -- removal is cleanup, not a new
-- transaction action, and must always succeed for an active caller so a
-- stuck/unavailable row can always be cleared. Idempotent: an absent row is
-- still a successful no-op delete. Only ever deletes from the caller's own
-- cart (joined through carts.user_id, never a caller-supplied cart_id).
create or replace function public.remove_cart_item(
  p_listing_id uuid
)
returns void
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
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  delete from public.cart_items ci
    using public.carts c
    where ci.cart_id = c.id
      and c.user_id = v_caller_id
      and ci.listing_id = p_listing_id;
end;
$$;

revoke all on function public.remove_cart_item(uuid) from public;
revoke all on function public.remove_cart_item(uuid) from anon;
grant execute on function public.remove_cart_item(uuid) to authenticated;

-- ============================================================
-- get_my_cart
-- ============================================================
-- Missing/soft-deleted caller profile returns zero rows. For each cart row,
-- eligibility is recomputed live (never trusted from any stored value):
-- rows whose listing is paused/draft, or whose shop carries an active
-- seller_suspended/account_suspended restriction, collapse to a hidden
-- placeholder (status = 'unavailable', every public field NULL including
-- price_cents/price_changed, unavailable_reason = 'no_longer_available') --
-- the row itself, quantity, snapshot price, and added_at remain visible so
-- the buyer can still see and remove it. reserved/sold/archived rows keep
-- their full safe public projection (0036's get_listing_detail already
-- exposes these publicly) but are never submittable. is_submittable is UI
-- guidance only -- it does not reserve stock and does not guarantee future
-- order-submission success; a future order-creation path must independently
-- revalidate everything. An own-shop cart row cannot occur through the
-- write path in this migration (set_cart_item_quantity/merge_guest_cart
-- both reject it before insertion via CANNOT_BUY_OWN_LISTING), but this
-- read path still defensively distinguishes it as unavailable_reason =
-- 'own_listing' -- never 'blocked', which would misrepresent a structural
-- ownership fact as an interpersonal block -- and, unlike the hidden-state
-- branch, does NOT null out the listing/shop fields: an own-shop listing
-- that is otherwise within the public visibility boundary stays fully
-- visible, it is merely never submittable. unavailable_reason branches are
-- evaluated in a fixed priority so the result is deterministic whenever
-- more than one condition applies: hidden/private state first (privacy
-- always wins), then own-shop, then peer block, then buyer restriction,
-- then inquiry-only, then the direct listing-status reasons
-- (reserved/sold/archived), then insufficient stock.
create or replace function public.get_my_cart()
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  title text,
  cover_image_storage_path text,
  price_cents bigint,
  price_cents_snapshot bigint,
  price_changed boolean,
  status text,
  is_inquiry_only boolean,
  requested_quantity integer,
  current_available_quantity integer,
  is_submittable boolean,
  unavailable_reason text,
  shop_id uuid,
  shop_slug text,
  shop_name text,
  added_at timestamptz
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
      ci.listing_id,
      case when flags.is_hidden then null else l.public_code end as public_code,
      case when flags.is_hidden then null else l.slug end as slug,
      case when flags.is_hidden then null else l.title end as title,
      case when flags.is_hidden then null else img.storage_path end as cover_image_storage_path,
      case when flags.is_hidden then null else l.price_cents end as price_cents,
      ci.price_cents_snapshot,
      case when flags.is_hidden then null else (l.price_cents <> ci.price_cents_snapshot) end as price_changed,
      case when flags.is_hidden then 'unavailable' else l.status::text end as status,
      case when flags.is_hidden then null else cat.is_inquiry_only end as is_inquiry_only,
      ci.quantity as requested_quantity,
      case when flags.is_hidden then null else l.available_quantity end as current_available_quantity,
      calc.is_submittable,
      calc.unavailable_reason,
      case when flags.is_hidden then null else s.id end as shop_id,
      case when flags.is_hidden then null else s.slug end as shop_slug,
      case when flags.is_hidden then null else s.name end as shop_name,
      ci.added_at
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    join public.listings l on l.id = ci.listing_id
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    left join public.listing_images img on img.id = l.cover_image_id
    join lateral (
      select
        (
          l.status in ('paused', 'draft')
          or exists (
            select 1 from public.user_restrictions ur
            where ur.user_id = s.owner_id
              and ur.lifted_at is null
              and ur.restriction_type in ('seller_suspended', 'account_suspended')
          )
        ) as is_hidden,
        exists (
          select 1 from public.user_blocks ub
          where (ub.blocker_id = v_caller_id and ub.blocked_id = s.owner_id)
             or (ub.blocker_id = s.owner_id and ub.blocked_id = v_caller_id)
        ) as is_blocked,
        exists (
          select 1 from public.user_restrictions ur
          where ur.user_id = v_caller_id
            and ur.lifted_at is null
            and ur.restriction_type in ('buyer_restricted', 'account_suspended')
        ) as is_buyer_restricted
    ) flags on true
    join lateral (
      select
        (
          not flags.is_hidden
          and l.status = 'available'
          and cat.is_inquiry_only = false
          and s.owner_id <> v_caller_id
          and not flags.is_blocked
          and not flags.is_buyer_restricted
          and ci.quantity <= l.available_quantity
        ) as is_submittable,
        case
          when flags.is_hidden then 'no_longer_available'
          when s.owner_id = v_caller_id then 'own_listing'
          when flags.is_blocked then 'blocked'
          when flags.is_buyer_restricted then 'buyer_restricted'
          when cat.is_inquiry_only then 'inquiry_only'
          when l.status = 'reserved' then 'reserved'
          when l.status = 'sold' then 'sold'
          when l.status = 'archived' then 'archived'
          when ci.quantity > l.available_quantity then 'insufficient_stock'
          else null
        end as unavailable_reason
    ) calc on true
    where c.user_id = v_caller_id
    order by ci.added_at desc, ci.id desc;
end;
$$;

revoke all on function public.get_my_cart() from public;
revoke all on function public.get_my_cart() from anon;
grant execute on function public.get_my_cart() to authenticated;

-- ============================================================
-- merge_guest_cart
-- ============================================================
-- p_items is a jsonb array of {"listing_id": "<uuid>", "quantity": N}. No
-- custom composite type is created. Duplicate listing_ids within the guest
-- payload are normalized via GROUP BY + MAX(quantity) before any mutation,
-- so iteration order of the input JSON never affects the result. For each
-- distinct listing_id: desired_quantity = GREATEST(existing signed-in
-- quantity if a row already exists, else 0, guest quantity). If the listing
-- is not currently cartable (same eligibility test as set_cart_item_quantity,
-- including own-shop and either-direction block), the row is left untouched
-- and result = 'skipped_not_cartable'. If it is cartable but
-- desired_quantity exceeds current available_quantity, the row is left
-- untouched (never capped, never created) and result = 'skipped_quantity'.
-- Otherwise the row is upserted with quantity = desired_quantity and a
-- freshly refreshed price_cents_snapshot, result = 'merged'. Exactly one
-- result row is returned per unique input listing_id. The whole call is one
-- transaction; a malformed/oversized payload or an authentication failure
-- rejects the entire call, but per-item ineligibility is a normal result
-- row, never a transaction failure -- this is the intended meaning of
-- "merge carefully" from PRD S20.2.
create or replace function public.merge_guest_cart(
  p_items jsonb
)
returns table (
  listing_id uuid,
  result text,
  final_quantity integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
  v_cart_id uuid;
  v_item record;
  v_shop_owner_id uuid;
  v_shop_eligible boolean;
  v_current_price bigint;
  v_available_quantity integer;
  v_blocked boolean;
  v_existing_quantity integer;
  v_desired_quantity integer;
  v_result text;
  v_final_quantity integer;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'Account is currently restricted.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Guest cart payload must be a JSON array.' using detail = 'CART_MERGE_INVALID';
  end if;

  if jsonb_array_length(p_items) > 200 then
    raise exception 'Too many items to merge.' using detail = 'LIMIT_INVALID';
  end if;

  -- NULL-safe, cast-safe malformed-item detection: uses the jsonb
  -- existence operator (?) for missing keys and a regex for the quantity
  -- format rather than ::numeric/::integer casts, so a missing key or a
  -- non-numeric quantity can never silently evaluate to NULL (which would
  -- let a malformed row slip through an OR chain undetected) and can never
  -- raise a raw Postgres cast error instead of this function's own
  -- CART_MERGE_INVALID.
  if exists (
    select 1
    from jsonb_array_elements(p_items) as elem
    where not (elem ? 'listing_id')
       or jsonb_typeof(elem -> 'listing_id') <> 'string'
       or (elem ->> 'listing_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not (elem ? 'quantity')
       or jsonb_typeof(elem -> 'quantity') <> 'number'
       or (elem ->> 'quantity') !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Guest cart payload contains an invalid item.' using detail = 'CART_MERGE_INVALID';
  end if;

  insert into public.carts (user_id)
  values (v_caller_id)
  on conflict (user_id) do nothing;

  select c.id into v_cart_id
    from public.carts c
    where c.user_id = v_caller_id;

  for v_item in
    select
      (elem ->> 'listing_id')::uuid as listing_id,
      max((elem ->> 'quantity')::integer) as guest_quantity
    from jsonb_array_elements(p_items) as elem
    group by (elem ->> 'listing_id')::uuid
  loop
    select ci.quantity into v_existing_quantity
      from public.cart_items ci
      where ci.cart_id = v_cart_id and ci.listing_id = v_item.listing_id;

    if not found then
      v_existing_quantity := null;
    end if;

    v_desired_quantity := greatest(coalesce(v_existing_quantity, 0), v_item.guest_quantity);

    select
      s.owner_id,
      (
        l.status = 'available'
        and cat.is_inquiry_only = false
        and not exists (
          select 1 from public.user_restrictions ur
          where ur.user_id = s.owner_id
            and ur.lifted_at is null
            and ur.restriction_type in ('seller_suspended', 'account_suspended')
        )
      ),
      l.price_cents,
      l.available_quantity
    into v_shop_owner_id, v_shop_eligible, v_current_price, v_available_quantity
      from public.listings l
      join public.shops s on s.id = l.shop_id
      join public.categories cat on cat.id = l.category_id
      where l.id = v_item.listing_id;

    if not found or not v_shop_eligible or v_shop_owner_id = v_caller_id then
      v_result := 'skipped_not_cartable';
      v_final_quantity := v_existing_quantity;
    else
      select exists (
        select 1 from public.user_blocks ub
        where (ub.blocker_id = v_caller_id and ub.blocked_id = v_shop_owner_id)
           or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_caller_id)
      ) into v_blocked;

      if v_blocked then
        v_result := 'skipped_not_cartable';
        v_final_quantity := v_existing_quantity;
      elsif v_desired_quantity > v_available_quantity then
        v_result := 'skipped_quantity';
        v_final_quantity := v_existing_quantity;
      else
        insert into public.cart_items as ci (cart_id, listing_id, quantity, price_cents_snapshot)
        values (v_cart_id, v_item.listing_id, v_desired_quantity, v_current_price)
        on conflict (cart_id, listing_id) do update
          set quantity = excluded.quantity,
              price_cents_snapshot = excluded.price_cents_snapshot;

        v_result := 'merged';
        v_final_quantity := v_desired_quantity;
      end if;
    end if;

    return query select v_item.listing_id, v_result, v_final_quantity;
  end loop;

  return;
end;
$$;

revoke all on function public.merge_guest_cart(jsonb) from public;
revoke all on function public.merge_guest_cart(jsonb) from anon;
grant execute on function public.merge_guest_cart(jsonb) to authenticated;
