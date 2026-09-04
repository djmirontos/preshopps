-- Hotfix for a live defect verified in 0037_favorites_cart_rls_and_rpcs:
-- both public.set_cart_item_quantity and public.merge_guest_cart raise
-- SQLSTATE 42702 ("column reference \"listing_id\" is ambiguous") on every
-- call that reaches their cart_items upsert, because
--   on conflict (cart_id, listing_id)
-- is a bare, unqualifiable column-name list, and "listing_id" also happens
-- to be the name of an output column in each function's own RETURNS TABLE
-- -- the same ambiguity class previously fixed in 0022, just in a spot
-- (the ON CONFLICT conflict-target) that table-qualification (ci.listing_id)
-- cannot reach, since Postgres does not permit an alias-qualified column in
-- a conflict-target list.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0037_favorites_cart_rls_and_rpcs; this is the
-- next migration, no drift. Confirmed live via pg_get_functiondef that both
-- set_cart_item_quantity(uuid, integer) and merge_guest_cart(jsonb)
-- currently contain exactly "on conflict (cart_id, listing_id)" on their
-- respective cart_items upsert, and are otherwise unchanged from the 0037
-- source. Confirmed public.cart_items carries exactly one relevant unique
-- constraint, cart_items_cart_id_listing_id_key, defined as
-- UNIQUE (cart_id, listing_id) -- an exact structural match for the
-- existing conflict target, so referencing it by name changes no behavior:
-- the same rows conflict, the same DO UPDATE fires, only the ambiguous
-- identifier is removed. No other unique constraint on cart_items exists
-- that could conflict with this repair. Object counts confirmed unchanged
-- from the 0037 baseline (tables=31, indexes=85, triggers=10, enums=16,
-- policies=14, functions=31).
--
-- Fix: replace the bare column-list conflict target with a reference to the
-- constraint by name in both functions' cart_items upsert:
--   on conflict (cart_id, listing_id)
--     -> on conflict on constraint cart_items_cart_id_listing_id_key
-- This is the only semantic change in this migration. Every other line of
-- both function bodies -- validation order and logic, error codes and
-- messages, the INSERT ... VALUES list, the DO UPDATE SET assignments,
-- quantity/price-snapshot semantics, the RETURNS TABLE shape, security
-- attributes, and grants -- is byte-for-byte identical to the live 0037
-- definitions. No table, policy, index, enum, or trigger is created or
-- altered. get_my_cart, remove_cart_item, add_favorite, remove_favorite,
-- get_my_favorites, favorites_select_own, listing_metrics, and the order
-- engine are untouched by this migration.

-- ============================================================
-- set_cart_item_quantity (conflict-target repair only)
-- ============================================================
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
    on conflict on constraint cart_items_cart_id_listing_id_key do update
      set quantity = excluded.quantity,
          price_cents_snapshot = excluded.price_cents_snapshot
    returning ci.id as cart_item_id, ci.listing_id, ci.quantity, ci.price_cents_snapshot;
end;
$$;

revoke all on function public.set_cart_item_quantity(uuid, integer) from public;
revoke all on function public.set_cart_item_quantity(uuid, integer) from anon;
grant execute on function public.set_cart_item_quantity(uuid, integer) to authenticated;

-- ============================================================
-- merge_guest_cart (conflict-target repair only)
-- ============================================================
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
        on conflict on constraint cart_items_cart_id_listing_id_key do update
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
