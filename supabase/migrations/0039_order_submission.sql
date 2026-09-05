-- Order Creation / Submission: exactly one business RPC,
-- public.submit_cart_order, converting a buyer's selected cart intent into
-- one pending order per distinct shop, with full live revalidation. No
-- schema changes -- every column, constraint, and enum this function needs
-- already exists.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0038_fix_cart_item_upsert_ambiguity; this is the
-- next migration, no drift. public.submit_cart_order does not exist.
-- Confirmed unchanged: orders, order_items, carts, cart_items, listings,
-- shops, categories, user_blocks, user_restrictions,
-- listing_fulfillment_methods, inventory_reservations columns/constraints;
-- order_status_enum, order_item_status_enum, fulfillment_method_enum;
-- accept_order_items and expire_pending_orders source (both re-read in full
-- during design). orders.public_code: text, not null, no column default,
-- UNIQUE via orders_public_code_key, CHECK (length(btrim(public_code)) > 0)
-- via orders_public_code_not_blank_check -- identical shape on
-- listings.public_code. No existing function anywhere generates a
-- public_code (confirmed by a full-text search of every function body); no
-- reusable helper exists. pgcrypto 1.3 is installed, providing
-- gen_random_bytes. Object counts confirmed unchanged from the 0038
-- baseline (tables=31, indexes=85, triggers=10, enums=16, policies=14,
-- functions=31); all 31 pre-existing function hashes captured as the
-- regression baseline.
--
-- Cart -> order boundary (locked design)
-- -----------------------------------------------------------------------
-- cart_items is never authoritative. Every fact -- listing status,
-- category, seller suspension, own-shop, peer block, live available
-- quantity, live price -- is re-derived from listings/shops/categories/
-- user_restrictions/user_blocks at submission time, exactly mirroring the
-- revalidation pattern already proven in set_cart_item_quantity/
-- merge_guest_cart. order_items.price_cents_snapshot is always the CURRENT
-- listings.price_cents, never cart_items.price_cents_snapshot -- if they
-- differ, the whole submission is rejected (PRICE_CHANGED) rather than
-- silently using either value. This function creates orders/order_items
-- rows only; it never writes inventory_reservations and never mutates
-- listings.reserved_quantity or listings.status -- accept_order_items
-- remains the sole reservation point, confirmed by its own source (it only
-- inserts inventory_reservations when an order's outcome is full
-- 'accepted'), and by cancel_pending_order's own corruption guard, which
-- raises if an active reservation is ever found on a pending order.
--
-- Atomicity (locked)
-- -----------------------------------------------------------------------
-- Any invalid selected item, any price drift, any fulfillment
-- incompatibility anywhere in the selection rejects the ENTIRE submission --
-- zero orders, zero order_items, zero cart_items deleted. There is no
-- partial-success branch anywhere in this function, unlike
-- merge_guest_cart's intentional per-item skip results -- a user-confirmed
-- checkout action must not silently drop a line.
--
-- Per-shop fulfillment (locked correction from the reviewed design)
-- -----------------------------------------------------------------------
-- orders.fulfillment_method is NOT NULL per order row, and submission
-- creates one order per shop, so different shops in the same checkout may
-- legitimately need different methods (e.g. Shop A pickup, Shop B
-- shipping) -- a single submission-wide fulfillment method was rejected as
-- incorrect. p_fulfillment_choices is a jsonb array of
-- {"shop_id": "<uuid>", "method": "<enum text>"}, validated fully at the
-- text level (existence + jsonb_typeof + regex/literal-membership checks)
-- BEFORE any ::uuid or ::fulfillment_method_enum cast is attempted -- the
-- exact NULL-safe, cast-safe pattern already proven in merge_guest_cart's
-- 0038 fix, so an invalid UUID shape or an invalid method string can never
-- raise a raw 22P02 instead of this function's own FULFILLMENT_INVALID.
-- The caller-supplied shop_id values are never trusted as ownership or
-- order-existence truth -- they are only lookup keys checked for an EXACT
-- set match against the shop_ids independently derived from the caller's
-- own already-validated selected cart items. Duplicate shop_id entries in
-- the payload are rejected, never normalized (unlike merge_guest_cart's
-- guest-quantity duplicates, two different fulfillment methods for one
-- shop cannot be sensibly merged). For each derived shop, every selected
-- listing belonging to that shop must support the chosen method via
-- listing_fulfillment_methods -- if even one selected listing for a shop
-- is incompatible with every possible method that shop's items could
-- share, no method can satisfy the check and the whole submission rejects;
-- this function never splits one shop into multiple orders by fulfillment
-- method.
--
-- Public order code (locked format)
-- -----------------------------------------------------------------------
-- 'PSO-' || upper(encode(extensions.gen_random_bytes(8), 'hex')) -- a
-- literal prefix plus 16 uppercase hex characters (64 bits of randomness),
-- e.g. PSO-7A91D33F06C2B418. Non-sequential (no ordering/volume leakage),
-- never caller-supplied, generated inline (no separate helper function --
-- there is exactly one caller). Collision handling: generate-and-attempt
-- insert in a bounded loop (max 5 attempts); on unique_violation,
-- GET STACKED DIAGNOSTICS reads the failing constraint name and retries
-- ONLY when it is exactly orders_public_code_key -- any other integrity
-- violation is re-raised unmodified rather than silently retried. Exhausting
-- 5 genuine collisions (astronomically unlikely at 64 bits of entropy)
-- raises a generic SUBMISSION_INVALID rather than leaking constraint
-- details.
--
-- Runtime-safety corrections (final inspection, before first apply)
-- -----------------------------------------------------------------------
-- (1) gen_random_bytes(integer) is confirmed live to reside in the
-- extensions schema, not pg_catalog and not public. Because this function
-- runs under SET search_path = '', NO schema is implicitly searched except
-- pg_catalog (which is always consulted regardless of search_path) -- an
-- unqualified gen_random_bytes(8) call was empirically confirmed (via a
-- disposable pg_temp probe function run with the identical search_path='')
-- to fail every single time with 42883 undefined_function. The call is
-- schema-qualified as extensions.gen_random_bytes(8) to fix this; the
-- locked code format and 8-byte/64-bit entropy are unchanged. Every other
-- built-in used in this function (encode, upper, btrim, nullif,
-- coalesce, jsonb_typeof, the ? and ->/->> jsonb operators, unnest,
-- array_length, char_length, the !~*/~* regex operators, count, sum,
-- GET STACKED DIAGNOSTICS) was confirmed to resolve only inside
-- pg_catalog (or, for GET STACKED DIAGNOSTICS and the regex/jsonb
-- operators, is a language construct/operator rather than a schema-visible
-- function at all) -- pg_catalog is always implicitly searched no matter
-- the search_path setting, so none of these needed qualification, and none
-- were mechanically qualified.
-- (2) ON COMMIT DROP releases a temporary table at transaction COMMIT, not
-- when the function returns -- empirically confirmed (via the same
-- disposable-probe technique) that a second submit_cart_order call inside
-- one still-open transaction would otherwise fail with 42P07 relation
-- already exists against a fixed-name temp table left over from the first
-- call. Fixed by an explicit, pg_temp-schema-qualified
-- DROP TABLE IF EXISTS immediately before each CREATE TEMPORARY TABLE --
-- pg_temp always denotes the caller's own session-local temporary schema
-- and can never reference or affect a persistent object in any schema, so
-- this is safe under every calling pattern (single call, or several calls
-- inside one transaction) without touching any business table. This also
-- closes the SECURITY DEFINER/pg_temp shadowing question raised during
-- review: because search_path is empty, a bare, unqualified relation name
-- inside this function can NEVER resolve to a persistent object in any
-- schema (public or otherwise) -- persistent schemas are not searched at
-- all under search_path='' -- so a caller-created object of the same name
-- can never shadow or be mistaken for this function's own temporary
-- tables; empirically confirmed by the same probe technique, which
-- successfully created and read back a bare-named temp table under
-- search_path=''.
--
-- Ambiguity-bug re-audit (0021/0022/0037 precedent)
-- -----------------------------------------------------------------------
-- This function's RETURNS TABLE output columns (order_id, shop_id,
-- order_public_code, item_count, total_cents, status) collide in name with
-- real columns on public.orders/public.order_items (order_id, shop_id,
-- status) and with columns this function's own temporary working tables
-- would otherwise use. No ON CONFLICT clause is used anywhere in this
-- function (every orders/order_items insert is a fresh row, never an
-- upsert), which is the only construct previously found to force a bare,
-- unqualifiable identifier into an expression-parsing position subject to
-- PL/pgSQL variable-name resolution (0037's exact bug). Plain INSERT
-- column-lists are pure catalog lookups against the target table, not
-- expression positions, and were never the source of that bug (confirmed:
-- 0037's own plain cart_items insert column-lists never errored, only its
-- ON CONFLICT target did) -- they are used freely here. As additional,
-- deliberately conservative defense, this function's own temporary tables
-- never define a column literally named order_id (the one column this
-- function both outputs AND would otherwise want to update after creating
-- each order) -- it is named matched_order_id instead, so even an
-- UPDATE ... SET target (itself normally a safe catalog-lookup position,
-- not an expression position) can never be a point of doubt. Every other
-- column read throughout is alias-qualified (ci., c., l., s., cat., img.,
-- ur., ub., t., f., agg., r.). No dynamic SQL anywhere.
--
-- Retry protection, not idempotency (locked, documented per instruction)
-- -----------------------------------------------------------------------
-- Selected cart_items rows are deleted only after all orders and all
-- order_items for this call have been created, in the same transaction. A
-- retried call reusing the same p_cart_item_ids after a prior success finds
-- those rows already gone and fails cleanly with CART_ITEM_NOT_FOUND,
-- creating no duplicate order. This is pragmatic MVP retry protection for
-- the common double-click/back-button case, NOT payment-grade,
-- general-purpose idempotency -- it does not protect against a client that
-- blindly retries with a different cart snapshot after a network timeout it
-- never observed a response for. A future protected/paid checkout flow must
-- introduce a real client-supplied idempotency key; none is added here.

create or replace function public.submit_cart_order(
  p_cart_item_ids uuid[],
  p_fulfillment_choices jsonb,
  p_buyer_note text default null
)
returns table (
  order_id uuid,
  shop_id uuid,
  order_public_code text,
  item_count integer,
  total_cents bigint,
  status public.order_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
  v_buyer_note text;
  v_constraint_name text;
  v_public_code text;
  v_new_order_id uuid;
  v_attempt integer;
  r record;
begin
  -- ===================== auth =====================
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== active buyer profile =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== buyer restrictions =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'Account is currently restricted.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== structural validation of selected ids =====================
  if p_cart_item_ids is null or coalesce(array_length(p_cart_item_ids, 1), 0) = 0 then
    raise exception 'At least one cart item must be selected.' using detail = 'SUBMISSION_INVALID';
  end if;

  if exists (select 1 from unnest(p_cart_item_ids) x where x is null) then
    raise exception 'Selected cart item ids may not be null.' using detail = 'SUBMISSION_INVALID';
  end if;

  if (select count(*) from unnest(p_cart_item_ids)) <> (select count(distinct x) from unnest(p_cart_item_ids) x) then
    raise exception 'Duplicate cart item ids are not allowed.' using detail = 'SUBMISSION_INVALID';
  end if;

  -- ===================== materialize selected rows with live state =====================
  -- Scoped to the caller's own cart by construction (carts.user_id join) --
  -- a cart_item_id belonging to another user's cart simply matches no row.
  -- Explicit pg_temp-qualified drop first: ON COMMIT DROP only releases the
  -- table at transaction COMMIT, not when this function returns, so a
  -- second submit_cart_order call inside the same still-open transaction
  -- would otherwise hit "relation already exists" (42P07) against a table
  -- left over from the first call. pg_temp always refers to the caller's
  -- own session-local temporary schema, never a persistent one, so this can
  -- never touch another session's data or any caller-controlled object.
  drop table if exists pg_temp.tmp_submit_items;
  create temporary table tmp_submit_items (
    cart_item_id uuid primary key,
    listing_id uuid not null,
    shop_id uuid not null,
    shop_owner_id uuid not null,
    shop_name text not null,
    quantity integer not null,
    cart_price_snapshot bigint not null,
    current_price bigint not null,
    available_quantity integer not null,
    listing_title text not null,
    listing_public_code text not null,
    cover_image_path text,
    is_orderable boolean not null,
    is_blocked boolean not null,
    matched_order_id uuid
  ) on commit drop;

  insert into tmp_submit_items (
    cart_item_id, listing_id, shop_id, shop_owner_id, shop_name, quantity,
    cart_price_snapshot, current_price, available_quantity, listing_title,
    listing_public_code, cover_image_path, is_orderable, is_blocked
  )
  select
    ci.id,
    l.id,
    s.id,
    s.owner_id,
    s.name,
    ci.quantity,
    ci.price_cents_snapshot,
    l.price_cents,
    l.available_quantity,
    l.title,
    l.public_code,
    img.storage_path,
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
    exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = v_caller_id and ub.blocked_id = s.owner_id)
         or (ub.blocker_id = s.owner_id and ub.blocked_id = v_caller_id)
    )
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    join public.listings l on l.id = ci.listing_id
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    left join public.listing_images img on img.id = l.cover_image_id
    where c.user_id = v_caller_id
      and ci.id = any(p_cart_item_ids);

  -- ===================== ownership/existence: every id must have matched =====================
  if (select count(*) from tmp_submit_items) <> (select count(distinct x) from unnest(p_cart_item_ids) x) then
    raise exception 'One or more selected cart items were not found.' using detail = 'CART_ITEM_NOT_FOUND';
  end if;

  -- ===================== listing eligibility (generic, non-revealing) =====================
  if exists (select 1 from tmp_submit_items t where not t.is_orderable) then
    raise exception 'One or more selected listings cannot be ordered.' using detail = 'LISTING_NOT_ORDERABLE';
  end if;

  -- ===================== own shop =====================
  if exists (select 1 from tmp_submit_items t where t.shop_owner_id = v_caller_id) then
    raise exception 'You cannot buy your own listing.' using detail = 'CANNOT_BUY_OWN_LISTING';
  end if;

  -- ===================== peer block =====================
  if exists (select 1 from tmp_submit_items t where t.is_blocked) then
    raise exception 'Interaction is blocked.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== quantity vs live availability (fail closed) =====================
  if exists (select 1 from tmp_submit_items t where t.quantity < 1 or t.quantity > t.available_quantity) then
    raise exception 'Requested quantity exceeds available stock.' using detail = 'QUANTITY_UNAVAILABLE';
  end if;

  -- ===================== price drift =====================
  if exists (select 1 from tmp_submit_items t where t.current_price <> t.cart_price_snapshot) then
    raise exception 'Price has changed since this item was added to cart.' using detail = 'PRICE_CHANGED';
  end if;

  -- ===================== buyer note normalization =====================
  v_buyer_note := nullif(btrim(p_buyer_note), '');
  if v_buyer_note is not null and char_length(v_buyer_note) > 1000 then
    raise exception 'Buyer note is too long.' using detail = 'SUBMISSION_INVALID';
  end if;

  -- ===================== fulfillment payload: structural, cast-safe validation =====================
  if p_fulfillment_choices is null or jsonb_typeof(p_fulfillment_choices) <> 'array' then
    raise exception 'Fulfillment choices must be a JSON array.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fulfillment_choices) as elem
    where jsonb_typeof(elem) <> 'object'
       or not (elem ? 'shop_id')
       or jsonb_typeof(elem -> 'shop_id') <> 'string'
       or (elem ->> 'shop_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not (elem ? 'method')
       or jsonb_typeof(elem -> 'method') <> 'string'
       or (elem ->> 'method') not in ('meetup', 'pickup', 'local_delivery', 'shipping')
  ) then
    raise exception 'Fulfillment choices contain an invalid entry.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if (select count(*) from jsonb_array_elements(p_fulfillment_choices)) <>
     (select count(distinct (elem ->> 'shop_id')) from jsonb_array_elements(p_fulfillment_choices) elem) then
    raise exception 'Duplicate fulfillment choice for the same shop.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- Same same-transaction-repeat-call reasoning as tmp_submit_items above.
  drop table if exists pg_temp.tmp_submit_shops;
  create temporary table tmp_submit_shops (
    shop_id uuid primary key,
    method public.fulfillment_method_enum not null,
    matched_order_id uuid,
    public_code text
  ) on commit drop;

  insert into tmp_submit_shops (shop_id, method)
  select (elem ->> 'shop_id')::uuid, (elem ->> 'method')::public.fulfillment_method_enum
    from jsonb_array_elements(p_fulfillment_choices) as elem;

  -- ===================== exact shop-set match =====================
  if exists (
    select 1 from tmp_submit_items t
    where not exists (select 1 from tmp_submit_shops f where f.shop_id = t.shop_id)
  ) then
    raise exception 'Missing fulfillment choice for a selected shop.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if exists (
    select 1 from tmp_submit_shops f
    where not exists (select 1 from tmp_submit_items t where t.shop_id = f.shop_id)
  ) then
    raise exception 'Fulfillment choice given for a shop not in the selection.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== per-shop listing compatibility =====================
  if exists (
    select 1
    from tmp_submit_items t
    join tmp_submit_shops f on f.shop_id = t.shop_id
    where not exists (
      select 1 from public.listing_fulfillment_methods lfm
      where lfm.listing_id = t.listing_id and lfm.method = f.method
    )
  ) then
    raise exception 'A selected listing does not support the chosen fulfillment method.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== all validation passed: create one order per shop =====================
  for r in select f.shop_id, f.method from tmp_submit_shops f loop
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_public_code := 'PSO-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
      begin
        insert into public.orders (public_code, buyer_id, shop_id, status, fulfillment_method, buyer_note)
        values (v_public_code, v_caller_id, r.shop_id, 'pending', r.method, v_buyer_note)
        returning id into v_new_order_id;
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name = 'orders_public_code_key' then
          if v_attempt >= 5 then
            raise exception 'Unable to generate a unique order code.' using detail = 'SUBMISSION_INVALID';
          end if;
        else
          raise;
        end if;
      end;
    end loop;

    update tmp_submit_shops set matched_order_id = v_new_order_id, public_code = v_public_code
      where tmp_submit_shops.shop_id = r.shop_id;
    update tmp_submit_items set matched_order_id = v_new_order_id
      where tmp_submit_items.shop_id = r.shop_id;
  end loop;

  -- ===================== order items: exactly one per selected cart item =====================
  insert into public.order_items (
    order_id, shop_id, listing_id, status, quantity,
    listing_title_snapshot, listing_public_code_snapshot, price_cents_snapshot,
    shop_name_snapshot, listing_cover_image_snapshot_path
  )
  select
    t.matched_order_id, t.shop_id, t.listing_id, 'pending', t.quantity,
    t.listing_title, t.listing_public_code, t.current_price,
    t.shop_name, t.cover_image_path
    from tmp_submit_items t;

  -- ===================== cart cleanup: only the selected, now-submitted rows =====================
  delete from public.cart_items ci
    where ci.id = any(p_cart_item_ids);

  -- ===================== one row per created order, deterministic order =====================
  return query
    select
      f.matched_order_id as order_id,
      f.shop_id,
      f.public_code as order_public_code,
      agg.item_count,
      agg.total_cents,
      'pending'::public.order_status_enum as status
    from tmp_submit_shops f
    join lateral (
      select count(*)::integer as item_count,
             sum(t.current_price * t.quantity)::bigint as total_cents
      from tmp_submit_items t
      where t.shop_id = f.shop_id
    ) agg on true
    order by f.shop_id;
end;
$$;

revoke all on function public.submit_cart_order(uuid[], jsonb, text) from public;
revoke all on function public.submit_cart_order(uuid[], jsonb, text) from anon;
grant execute on function public.submit_cart_order(uuid[], jsonb, text) to authenticated;

comment on function public.submit_cart_order(uuid[], jsonb, text) is
  'Converts selected cart_items into one pending order per distinct shop, with full live revalidation and no schema trust in caller input. Creates zero inventory_reservations and never mutates listings.reserved_quantity or listings.status -- accept_order_items remains the sole reservation point. Deletes only the successfully submitted cart rows, in the same transaction, only after every order and order_item has been created. Cart-row deletion on success is pragmatic MVP retry protection (an immediate retry with the same ids cleanly fails with CART_ITEM_NOT_FOUND rather than duplicating an order) -- it is not payment-grade idempotency; a future protected checkout/payment flow must introduce a real idempotency key.';
