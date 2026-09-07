-- Fix a real projection gap in get_my_cart() discovered while building the
-- Order Submission frontend module: the RPC never returned cart_items.id
-- (only listing_id), even though submit_cart_order's sole selector
-- parameter is p_cart_item_ids uuid[] -- the frontend had no safe way to
-- obtain it without an extra per-row RPC call solely to recover an id.
-- get_my_cart also never returned a listing's supported fulfillment
-- methods, so the buyer could be offered a delivery/pickup method that was
-- guaranteed to fail submit_cart_order's own FULFILLMENT_INVALID check.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0040_notifications; this is the next migration,
-- no drift. get_my_cart's live definition (0037_favorites_cart_rls_and_rpcs.sql,
-- re-read in full immediately before writing this file) has never been
-- touched again by 0038/0039/0040 -- confirmed by a full-text search of
-- every migration for "get_my_cart", which only ever matches doc-comment
-- mentions and its own original definition. Its current RETURNS TABLE is
-- exactly (listing_id, public_code, slug, title, cover_image_storage_path,
-- price_cents, price_cents_snapshot, price_changed, status, is_inquiry_only,
-- requested_quantity, current_available_quantity, is_submittable,
-- unavailable_reason, shop_id, shop_slug, shop_name, added_at). No function
-- anywhere calls get_my_cart (confirmed by the same search), so widening its
-- RETURNS TABLE has no dependent-object impact.
--
-- listing_fulfillment_methods confirmed unchanged (0008_listings.sql):
-- (listing_id uuid not null references listings(id) on delete cascade,
-- method fulfillment_method_enum not null, primary key (listing_id,
-- method)) -- a pure join table, no independent identity, no extra index
-- needed beyond its own composite primary key (which already leads with
-- listing_id). get_listing_detail (0036_public_marketplace_read_rpcs.sql)
-- already aggregates this exact table into an array via
-- `left join lateral (select array_agg(lfm.method order by lfm.method) as
-- methods from public.listing_fulfillment_methods lfm where lfm.listing_id
-- = l.id) fm on true` plus `coalesce(fm.methods, '{}'::fulfillment_method_enum[])`
-- -- reused verbatim below for consistency with that established pattern.
--
-- Postgres does not allow CREATE OR REPLACE FUNCTION to change a table
-- function's output column list (confirmed Postgres behavior: it raises
-- "cannot change return type of existing function", with a HINT to drop
-- first) -- this function is dropped and recreated rather than replaced.
-- DROP FUNCTION also drops its privilege grants, which are reissued
-- identically below (REVOKE ALL FROM public/anon, GRANT EXECUTE TO
-- authenticated only -- carts remain a sign-in-only surface per 0037).
--
-- Scope: exactly two additive output columns (cart_item_id, fulfillment_methods),
-- nothing else. Every existing column, every join/lateral, every branch of
-- the is_hidden/is_blocked/is_buyer_restricted/is_submittable/
-- unavailable_reason logic, the ordering, and the auth/deleted-profile
-- handling are byte-for-byte unchanged from the live 0037 definition. No
-- RLS, table, index, or enum is created or altered. No change to
-- submit_cart_order, set_cart_item_quantity, remove_cart_item,
-- merge_guest_cart, add_favorite, remove_favorite, get_my_favorites, or any
-- other function -- this migration touches get_my_cart only.
--
-- Gating rule for the two new columns: cart_item_id (ci.id) is buyer-owned
-- cart metadata, not listing data -- it is never nulled by the is_hidden
-- gate, exactly like the pre-existing, already-ungated ci.listing_id/
-- ci.price_cents_snapshot/ci.quantity/ci.added_at columns. fulfillment_methods
-- IS listing data, so it follows the SAME is_hidden gate as public_code/
-- slug/title/price_cents/etc. -- null for a hidden (paused/draft/
-- suspended-shop) row, never a guessed or partial value; a non-hidden row
-- with zero configured methods gets '{}' (empty array), never null, via the
-- same coalesce get_listing_detail already uses.
drop function public.get_my_cart();

create function public.get_my_cart()
returns table (
  cart_item_id uuid,
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
  fulfillment_methods public.fulfillment_method_enum[],
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
      ci.id as cart_item_id,
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
      case when flags.is_hidden then null else coalesce(fm.methods, '{}'::public.fulfillment_method_enum[]) end as fulfillment_methods,
      ci.added_at
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    join public.listings l on l.id = ci.listing_id
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    left join public.listing_images img on img.id = l.cover_image_id
    left join lateral (
      select array_agg(lfm.method order by lfm.method) as methods
      from public.listing_fulfillment_methods lfm
      where lfm.listing_id = l.id
    ) fm on true
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
