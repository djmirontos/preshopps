-- Buy Now order submission: extracts the canonical order-creation/business-
-- rule logic that has lived inside submit_cart_order (0039, amended by 0040's
-- notification insert and 0083's enqueue_email call) into one shared,
-- non-client-callable core, so a brand-new submit_buy_now_order RPC can
-- create a real pending order for exactly one listing WITHOUT ever reading
-- or writing public.cart_items/public.carts. This replaces the rejected
-- frontend-only "temporary cart row" Buy Now approach, which could leave a
-- real cart_items row behind on a hard tab/browser close -- that approach is
-- not used anywhere from this migration forward.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Live submit_cart_order pulled via pg_get_functiondef and compared against
-- this repo's own migration history: 0039 is the original; 0040_notifications
-- added one `insert into public.notifications (...) on conflict on
-- constraint notifications_recipient_type_dedupe_key do nothing` per created
-- order (seller-facing order_request_received); 0083_transactional_email_
-- outbox added one `perform public.enqueue_email('new_order_request', ...)`
-- call immediately after that notification insert, inside the same per-shop
-- loop. The LIVE function is the 0083 version -- confirmed identical to what
-- 0083's own file contains, no further drift from 0084 through the latest
-- live migration (exact_unread_badge_counts). Both the notification insert
-- and the enqueue_email call are extracted into the shared core below
-- UNCHANGED, so a Buy Now order notifies/emails the seller exactly like a
-- cart-submitted order always has -- this is a real, live-verified business
-- behavior, not something invented for this migration.
--
-- Live signature/grants confirmed via has_function_privilege before writing
-- this file: submit_cart_order(uuid[], jsonb, text) -- SECURITY DEFINER,
-- search_path = '', EXECUTE revoked from anon, granted to authenticated
-- (and to service_role, and implicitly to its owner) -- exactly matching
-- 0039/0083's own grant statements, no drift. enqueue_email(...) -- SECURITY
-- DEFINER, search_path = '', EXECUTE revoked from anon/authenticated/
-- service_role, executable only by its owner -- confirmed live via
-- has_function_privilege for all four roles. This is the exact precedent
-- pattern this migration's own new create_orders_from_selection helper
-- copies (see PART 2 below), not a new invention.
--
-- What changed and what did not (locked design)
-- -----------------------------------------------------------------------
-- submit_cart_order's PUBLIC signature, result shape, SECURITY DEFINER
-- posture, search_path, and grants are UNCHANGED. Its own top section (auth/
-- deleted-profile/buyer-restriction guards, structural validation of
-- p_cart_item_ids, and the CART_ITEM_NOT_FOUND count-mismatch check) is kept
-- byte-for-byte in the same order it already runs in today -- this is a
-- deliberate, small, intentional exception to "avoid duplicating business
-- logic": these are auth/ownership BOILERPLATE guards (already independently
-- re-implemented in every RPC across this codebase, e.g. get_my_cart,
-- set_cart_item_quantity, merge_guest_cart, remove_favorite), not the
-- business RULES this task is about de-duplicating (self-purchase/block/
-- quantity/price/fulfillment/order-creation), and removing them here would
-- risk a subtle error-ordering regression for an already-shipped, already-
-- tested function (e.g. a restricted buyer submitting a structurally-invalid
-- cart_item_ids array must still see INTERACTION_BLOCKED, not a
-- CART_ITEM_NOT_FOUND that only exists because the wrapper's own resolution
-- ran before the shared core's own restriction check). The genuinely
-- complex, actually-drift-prone rules -- listing eligibility, self-purchase,
-- peer block, quantity-vs-live-stock, price-drift, fulfillment structural/
-- shop-set/per-listing validation, the per-shop order-creation loop with its
-- public_code collision retry, order_items creation, notification+email
-- side effects, and the final aggregated result projection -- move into the
-- shared core with ZERO logic changes, only renaming cart_price_snapshot to
-- the more general expected_price_cents (same PRICE_CHANGED comparison,
-- same order_items.price_cents_snapshot always taken from the CURRENT
-- listings.price_cents, never from expected_price_cents -- unchanged).
--
-- Item existence check generalization (the one genuinely new branch)
-- -----------------------------------------------------------------------
-- The core's tmp_submit_items population now joins directly against
-- listings on a caller-supplied listing_id (from either wrapper) instead of
-- joining through cart_items/carts. For the cart path this is unreachable in
-- practice exactly as before (cart_items.listing_id carries an ON DELETE
-- RESTRICT FK to listings, so a listing referenced by an existing cart row
-- can never fail to join) -- CART_ITEM_NOT_FOUND, checked entirely in the
-- wrapper before the core is ever called, remains the only "not found" this
-- path can surface. For Buy Now, a listing_id can legitimately fail to match
-- (stale page, though this schema never hard-deletes listings in practice --
-- defensive regardless); the core folds that into the same generic,
-- non-revealing LISTING_NOT_ORDERABLE code the eligibility check already
-- uses, rather than inventing a new error code with no meaningfully
-- different buyer-facing recovery action.
--
-- Buy Now's price-drift equivalent (no stored snapshot to compare against)
-- -----------------------------------------------------------------------
-- A cart row's price protection compares live listings.price_cents against
-- cart_items.price_cents_snapshot (captured whenever the row was last
-- written). Buy Now has no stored row at all, so submit_buy_now_order's own
-- p_expected_price_cents parameter -- the price the frontend most recently
-- displayed to the buyer -- takes that exact same role in the shared core's
-- one, unmodified price-drift branch. The canonical live listings.price_cents
-- remains authoritative either way; a mismatch is rejected with the existing
-- PRICE_CHANGED code, identically to today's cart behavior. The client-
-- supplied expected price is NEVER written to order_items -- that column is
-- always populated from the live price, exactly as before.
--
-- Ambiguity-bug re-audit (0021/0022/0037/0039 precedent): every table column
-- read throughout the new core is alias-qualified (item., l., s., cat.,
-- img., ur., ub., t., f., agg., r.), matching the exact style already
-- established. No ON CONFLICT target is read as a bare identifier anywhere
-- new (the one ON CONFLICT ON CONSTRAINT in the notification insert is
-- copied unchanged from the live function, where it was already safe). No
-- dynamic SQL anywhere.

-- ============================================================
-- PART 1/2 -- create_orders_from_selection: the shared canonical core.
--
-- p_items is a jsonb array of {"listing_id": "<uuid>", "quantity": N,
-- "expected_price_cents": N} -- the same "jsonb array of primitives, no
-- custom composite type" style already locked in by merge_guest_cart (0037)
-- and submit_cart_order's own p_fulfillment_choices, kept for consistency
-- rather than introducing a new type this codebase has never used for this
-- purpose.
--
-- Contains every canonical business rule submit_cart_order and
-- submit_buy_now_order must share identically: authenticated caller,
-- deleted/restricted account guards, listing eligibility, self-purchase
-- rejection, peer blocking, quantity vs live stock, expected-price/price-
-- drift validation, fulfillment validation, per-shop grouping, order
-- creation, order_item creation, totals, and the existing error codes --
-- all fully atomic (any single invalid item/price/fulfillment entry rejects
-- the entire call; zero orders/order_items are ever created on any
-- exception path, matching submit_cart_order's own locked atomicity).
--
-- SECURITY: never intended to be called directly by any client. Executed
-- only via `perform`/`select * from` inside the two SECURITY DEFINER public
-- wrappers below, which already run as this function's own owner regardless
-- of this function's own grants -- identical to enqueue_email's own
-- established, live-confirmed pattern (0083). EXECUTE is revoked from
-- PUBLIC, anon, authenticated, AND service_role; only the owning role (and
-- therefore any SECURITY DEFINER function it also owns) can ever invoke it.
-- auth.uid() is called directly inside this function, not trusted from a
-- caller-supplied parameter -- it resolves from the request.jwt.claims
-- session-level GUC Supabase's PostgREST layer sets for the connection,
-- which is unaffected by role-switching from a nested SECURITY DEFINER call
-- (empirically verified after this migration was applied -- see this task's
-- own report).
-- ============================================================
create or replace function public.create_orders_from_selection(
  p_items jsonb,
  p_fulfillment_choices jsonb,
  p_buyer_note text
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
  v_shop_owner_id uuid;
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

  -- ===================== structural validation of p_items =====================
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item must be selected.' using detail = 'SUBMISSION_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as elem
    where jsonb_typeof(elem) <> 'object'
       or not (elem ? 'listing_id')
       or jsonb_typeof(elem -> 'listing_id') <> 'string'
       or (elem ->> 'listing_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not (elem ? 'quantity')
       or jsonb_typeof(elem -> 'quantity') <> 'number'
       or (elem ->> 'quantity') !~ '^[1-9][0-9]*$'
       or not (elem ? 'expected_price_cents')
       or jsonb_typeof(elem -> 'expected_price_cents') <> 'number'
       or (elem ->> 'expected_price_cents') !~ '^[0-9]+$'
  ) then
    raise exception 'Selected items contain an invalid entry.' using detail = 'SUBMISSION_INVALID';
  end if;

  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct (elem ->> 'listing_id')) from jsonb_array_elements(p_items) elem) then
    raise exception 'Duplicate listing in selection.' using detail = 'SUBMISSION_INVALID';
  end if;

  -- ===================== materialize selected items with live state =====================
  -- Joins directly on listing_id -- never through cart_items/carts. Both
  -- callers (cart-resolved or Buy Now-direct) hand this function the exact
  -- same shape, so this is the one place eligibility/self-purchase/block are
  -- ever computed.
  drop table if exists pg_temp.tmp_submit_items;
  create temporary table tmp_submit_items (
    listing_id uuid primary key,
    shop_id uuid not null,
    shop_owner_id uuid not null,
    shop_name text not null,
    quantity integer not null,
    expected_price_cents bigint not null,
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
    listing_id, shop_id, shop_owner_id, shop_name, quantity, expected_price_cents,
    current_price, available_quantity, listing_title, listing_public_code, cover_image_path,
    is_orderable, is_blocked
  )
  select
    item.listing_id,
    s.id,
    s.owner_id,
    s.name,
    item.quantity,
    item.expected_price_cents,
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
    from (
      select
        (elem ->> 'listing_id')::uuid as listing_id,
        (elem ->> 'quantity')::integer as quantity,
        (elem ->> 'expected_price_cents')::bigint as expected_price_cents
      from jsonb_array_elements(p_items) as elem
    ) item
    join public.listings l on l.id = item.listing_id
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    left join public.listing_images img on img.id = l.cover_image_id;

  -- ===================== existence: every requested listing_id must have matched =====================
  -- Unreachable in practice for the cart-sourced path (cart_items.listing_id
  -- carries an ON DELETE RESTRICT FK to listings), meaningful for Buy Now's
  -- direct listing_id input -- folded into the same generic, non-revealing
  -- LISTING_NOT_ORDERABLE code the eligibility check below already uses.
  if (select count(*) from tmp_submit_items) <> jsonb_array_length(p_items) then
    raise exception 'One or more selected listings could not be ordered.' using detail = 'LISTING_NOT_ORDERABLE';
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
  -- expected_price_cents plays the exact role cart_items.price_cents_snapshot
  -- played before this extraction -- for the cart wrapper it IS that same
  -- stored snapshot value, passed through unchanged; for Buy Now it is the
  -- price the frontend most recently displayed. Either way the canonical
  -- live listings.price_cents (current_price) is what actually gets written
  -- to order_items below, never the expected/snapshot value.
  if exists (select 1 from tmp_submit_items t where t.current_price <> t.expected_price_cents) then
    raise exception 'Price has changed since this item was selected.' using detail = 'PRICE_CHANGED';
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

    -- ===================== notification: seller receives one per created order =====================
    select s.owner_id into v_shop_owner_id
      from public.shops s
      where s.id = r.shop_id;

    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select v_shop_owner_id, 'order_request_received', v_caller_id, v_new_order_id, v_new_order_id::text
    where not exists (
      select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

    -- ===================== email: seller receives the new order request =====================
    perform public.enqueue_email(
      'new_order_request'::public.email_event_type_enum,
      v_shop_owner_id,
      v_new_order_id,
      jsonb_build_object('order_public_code', v_public_code)
    );

    update tmp_submit_shops set matched_order_id = v_new_order_id, public_code = v_public_code
      where tmp_submit_shops.shop_id = r.shop_id;
    update tmp_submit_items set matched_order_id = v_new_order_id
      where tmp_submit_items.shop_id = r.shop_id;
  end loop;

  -- ===================== order items: exactly one per selected item =====================
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

revoke all on function public.create_orders_from_selection(jsonb, jsonb, text) from public;
revoke all on function public.create_orders_from_selection(jsonb, jsonb, text) from anon;
revoke all on function public.create_orders_from_selection(jsonb, jsonb, text) from authenticated;
revoke all on function public.create_orders_from_selection(jsonb, jsonb, text) from service_role;

comment on function public.create_orders_from_selection(jsonb, jsonb, text) is
  'Shared canonical order-creation core for submit_cart_order and submit_buy_now_order. Never granted to any client-facing role -- callable only via a nested SECURITY DEFINER call from those two wrappers, which already run as this function''s own owner. Do not grant EXECUTE on this function to anon/authenticated/service_role.';

-- ============================================================
-- PART 3 -- submit_cart_order: same public signature, same result shape,
-- same SECURITY DEFINER/search_path/grants, same error semantics. Its own
-- top section (auth/profile/restriction guards, structural p_cart_item_ids
-- validation, and the CART_ITEM_NOT_FOUND resolution) is unchanged from the
-- live function; everything from listing eligibility onward now happens
-- inside create_orders_from_selection. Deletes ONLY the submitted cart rows,
-- and only after the shared core has already fully succeeded (a RETURN
-- QUERY statement executes its query immediately -- if the core raises, this
-- function never reaches the DELETE below, preserving the exact same
-- all-or-nothing atomicity as before).
-- ============================================================
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
  v_items jsonb;
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

  -- ===================== resolve the caller's own cart rows only =====================
  -- Leaner than the pre-extraction tmp_submit_items -- carries only what
  -- create_orders_from_selection needs as input (listing_id, quantity,
  -- expected_price_cents = the cart's own stored snapshot). Eligibility/
  -- self-purchase/block are no longer computed here at all.
  drop table if exists pg_temp.tmp_cart_resolved;
  create temporary table tmp_cart_resolved (
    cart_item_id uuid primary key,
    listing_id uuid not null,
    quantity integer not null,
    expected_price_cents bigint not null
  ) on commit drop;

  insert into tmp_cart_resolved (cart_item_id, listing_id, quantity, expected_price_cents)
  select ci.id, ci.listing_id, ci.quantity, ci.price_cents_snapshot
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where c.user_id = v_caller_id
      and ci.id = any(p_cart_item_ids);

  -- ===================== ownership/existence: every id must have matched =====================
  if (select count(*) from tmp_cart_resolved) <> (select count(distinct x) from unnest(p_cart_item_ids) x) then
    raise exception 'One or more selected cart items were not found.' using detail = 'CART_ITEM_NOT_FOUND';
  end if;

  select jsonb_agg(jsonb_build_object(
    'listing_id', t.listing_id,
    'quantity', t.quantity,
    'expected_price_cents', t.expected_price_cents
  )) into v_items
  from tmp_cart_resolved t;

  -- ===================== canonical core: eligibility through order creation =====================
  return query
    select * from public.create_orders_from_selection(v_items, p_fulfillment_choices, p_buyer_note);

  -- ===================== cart cleanup: only the selected, now-submitted rows =====================
  -- Reached only if the core succeeded (see this function's own header) --
  -- unchanged behavior from before this extraction.
  delete from public.cart_items ci
    where ci.id = any(p_cart_item_ids);
end;
$$;

revoke all on function public.submit_cart_order(uuid[], jsonb, text) from public;
revoke all on function public.submit_cart_order(uuid[], jsonb, text) from anon;
grant execute on function public.submit_cart_order(uuid[], jsonb, text) to authenticated;

comment on function public.submit_cart_order(uuid[], jsonb, text) is
  'Converts selected cart_items into one pending order per distinct shop. Resolves the caller''s own cart rows, then delegates eligibility/self-purchase/block/quantity/price/fulfillment validation and order creation to the shared public.create_orders_from_selection core (also used by submit_buy_now_order) so the two paths can never diverge. Creates zero inventory_reservations and never mutates listings.reserved_quantity or listings.status -- accept_order_items remains the sole reservation point. Deletes only the successfully submitted cart rows, in the same transaction, only after the shared core has already succeeded.';

-- ============================================================
-- PART 4 -- submit_buy_now_order: new, authenticated-only. Submits exactly
-- one listing/quantity through the SAME shared core, with no cart_items/
-- carts reference anywhere in this function -- the buyer's persistent cart
-- is structurally unreachable from this code path, not merely left alone by
-- convention. Stock is not reserved here any more than it is by
-- submit_cart_order -- create_orders_from_selection never reserves
-- inventory; accept_order_items remains the sole reservation point,
-- untouched by this migration.
-- ============================================================
create or replace function public.submit_buy_now_order(
  p_listing_id uuid,
  p_quantity integer,
  p_fulfillment_method public.fulfillment_method_enum,
  p_expected_price_cents bigint,
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
  v_shop_id uuid;
  v_items jsonb;
  v_fulfillment_choices jsonb;
begin
  if p_listing_id is null then
    raise exception 'A listing must be selected.' using detail = 'SUBMISSION_INVALID';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.' using detail = 'SUBMISSION_INVALID';
  end if;

  if p_expected_price_cents is null or p_expected_price_cents < 0 then
    raise exception 'Expected price is invalid.' using detail = 'SUBMISSION_INVALID';
  end if;

  if p_fulfillment_method is null then
    raise exception 'A fulfillment method must be selected.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- Read-only lookup, needed only to key the fulfillment-choice payload the
  -- shared core already expects (one method per shop_id) -- never a
  -- cart_items/carts reference, and never itself an eligibility decision:
  -- create_orders_from_selection independently re-derives and authoritatively
  -- checks every eligibility fact (status/category/suspension/self-purchase/
  -- block/quantity/price) from live listings/shops data regardless of what
  -- is passed in here.
  select l.shop_id into v_shop_id
    from public.listings l
    where l.id = p_listing_id;

  if v_shop_id is null then
    raise exception 'Listing cannot be ordered.' using detail = 'LISTING_NOT_ORDERABLE';
  end if;

  v_items := jsonb_build_array(
    jsonb_build_object(
      'listing_id', p_listing_id,
      'quantity', p_quantity,
      'expected_price_cents', p_expected_price_cents
    )
  );

  v_fulfillment_choices := jsonb_build_array(
    jsonb_build_object('shop_id', v_shop_id, 'method', p_fulfillment_method)
  );

  return query
    select * from public.create_orders_from_selection(v_items, v_fulfillment_choices, p_buyer_note);
end;
$$;

revoke all on function public.submit_buy_now_order(uuid, integer, public.fulfillment_method_enum, bigint, text) from public;
revoke all on function public.submit_buy_now_order(uuid, integer, public.fulfillment_method_enum, bigint, text) from anon;
grant execute on function public.submit_buy_now_order(uuid, integer, public.fulfillment_method_enum, bigint, text) to authenticated;

comment on function public.submit_buy_now_order(uuid, integer, public.fulfillment_method_enum, bigint, text) is
  'Buy Now: submits exactly one listing/quantity as a pending order via the shared public.create_orders_from_selection core -- the same eligibility/self-purchase/block/quantity/price/fulfillment validation and order-creation logic submit_cart_order uses. Never reads or writes public.cart_items/public.carts. Creates zero inventory_reservations; accept_order_items remains the sole reservation point.';
