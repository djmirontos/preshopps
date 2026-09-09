-- My Listings + Seller Status Actions: exactly two new SECURITY DEFINER
-- RPCs -- get_my_shop_listings (the seller-owned listing list/read RPC the
-- new /seller/listings page needs) and update_listing_status (the only
-- seller-controlled status-mutation path). No new table, enum, column,
-- index, trigger, or RLS policy. No existing function is touched --
-- create_listing, update_listing, publish_listing, accept_seller_policies,
-- replace_listing_images, get_my_listing, and every order-lifecycle RPC
-- remain byte-for-byte as they are.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0063_get_my_listing_rpc (confirmed live via
-- list_migrations, no drift). listings columns confirmed exactly as
-- 0008/0009 left them: status (listing_status_enum, not null, default
-- 'draft'), stock_quantity/reserved_quantity (both not null), available_
-- quantity (generated always as stock_quantity - reserved_quantity,
-- stored), cover_image_id (nullable uuid, composite-FK'd to listing_images
-- (id, listing_id) per 0009), archived_at (nullable timestamptz, added by
-- 0008, confirmed live via information_schema.columns immediately before
-- writing this file -- and confirmed by a full-text search of every
-- migration that it has NEVER been written anywhere: create_listing,
-- update_listing, and every order-lifecycle RPC leave it untouched, so
-- this migration is the first to ever set it). listing_status_enum
-- confirmed live via pg_enum: draft, available, reserved, paused, sold,
-- archived, in that order, unchanged since 0002. No get_my_shop_listings,
-- update_listing_status, or similarly-named function exists anywhere --
-- clean namespace (confirmed via pg_proc). listings carries RLS enabled
-- with zero policies (confirmed live: 0 rows in pg_policies for
-- tablename='listings'), the same posture as every other write-guarded
-- table in this schema -- these two SECURITY DEFINER functions are the
-- sole trusted path, no RLS policy is added.
--
-- Canonical status-transition research (PRD 4.3, 10.2, 10.3, 21.6, 22;
-- live accept_order_items/complete_order/cancel_accepted_order source in
-- 0040, re-read immediately before writing this file)
-- -----------------------------------------------------------------------
-- PRD 4.3 lists "Pause, archive, reserve, or mark listings sold" as a
-- general seller-capabilities bullet, separate from "Accept or decline
-- orders." Taken in isolation this could misread as sellers being able to
-- manually set Reserved -- but PRD 21.6 resolves this precisely: "Stock is
-- reserved only when seller accepts... First accepted request reserves
-- the item, Listing becomes Reserved." Reserved is never a state a seller
-- sets directly; it is the *result* of the seller's accept action, applied
-- by accept_order_items itself. The live accept_order_items/complete_order/
-- cancel_accepted_order source (0040) confirms this is not just prose:
-- 'reserved' is written only by accept_order_items (when a listing's
-- available_quantity reaches exactly 0 on acceptance) and read/transitioned
-- away from only by complete_order (reserved -> sold, once the last active
-- reservation for that listing is consumed) and cancel_accepted_order/
-- resolve_order_cancellation (reserved -> available, once a released
-- reservation brings available_quantity back above 0). No manual path to
-- or from 'reserved' is invented here; update_listing_status refuses
-- 'reserved' as a target outright (TARGET_STATUS_NOT_ALLOWED) and refuses
-- to touch a listing that currently has any active reservation at all
-- (see "Active-reservation guard" below) -- covering both a fully-reserved
-- listing (status already 'reserved') and a partially-reserved one
-- (status still 'available' but reserved_quantity > 0 because a multi-
-- quantity item has an order in flight for part of its stock).
--
-- Active-reservation guard: broader than "status = reserved" on purpose
-- -----------------------------------------------------------------------
-- A quantity-1 listing's reserved_quantity > 0 if and only if its status
-- is already 'reserved' (confirmed by the accept/complete/cancel source
-- above), so checking reserved_quantity > 0 strictly subsumes checking
-- status = 'reserved' for that case. But a multi-quantity listing can have
-- reserved_quantity > 0 while status stays 'available' (available_quantity
-- still > 0), and canon does not explicitly resolve whether a seller may
-- pause/archive/mark-sold that listing while part of its stock is actively
-- promised to an in-progress order. This migration takes the conservative
-- reading the task's own instruction requires ("must not override or break
-- active order reservations," "do not allow seller to bypass active-order/
-- inventory protections"): ANY reserved_quantity > 0 blocks every status
-- mutation via this RPC, not only the fully-reserved case. This is a
-- judgment call where canon does not fully resolve the partial-reservation
-- edge case -- reported here rather than silently assumed.
--
-- Allowed transition matrix -- reported, not fully resolved by canon either
-- -----------------------------------------------------------------------
-- Canon confirms the six statuses (10.2) and their visibility (10.3), and
-- confirms Draft -> Available is exclusively publish_listing's job (10.6,
-- unconditionally excluded here: TARGET_STATUS_NOT_ALLOWED for 'draft' as
-- well as 'reserved'). Canon does NOT enumerate a transition table for the
-- remaining pairs. The matrix implemented below is this migration's own
-- conservative, additive-only resolution, chosen to match the most
-- natural reading of 10.2/10.3/4.3 and reported explicitly per the task's
-- own instruction ("If canonical docs do not explicitly resolve a
-- transition, report it before inventing it"):
--   draft     -> archived                          (seller abandons a Draft they no longer want to finish -- there is no delete-listing RPC anywhere in this schema, so Archive is the only cleanup path)
--   available -> paused | sold | archived
--   paused    -> available | sold | archived
--   sold      -> archived
--   archived  -> (nothing -- terminal)
-- Explicitly NOT implemented, because canon gives no support for them and
-- inventing either would be a real product decision, not a smallest-fix:
--   sold -> available/paused ("un-selling"/relisting under the same row)
--   archived -> anything ("un-archiving")
-- If either is actually wanted, it is a product decision to surface before
-- building it, not something this migration should quietly add.
--
-- update_listing_status: one RPC, not four, chosen deliberately
-- -----------------------------------------------------------------------
-- A single update_listing_status(p_listing_id, p_status) RPC was chosen
-- over four separate pause_listing/resume_listing/archive_listing/
-- mark_listing_sold functions: all four would share the exact same
-- ownership/restriction/reservation-guard boilerplate and differ only in
-- which target status and which whitelist branch applies, so one function
-- with an explicit, exhaustively-validated target status is the smaller
-- surface (one grant, one signature, one migration to reason about) --
-- the identical reasoning update_listing's own single-patch-RPC design
-- already established for scalar field edits (0059's header).
--
-- Idempotent, matching this schema's own established convention
-- -----------------------------------------------------------------------
-- Calling update_listing_status with the listing's own current status is a
-- safe no-op (was_already_in_status = true, zero mutation, no reservation/
-- transition check even attempted) -- the same idempotency-before-deeper-
-- validation shape as accept_order_items/cancel_accepted_order/
-- complete_order/accept_seller_policies.
--
-- get_my_shop_listings: read-only, cursor-paginated, shaped for cards
-- -----------------------------------------------------------------------
-- Identical auth/shop/cursor shape to get_my_shop_orders (0043): p_limit
-- default 20 clamped to [1, 50], p_before_created_at/p_before_id keyset
-- pair on (created_at, id) DESC, must be supplied together (CURSOR_INVALID),
-- newest-first. No shop yet returns zero rows (not an error) -- identical
-- reasoning to get_my_shop_orders' own header: "no shop yet" is a normal,
-- expected state for this list, not a failure. p_status is an optional
-- exact-match filter over the real listing_status_enum (any of the six
-- values, unrestricted -- unlike update_listing_status's target-status
-- restriction, filtering by 'draft' or 'reserved' is completely valid and
-- expected for the seller's own status tabs); NULL means "all statuses."
-- Every column a compact management card needs is projected directly from
-- listings, plus the cover image resolved via listings.cover_image_id ->
-- listing_images.storage_path -- the exact same LEFT JOIN pattern already
-- used by every public listing-card projection (get_listing_detail,
-- browse_listings, get_my_favorites, get_my_cart, submit_cart_order,
-- get_my_shop_order_detail, get_my_conversations), not the position-based
-- lookup get_my_listing (0063) uses for its own different job (that RPC
-- needs the full ordered image set for the edit form; this one only ever
-- needs the one cover photo for a card). category_id/listing_type/
-- condition are returned as plain nullable ids/enums, never resolved to
-- display names here -- exactly like get_my_listing's own established
-- reasoning: the frontend already loads categories/type/condition label
-- maps as reference data and resolves names itself, so resolving them
-- again here would be redundant work this RPC has no other reason to do.
-- A title-only Draft with every other column null (no category, no price,
-- no images) returns cleanly as one row, never omitted or erroring --
-- the same "Draft may be incomplete" guarantee get_my_listing already
-- provides, extended to the list view.
--
-- Security: both functions are SECURITY DEFINER, SET search_path = '',
-- every table reference fully schema-qualified, every column alias-
-- qualified. REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated
-- only. Identity comes exclusively from auth.uid() in both -- no
-- p_user_id/p_shop_id/p_owner_id parameter exists anywhere. Zero direct
-- table SELECT/UPDATE grants of any kind; both RPCs remain the sole
-- trusted path. update_listing_status locks the listing row FOR UPDATE as
-- the universal serialization point (same convention as every other
-- listing-mutating RPC), so a concurrent accept_order_items call against
-- the same listing cannot race with a seller's status change.

-- ============================================================
-- get_my_shop_listings
-- ============================================================
create or replace function public.get_my_shop_listings(
  p_status public.listing_status_enum default null,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  title text,
  status public.listing_status_enum,
  price_cents bigint,
  stock_quantity integer,
  reserved_quantity integer,
  available_quantity integer,
  cover_image_path text,
  category_id integer,
  listing_type public.listing_type_enum,
  condition public.listing_condition_enum,
  created_at timestamptz,
  updated_at timestamptz,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_shop_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller's own shop -- no shop yet is a normal empty state, not an error =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    return;
  end if;

  -- ===================== pagination validation =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  -- ===================== newest-first, optional status filter, cover image via the trusted cover_image_id =====================
  return query
    select
      l.id as listing_id,
      l.public_code,
      l.slug,
      l.title,
      l.status,
      l.price_cents,
      l.stock_quantity,
      l.reserved_quantity,
      l.available_quantity,
      img.storage_path as cover_image_path,
      l.category_id,
      l.listing_type,
      l.condition,
      l.created_at,
      l.updated_at,
      l.published_at
    from public.listings l
    left join public.listing_images img on img.id = l.cover_image_id
    where l.shop_id = v_shop_id
      and (p_status is null or l.status = p_status)
      and (
        p_before_created_at is null
        or (l.created_at, l.id) < (p_before_created_at, p_before_id)
      )
    order by l.created_at desc, l.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_shop_listings(public.listing_status_enum, integer, timestamptz, uuid) from public;
revoke all on function public.get_my_shop_listings(public.listing_status_enum, integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_shop_listings(public.listing_status_enum, integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- update_listing_status
-- ============================================================
create or replace function public.update_listing_status(
  p_listing_id uuid,
  p_status public.listing_status_enum
)
returns table (
  listing_id uuid,
  status public.listing_status_enum,
  was_already_in_status boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_current_status public.listing_status_enum;
  v_reserved_quantity integer;
  v_updated_at timestamptz;
  v_allowed boolean;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to manage listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== structural input validation: only these four targets are ever reachable through this RPC =====================
  -- 'draft' is publish_listing's exclusive destination (Draft -> Available
  -- only); 'reserved' is exclusively order-driven (accept_order_items/
  -- cancel_accepted_order/complete_order). Neither is ever a valid p_status
  -- here, regardless of the listing's current status.
  if p_status is null or p_status not in ('available', 'paused', 'sold', 'archived') then
    raise exception 'That status cannot be set directly.' using detail = 'TARGET_STATUS_NOT_ALLOWED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.shop_id, l.status, l.reserved_quantity, l.updated_at
    into v_listing_shop_id, v_current_status, v_reserved_quantity, v_updated_at
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to manage this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  -- ===================== idempotent: requesting the current status is a safe no-op, checked before any deeper validation =====================
  if v_current_status = p_status then
    return query
      select p_listing_id, v_current_status, true, v_updated_at;
    return;
  end if;

  -- ===================== active-reservation guard (see this migration's own header for why this is broader than "status = reserved") =====================
  if v_reserved_quantity > 0 then
    raise exception 'This listing has an active order reservation and cannot be changed right now.' using detail = 'LISTING_HAS_ACTIVE_RESERVATION';
  end if;

  -- ===================== allowed transition matrix (see this migration's own header) =====================
  v_allowed := (
    (v_current_status = 'draft' and p_status = 'archived')
    or (v_current_status = 'available' and p_status in ('paused', 'sold', 'archived'))
    or (v_current_status = 'paused' and p_status in ('available', 'sold', 'archived'))
    or (v_current_status = 'sold' and p_status = 'archived')
  );

  if not v_allowed then
    raise exception 'That status change is not allowed.' using detail = 'INVALID_STATUS_TRANSITION';
  end if;

  -- ===================== apply: status only, archived_at set once, nothing else touched =====================
  update public.listings as l
    set status = p_status,
        archived_at = case when p_status = 'archived' then now() else l.archived_at end
    where l.id = p_listing_id
    returning l.updated_at into v_updated_at;

  return query
    select p_listing_id, p_status, false, v_updated_at;
end;
$$;

revoke all on function public.update_listing_status(uuid, public.listing_status_enum) from public;
revoke all on function public.update_listing_status(uuid, public.listing_status_enum) from anon;
grant execute on function public.update_listing_status(uuid, public.listing_status_enum) to authenticated;
