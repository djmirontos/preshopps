-- Published listing editing foundation. Repository-local until reviewed/applied.
-- 0086 is permanently skipped. Existing order history is never backfilled.
-- All seller writes serialize on listings; never lock reservation rows after it.
-- Storage objects are immutable for clients; gallery detach retains the object.

alter table public.listings add column revision bigint not null default 0;
alter table public.order_items
  add column listing_type_snapshot public.listing_type_enum,
  add column listing_condition_snapshot public.listing_condition_enum;

-- These five tables already have RLS enabled with no client write policies live.
-- Earlier repository DDL does not reproduce that setting on a fresh database.
-- Make the trusted-RPC boundary explicit and reproducible here.
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.listing_fulfillment_methods enable row level security;
alter table public.listing_vehicle_details enable row level security;
alter table public.listing_rental_details enable row level security;

comment on column public.listings.revision is
  'Optimistic concurrency token; return as decimal text to JavaScript. Drafts remain at zero until publication.';
comment on column public.order_items.listing_type_snapshot is
  'Order-time type for new orders; NULL means unknown historical value. Never backfill from a mutable listing.';
comment on column public.order_items.listing_condition_snapshot is
  'Order-time condition for new orders; NULL means unknown historical value. Never backfill from a mutable listing.';

create or replace function public.guard_listing_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Seller identity fields are protected by the published-edit RPC allowlist
  -- and RLS. Trusted maintenance must retain the ability to correct them.
  if old.published_at is not null or new.published_at is not null
     or old.status in ('available', 'paused', 'reserved', 'sold') then
    -- The only explicit bump is the trusted RPC's child-only mutation. Parent
    -- changes and that bump are coalesced, not added together. RLS denies direct
    -- seller writes and no public patch accepts revision.
    if (pg_catalog.to_jsonb(new) - array['revision', 'updated_at', 'available_quantity'])
       is distinct from (pg_catalog.to_jsonb(old) - array['revision', 'updated_at', 'available_quantity'])
       or new.revision is distinct from old.revision then
      new.revision := old.revision + 1;
    else
      new.revision := old.revision;
    end if;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_listing_revision() from public, anon, authenticated, service_role;
create trigger guard_listing_revision before update on public.listings
for each row execute function public.guard_listing_revision();

-- No client overwrite, move, or physical deletion in this bucket. INSERT/read
-- policies from 0048 remain unchanged; other buckets are unaffected. Failed
-- draft cleanup attempts are best effort and leave accepted temporary orphans.
drop policy listing_images_update_own on storage.objects;
drop policy listing_images_delete_own on storage.objects;

-- Shared validator, publish/status replacements, and order core follow below.

-- Caller holds the listing lock. Detailed existing publish codes are preserved;
-- update_published_listing maps these to its smaller stable public contract.
create or replace function public.validate_published_listing(p_listing_id uuid, p_allow_zero boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_title text; v_description text; v_category_id integer;
  v_listing_type public.listing_type_enum; v_condition public.listing_condition_enum;
  v_known_flaws text; v_price_cents bigint; v_stock_quantity integer;
  v_province_id integer; v_city_id integer; v_category_is_inquiry_only boolean;
  v_fulfillment_count integer; v_actual_image_count integer;
  v_reference_image_count integer; v_total_image_count integer;
  v_listing public.listings%rowtype; v_category_slug text; v_owner uuid;
begin
  select l.* into strict v_listing from public.listings l where l.id = p_listing_id;
  v_title := v_listing.title; v_description := v_listing.description;
  v_category_id := v_listing.category_id; v_listing_type := v_listing.listing_type;
  v_condition := v_listing.condition; v_known_flaws := v_listing.known_flaws;
  v_price_cents := v_listing.price_cents;
  v_stock_quantity := v_listing.available_quantity;
  v_province_id := v_listing.province_id; v_city_id := v_listing.city_id;
  -- ===================== title (defensive -- structurally already guaranteed non-blank) =====================
  if v_title is null or v_title !~ '[^[:space:]]' then
    raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
  end if;

  -- ===================== description =====================
  if v_description is null then
    raise exception 'Listing description is required to publish.' using detail = 'DESCRIPTION_REQUIRED';
  end if;

  -- ===================== category =====================
  if v_category_id is null then
    raise exception 'Category is required to publish.' using detail = 'CATEGORY_REQUIRED';
  end if;

  select c.is_inquiry_only into v_category_is_inquiry_only
    from public.categories c
    where c.id = v_category_id;

  -- ===================== listing type / condition =====================
  if v_listing_type is null then
    raise exception 'Listing type is required to publish.' using detail = 'LISTING_TYPE_REQUIRED';
  end if;

  if v_condition is null then
    raise exception 'Condition is required to publish.' using detail = 'CONDITION_REQUIRED';
  end if;

  if v_listing_type = 'brand_new' and v_condition <> 'brand_new' then
    raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
  end if;

  if v_listing_type = 'preloved' and v_condition = 'brand_new' then
    raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
  end if;

  -- ===================== known flaws (required for Fair) =====================
  if v_condition = 'fair' and (v_known_flaws is null or v_known_flaws !~ '[^[:space:]]') then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price (>= 0 already guaranteed by listings_price_cents_check; only null-checked here) =====================
  if v_price_cents is null then
    raise exception 'Price is required to publish.' using detail = 'PRICE_REQUIRED';
  end if;

  -- ===================== stock quantity (defensive -- structurally already guaranteed >= 1) =====================
  if v_stock_quantity is null or v_stock_quantity < (case when p_allow_zero then 0 else 1 end) then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location =====================
  if v_province_id is null then
    raise exception 'Province is required to publish.' using detail = 'PROVINCE_REQUIRED';
  end if;

  if v_city_id is null then
    raise exception 'City/municipality is required to publish.' using detail = 'CITY_REQUIRED';
  end if;

  -- ===================== fulfillment methods (required unless the category is inquiry-only) =====================
  select count(*) into v_fulfillment_count
    from public.listing_fulfillment_methods lfm
    where lfm.listing_id = p_listing_id;

  if not coalesce(v_category_is_inquiry_only, false) and v_fulfillment_count = 0 then
    raise exception 'At least one fulfillment method is required to publish.' using detail = 'FULFILLMENT_REQUIRED';
  end if;

  -- ===================== images: 1-8 total, plus Pre-loved/Brand-New actual-vs-reference rules =====================
  select
    count(*) filter (where not li.is_reference_image),
    count(*) filter (where li.is_reference_image),
    count(*)
    into v_actual_image_count, v_reference_image_count, v_total_image_count
    from public.listing_images li
    where li.listing_id = p_listing_id;

  if v_total_image_count = 0 then
    raise exception 'At least one photo is required to publish.' using detail = 'IMAGE_REQUIRED';
  end if;

  if v_total_image_count > 8 then
    raise exception 'A listing may have at most 8 photos.' using detail = 'TOO_MANY_LISTING_IMAGES';
  end if;

  if v_listing_type = 'preloved' and v_reference_image_count > 0 then
    raise exception 'Pre-loved listings may only include actual-item photos.' using detail = 'REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED';
  end if;

  if v_listing_type = 'brand_new' and v_actual_image_count = 0 then
    raise exception 'Brand New listings require at least one actual-item photo.' using detail = 'BRAND_NEW_REQUIRES_ACTUAL_IMAGE';
  end if;


  if v_description !~ '[^[:space:]]' or v_price_cents < 0
     or v_listing.original_price_cents < 0 or v_listing.original_price_cents < v_price_cents
     or not exists (select 1 from public.categories c where c.id = v_category_id)
     or not exists (select 1 from public.cities_municipalities c where c.id = v_city_id and c.province_id = v_province_id)
     or (v_listing.barangay_id is not null and not exists (
       select 1 from public.barangays b where b.id = v_listing.barangay_id and b.city_id = v_city_id)) then
    raise exception 'Complete the required listing information.' using detail = 'INVALID_PUBLISHED_LISTING';
  end if;
  select c.slug into v_category_slug from public.categories c where c.id = v_category_id;
  if (v_category_slug not in ('cars', 'motorcycles') and exists (
        select 1 from public.listing_vehicle_details v where v.listing_id = p_listing_id))
     or (v_category_slug <> 'for-rent' and exists (
        select 1 from public.listing_rental_details r where r.listing_id = p_listing_id)) then
    raise exception 'Details do not match this category.' using detail = 'INVALID_PUBLISHED_LISTING';
  end if;
  select s.owner_id into v_owner from public.shops s where s.id = v_listing.shop_id;
  if v_listing.cover_image_id is null or not exists (
      select 1 from public.listing_images li where li.id = v_listing.cover_image_id and li.listing_id = p_listing_id)
     or exists (
       select 1 from public.listing_images li where li.listing_id = p_listing_id and (
         li.storage_path !~ ('^listing-images/' || v_owner::text || '/' || p_listing_id::text || '/[^/]+$')
         or not exists (select 1 from storage.objects o where o.bucket_id = 'listing-images'
           and o.name = pg_catalog.substr(li.storage_path, 16) and o.owner_id = v_owner::text)))
     or (select count(distinct li.storage_path) from public.listing_images li where li.listing_id = p_listing_id) <> v_total_image_count then
    raise exception 'Choose valid uploaded listing photos and a cover.' using detail = 'INVALID_IMAGE_STATE';
  end if;
end;
$$;
revoke all on function public.validate_published_listing(uuid, boolean) from public, anon, authenticated, service_role;

create or replace function public.publish_listing(p_listing_id uuid)
returns table(listing_id uuid, public_code text, slug text, status listing_status_enum, published_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_listing_status public.listing_status_enum;
  v_seller_policies_accepted_at timestamptz;
  v_title text;
  v_description text;
  v_category_id integer;
  v_category_is_inquiry_only boolean;
  v_listing_type public.listing_type_enum;
  v_condition public.listing_condition_enum;
  v_known_flaws text;
  v_price_cents bigint;
  v_stock_quantity integer;
  v_province_id integer;
  v_city_id integer;
  v_public_code text;
  v_slug text;
  v_fulfillment_count integer;
  v_actual_image_count integer;
  v_reference_image_count integer;
  v_total_image_count integer;
  v_now timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions (existing check, unchanged, defense-in-depth) =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to publish listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.shop_id, l.status, l.title, l.description, l.category_id, l.listing_type, l.condition,
         l.known_flaws, l.price_cents, l.stock_quantity, l.province_id, l.city_id,
         l.public_code, l.slug
    into v_listing_shop_id, v_listing_status, v_title, v_description, v_category_id, v_listing_type, v_condition,
         v_known_flaws, v_price_cents, v_stock_quantity, v_province_id, v_city_id,
         v_public_code, v_slug
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to publish this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be published.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  -- ===================== seller policy acceptance (PRD 5.5) -- checked on every publish call =====================
  select p.seller_policies_accepted_at into v_seller_policies_accepted_at
    from public.profiles p
    where p.id = v_caller;

  if v_seller_policies_accepted_at is null then
    raise exception 'You must accept the Marketplace Rules and Prohibited Items Policy before publishing.' using detail = 'SELLER_POLICIES_NOT_ACCEPTED';
  end if;

  perform public.validate_published_listing(p_listing_id, false);

  -- ===================== transition: draft -> available =====================
  v_now := now();

  update public.listings as l
    set status = 'available',
        published_at = v_now
    where l.id = p_listing_id;

  return query
    select p_listing_id, v_public_code, v_slug, 'available'::public.listing_status_enum, v_now;
end;
$$;

create or replace function public.update_listing_status(p_listing_id uuid, p_status listing_status_enum)
returns table(listing_id uuid, status listing_status_enum, was_already_in_status boolean, updated_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_current_status public.listing_status_enum;
  v_reserved_quantity integer;
  v_updated_at timestamptz;
  v_allowed boolean;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to manage listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if p_status is null or p_status not in ('available', 'paused', 'sold', 'archived') then
    raise exception 'That status cannot be set directly.' using detail = 'TARGET_STATUS_NOT_ALLOWED';
  end if;

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

  if v_current_status = p_status then
    return query
      select p_listing_id, v_current_status, true, v_updated_at;
    return;
  end if;

  if v_reserved_quantity > 0 then
    raise exception 'This listing has an active order reservation and cannot be changed right now.' using detail = 'LISTING_HAS_ACTIVE_RESERVATION';
  end if;

  v_allowed := (
    (v_current_status = 'draft' and p_status = 'archived')
    or (v_current_status = 'available' and p_status in ('paused', 'sold', 'archived'))
    or (v_current_status = 'paused' and p_status in ('available', 'sold', 'archived'))
    or (v_current_status = 'sold' and p_status = 'archived')
  );

  if not v_allowed then
    raise exception 'That status change is not allowed.' using detail = 'INVALID_STATUS_TRANSITION';
  end if;

  if v_current_status = 'paused' and p_status = 'available' then
    perform public.validate_published_listing(p_listing_id, false);
  end if;

  update public.listings as l
    set status = p_status,
        archived_at = case when p_status = 'archived' then now() else l.archived_at end
    where l.id = p_listing_id
    returning l.updated_at into v_updated_at;

  return query
    select p_listing_id, p_status, false, v_updated_at;
end;
$$;

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

  -- Lock every selected listing in UUID order BEFORE reading any terms.
  -- No order/reservation row locks are acquired after these listing locks.
  for r in select (elem ->> 'listing_id')::uuid as listing_id
      from jsonb_array_elements(p_items) elem order by (elem ->> 'listing_id')::uuid loop
    perform 1 from public.listings l where l.id = r.listing_id for update;
  end loop;

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
    listing_type public.listing_type_enum,
    listing_condition public.listing_condition_enum,
    listing_title text not null,
    listing_public_code text not null,
    cover_image_path text,
    is_orderable boolean not null,
    is_blocked boolean not null,
    matched_order_id uuid
  ) on commit drop;

  insert into tmp_submit_items (
    listing_id, shop_id, shop_owner_id, shop_name, quantity, expected_price_cents,
    current_price, available_quantity, listing_type, listing_condition, listing_title, listing_public_code, cover_image_path,
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
    l.listing_type,
    l.condition,
    l.title,
    l.public_code,
    img.storage_path,
    (
      l.status = 'available'
      and l.listing_type is not null and l.condition is not null
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
  for r in select f.shop_id, f.method from tmp_submit_shops f order by f.shop_id loop
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
    shop_name_snapshot, listing_cover_image_snapshot_path, listing_type_snapshot, listing_condition_snapshot
  )
  select
    t.matched_order_id, t.shop_id, t.listing_id, 'pending', t.quantity,
    t.listing_title, t.listing_public_code, t.current_price,
    t.shop_name, t.cover_image_path, t.listing_type, t.listing_condition
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

revoke all on function public.publish_listing(uuid) from public, anon;
grant execute on function public.publish_listing(uuid) to authenticated;
revoke all on function public.update_listing_status(uuid, public.listing_status_enum) from public, anon;
grant execute on function public.update_listing_status(uuid, public.listing_status_enum) to authenticated;
revoke all on function public.create_orders_from_selection(jsonb, jsonb, text) from public, anon, authenticated, service_role;

-- Coherent owner-only editor projection; preserve the old get_my_listing ABI.
create or replace function public.get_published_listing_edit_state(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_result jsonb;
begin
  if v_caller is null then
    raise exception 'Sign in to edit your listing.' using detail = 'NOT_AUTHENTICATED';
  end if;
  select l.* into v_listing from public.listings l where l.id = p_listing_id for share;
  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;
  if not exists (select 1 from public.shops s where s.id = v_listing.shop_id and s.owner_id = v_caller) then
    raise exception 'You cannot edit this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_caller and p.deleted_at is null)
     or exists (select 1 from public.user_restrictions ur where ur.user_id = v_caller
       and ur.lifted_at is null and ur.restriction_type in ('seller_suspended', 'account_suspended')) then
    raise exception 'You cannot edit listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if v_listing.status not in ('available', 'paused') then
    raise exception 'This listing is not editable.' using detail = 'LISTING_NOT_EDITABLE';
  end if;
  select to_jsonb(g) into v_result from public.get_my_listing(p_listing_id) g;
  return v_result || jsonb_build_object(
    'revision', v_listing.revision::text, 'available_quantity', v_listing.available_quantity,
    'reserved_quantity', v_listing.reserved_quantity, 'cover_image_id', v_listing.cover_image_id,
    'quantity_editable', v_listing.reserved_quantity = 0 and not exists (
      select 1 from public.inventory_reservations ir where ir.listing_id = p_listing_id and ir.status = 'active'));
end;
$$;
revoke all on function public.get_published_listing_edit_state(uuid) from public, anon;
grant execute on function public.get_published_listing_edit_state(uuid) to authenticated;

-- p_images: NULL = unchanged; otherwise complete ordered array, each element:
-- {image_id: uuid, is_reference_image: boolean, is_cover: boolean}, OR
-- {storage_path: bucket-prefixed path, is_reference_image: boolean, is_cover: boolean}.
-- Exactly one cover. Existing IDs survive reorder; paths never change in place.
-- Nested extension objects are patches; JSON null removes the optional extension.
create or replace function public.update_published_listing(
  p_listing_id uuid,
  p_expected_revision bigint,
  p_patch jsonb,
  p_images jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_shop_id uuid;
  v_old public.listings%rowtype;
  v_new public.listings%rowtype;
  v_vehicle public.listing_vehicle_details%rowtype;
  v_rental public.listing_rental_details%rowtype;
  v_key text; v_value jsonb; v_detail jsonb; v_entry jsonb;
  v_before jsonb; v_after jsonb;
  v_methods public.fulfillment_method_enum[];
  v_old_methods public.fulfillment_method_enum[];
  v_ids uuid[] := '{}'; v_paths text[] := '{}'; v_flags boolean[] := '{}';
  v_image_id uuid; v_path text; v_cover uuid; v_cover_count integer := 0;
  v_stage_positions integer[]; v_stage_index integer; v_existing_image record;
  v_image_changed boolean := false; v_child_changed boolean := false;
  v_changed boolean; v_quantity bigint; v_i integer; v_code text;
  v_allowed constant text[] := array['title','description','price_cents','original_price_cents',
    'is_negotiable','brand','known_flaws','province_id','city_id','barangay_id',
    'fulfillment_methods','meetup_note','vehicle_details','rental_details','available_quantity'];
  v_protected constant text[] := array['id','listing_id','category_id','listing_type','condition','status',
    'stock_quantity','reserved_quantity','revision','owner_id','user_id','shop_id','public_code','slug',
    'cover_image_id','created_at','updated_at','published_at','archived_at'];
begin
  if v_caller is null then
    raise exception 'Sign in to edit your listing.' using detail = 'NOT_AUTHENTICATED';
  end if;
  select s.id into v_shop_id from public.shops s where s.owner_id = v_caller;
  select l.* into v_old from public.listings l where l.id = p_listing_id for update;
  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;
  if v_shop_id is null or v_old.shop_id <> v_shop_id then
    raise exception 'You cannot edit this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_caller and p.deleted_at is null)
     or exists (select 1 from public.user_restrictions ur where ur.user_id = v_caller
       and ur.lifted_at is null and ur.restriction_type in ('seller_suspended', 'account_suspended')) then
    raise exception 'You cannot edit listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if v_old.status not in ('available', 'paused') then
    raise exception 'This listing is not editable.' using detail = 'LISTING_NOT_EDITABLE';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_old.revision then
    raise exception 'This listing has changed. Reload before saving.' using detail = 'STALE_LISTING_REVISION';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Check the listing information.' using detail = 'INVALID_PUBLISHED_LISTING';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_patch) loop
    if v_key = any(v_protected) then
      raise exception 'This field cannot be edited.' using detail = 'PROTECTED_FIELD';
    end if;
    if not v_key = any(v_allowed) then
      raise exception 'An unsupported field was submitted.' using detail = 'UNKNOWN_FIELD';
    end if;
    if v_key in ('title','description','brand','known_flaws','meetup_note') then
      if jsonb_typeof(v_value) not in ('string','null') then
        raise exception 'Check the listing information.' using detail = 'INVALID_PUBLISHED_LISTING';
      end if;
    elsif v_key in ('price_cents','original_price_cents','province_id','city_id','barangay_id','available_quantity') then
      if v_value <> 'null'::jsonb and (jsonb_typeof(v_value) <> 'number' or v_value::text !~ '^[0-9]+$') then
        raise exception 'Use valid whole numbers.' using detail = 'INVALID_PUBLISHED_LISTING';
      end if;
    elsif v_key = 'is_negotiable' and jsonb_typeof(v_value) <> 'boolean' then
      raise exception 'Check the negotiable setting.' using detail = 'INVALID_PUBLISHED_LISTING';
    end if;
  end loop;

  v_new := jsonb_populate_record(v_old, p_patch - array['fulfillment_methods','vehicle_details','rental_details','available_quantity']);
  if p_patch ? 'title' then v_new.title := nullif(btrim(v_new.title), ''); end if;
  if p_patch ? 'description' then v_new.description := nullif(btrim(v_new.description), ''); end if;
  if p_patch ? 'brand' then v_new.brand := nullif(btrim(v_new.brand), ''); end if;
  if p_patch ? 'known_flaws' then v_new.known_flaws := nullif(btrim(v_new.known_flaws), ''); end if;
  if p_patch ? 'meetup_note' then v_new.meetup_note := nullif(btrim(v_new.meetup_note), ''); end if;
  if v_new.title is distinct from v_old.title then
    v_new.slug := coalesce(nullif(btrim(regexp_replace(lower(v_new.title), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'listing');
  end if;
  if p_patch ? 'available_quantity' then
    if p_patch -> 'available_quantity' = 'null'::jsonb then
      raise exception 'Available quantity is required.' using detail = 'INVALID_PUBLISHED_LISTING';
    end if;
    v_quantity := (p_patch ->> 'available_quantity')::bigint;
    if v_quantity is distinct from v_old.available_quantity then
      -- Read-only ledger inspection: no reverse reservation-row lock order.
      if v_old.reserved_quantity > 0 or exists (
        select 1 from public.inventory_reservations ir where ir.listing_id = p_listing_id and ir.status = 'active') then
        raise exception 'Quantity cannot change while stock is reserved.' using detail = 'LISTING_HAS_ACTIVE_RESERVATION';
      end if;
      if v_quantity < (case when v_old.status = 'available' then 1 else 0 end)
         or v_quantity > 2147483647::bigint - v_old.reserved_quantity then
        raise exception 'Check available quantity.' using detail = 'INVALID_PUBLISHED_LISTING';
      end if;
      v_new.stock_quantity := (v_quantity + v_old.reserved_quantity)::integer;
    end if;
  end if;

  if p_patch ? 'fulfillment_methods' then
    if jsonb_typeof(p_patch -> 'fulfillment_methods') <> 'array' then
      raise exception 'Choose valid fulfillment methods.' using detail = 'INVALID_PUBLISHED_LISTING';
    end if;
    if exists (select 1 from jsonb_array_elements(p_patch -> 'fulfillment_methods') e
        where jsonb_typeof(e) <> 'string' or e #>> '{}' not in ('meetup','pickup','local_delivery','shipping')) then
      raise exception 'Choose valid fulfillment methods.' using detail = 'INVALID_PUBLISHED_LISTING';
    end if;
    select coalesce(array_agg(e::public.fulfillment_method_enum order by e::public.fulfillment_method_enum), '{}')
      into v_methods from jsonb_array_elements_text(p_patch -> 'fulfillment_methods') e;
    if cardinality(v_methods) <> (select count(distinct e) from unnest(v_methods) e) then
      raise exception 'Choose each fulfillment method once.' using detail = 'INVALID_PUBLISHED_LISTING';
    end if;
    select coalesce(array_agg(f.method order by f.method), '{}') into v_old_methods
      from public.listing_fulfillment_methods f where f.listing_id = p_listing_id;
    if v_methods is distinct from v_old_methods then
      delete from public.listing_fulfillment_methods f where f.listing_id = p_listing_id;
      insert into public.listing_fulfillment_methods(listing_id, method) select p_listing_id, e from unnest(v_methods) e;
      v_child_changed := true;
    end if;
  end if;

  -- Strict nested contracts; timestamps/identity never reach populate_record.
  foreach v_key in array array['vehicle_details','rental_details'] loop
    if not p_patch ? v_key then continue; end if;
    v_detail := p_patch -> v_key;
    if jsonb_typeof(v_detail) not in ('object','null') then
      raise exception 'Check the optional listing details.' using detail = 'INVALID_PUBLISHED_LISTING';
    end if;
    if v_detail = '{}'::jsonb then continue; end if;
    if v_detail <> 'null'::jsonb then
      if exists (select 1 from jsonb_object_keys(v_detail) k where k = any(v_protected)) then
        raise exception 'This field cannot be edited.' using detail = 'PROTECTED_FIELD';
      end if;
      if exists (select 1 from jsonb_object_keys(v_detail) k where not k = any(case when v_key = 'vehicle_details'
          then array['brand','model','year','mileage_km','transmission','fuel_type','registration_status','documents_available']
          else array['rental_price_cents','rental_period','security_deposit_cents','rental_terms','minimum_rental_period',
            'capacity','whats_included','rules_restrictions','availability'] end)) then
        raise exception 'An unsupported detail was submitted.' using detail = 'UNKNOWN_FIELD';
      end if;
      for v_entry in select jsonb_build_object('key', key, 'value', value) from jsonb_each(v_detail) loop
        v_value := v_entry -> 'value';
        if v_value = 'null'::jsonb then continue; end if;
        if v_entry ->> 'key' in ('year','mileage_km','rental_price_cents','security_deposit_cents','capacity') then
          if jsonb_typeof(v_value) <> 'number' or v_value::text !~ '^[0-9]+$' then
            raise exception 'Use valid whole numbers.' using detail = 'INVALID_PUBLISHED_LISTING';
          end if;
        elsif v_entry ->> 'key' = 'documents_available' then
          if jsonb_typeof(v_value) <> 'array' then
            raise exception 'Choose valid vehicle documents.' using detail = 'INVALID_PUBLISHED_LISTING';
          end if;
          if exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string') then
            raise exception 'Choose valid vehicle documents.' using detail = 'INVALID_PUBLISHED_LISTING';
          end if;
        elsif jsonb_typeof(v_value) <> 'string' then
          raise exception 'Check the optional listing details.' using detail = 'INVALID_PUBLISHED_LISTING';
        end if;
      end loop;
    end if;
    if v_key = 'vehicle_details' then
      select to_jsonb(v) - array['listing_id','created_at','updated_at'] into v_before
        from public.listing_vehicle_details v where v.listing_id = p_listing_id;
      if v_detail = 'null'::jsonb then
        v_after := null;
      else
        v_vehicle := jsonb_populate_record(null::public.listing_vehicle_details, coalesce(v_before, '{}') || v_detail);
        v_after := to_jsonb(v_vehicle) - array['listing_id','created_at','updated_at'];
      end if;
      if v_before is distinct from v_after then
        if v_after is null then
          delete from public.listing_vehicle_details v where v.listing_id = p_listing_id;
        else
          insert into public.listing_vehicle_details(listing_id, brand, model, year, mileage_km, transmission, fuel_type, registration_status, documents_available)
          values(p_listing_id, v_vehicle.brand, v_vehicle.model, v_vehicle.year, v_vehicle.mileage_km,
            v_vehicle.transmission, v_vehicle.fuel_type, v_vehicle.registration_status, v_vehicle.documents_available)
          on conflict (listing_id) do update set brand=excluded.brand, model=excluded.model,
            year=excluded.year, mileage_km=excluded.mileage_km, transmission=excluded.transmission,
            fuel_type=excluded.fuel_type, registration_status=excluded.registration_status,
            documents_available=excluded.documents_available;
        end if;
        v_child_changed := true;
      end if;
    else
      select to_jsonb(r) - array['listing_id','created_at','updated_at'] into v_before
        from public.listing_rental_details r where r.listing_id = p_listing_id;
      if v_detail = 'null'::jsonb then
        v_after := null;
      else
        v_rental := jsonb_populate_record(null::public.listing_rental_details,
          coalesce(v_before, '{"availability":"available"}') || v_detail);
        v_after := to_jsonb(v_rental) - array['listing_id','created_at','updated_at'];
      end if;
      if v_before is distinct from v_after then
        if v_after is null then
          delete from public.listing_rental_details r where r.listing_id = p_listing_id;
        else
          insert into public.listing_rental_details(listing_id, rental_price_cents, rental_period, security_deposit_cents,
            rental_terms, minimum_rental_period, capacity, whats_included, rules_restrictions, availability)
          values(p_listing_id, v_rental.rental_price_cents, v_rental.rental_period, v_rental.security_deposit_cents,
            v_rental.rental_terms, v_rental.minimum_rental_period, v_rental.capacity, v_rental.whats_included,
            v_rental.rules_restrictions, v_rental.availability)
          on conflict (listing_id) do update set rental_price_cents=excluded.rental_price_cents,
            rental_period=excluded.rental_period, security_deposit_cents=excluded.security_deposit_cents,
            rental_terms=excluded.rental_terms, minimum_rental_period=excluded.minimum_rental_period,
            capacity=excluded.capacity, whats_included=excluded.whats_included,
            rules_restrictions=excluded.rules_restrictions, availability=excluded.availability;
        end if;
        v_child_changed := true;
      end if;
    end if;
  end loop;

  if p_images is not null then
    if jsonb_typeof(p_images) <> 'array' then
      raise exception 'Choose a valid gallery.' using detail = 'INVALID_IMAGE_STATE';
    end if;
    if jsonb_array_length(p_images) not between 1 and 8 then
      raise exception 'Choose between one and eight photos.' using detail = 'INVALID_IMAGE_STATE';
    end if;
    begin
      for v_entry in select value from jsonb_array_elements(p_images) loop
        if jsonb_typeof(v_entry) <> 'object' then
          raise exception 'Invalid gallery.' using detail = 'INVALID_IMAGE_STATE';
        end if;
        if exists (select 1 from jsonb_object_keys(v_entry) k where k not in ('image_id','storage_path','is_reference_image','is_cover'))
           or (v_entry ? 'image_id') = (v_entry ? 'storage_path')
           or jsonb_typeof(v_entry -> 'is_reference_image') is distinct from 'boolean'
           or jsonb_typeof(v_entry -> 'is_cover') is distinct from 'boolean' then
          raise exception 'Invalid gallery.' using detail = 'INVALID_IMAGE_STATE';
        end if;
        if v_entry ? 'image_id' then
          v_image_id := (v_entry ->> 'image_id')::uuid;
          select li.storage_path into v_path from public.listing_images li
            where li.id = v_image_id and li.listing_id = p_listing_id;
          if not found then raise exception 'Invalid gallery.' using detail = 'INVALID_IMAGE_STATE'; end if;
        else
          if jsonb_typeof(v_entry -> 'storage_path') is distinct from 'string' then
            raise exception 'Invalid gallery.' using detail = 'INVALID_IMAGE_STATE';
          end if;
          v_path := v_entry ->> 'storage_path';
          if exists (select 1 from public.listing_images li where li.storage_path = v_path) then
            raise exception 'Use the existing image identifier.' using detail = 'INVALID_IMAGE_STATE';
          end if;
          v_image_id := gen_random_uuid();
        end if;
        if v_path !~ ('^listing-images/' || v_caller::text || '/' || p_listing_id::text || '/[^/]+$')
           or not exists (select 1 from storage.objects o where o.bucket_id = 'listing-images'
             and o.name = substr(v_path, 16) and o.owner_id = v_caller::text)
           or v_image_id = any(v_ids) or v_path = any(v_paths) then
          raise exception 'Invalid gallery.' using detail = 'INVALID_IMAGE_STATE';
        end if;
        v_ids := array_append(v_ids, v_image_id); v_paths := array_append(v_paths, v_path);
        v_flags := array_append(v_flags, (v_entry ->> 'is_reference_image')::boolean);
        if (v_entry ->> 'is_cover')::boolean then
          v_cover_count := v_cover_count + 1; v_cover := v_image_id;
        end if;
      end loop;
    exception when data_exception then
      raise exception 'Choose valid uploaded listing photos.' using detail = 'INVALID_IMAGE_STATE';
    end;
    if v_cover_count <> 1 then
      raise exception 'Choose exactly one cover.' using detail = 'INVALID_IMAGE_STATE';
    end if;
    select jsonb_agg(jsonb_build_array(li.id,li.storage_path,li.is_reference_image) order by li.position)
      into v_before from public.listing_images li where li.listing_id = p_listing_id;
    select jsonb_agg(jsonb_build_array(v_ids[i],v_paths[i],v_flags[i]) order by i)
      into v_after from generate_subscripts(v_ids,1) i;
    v_image_changed := v_before is distinct from v_after or v_cover is distinct from v_old.cover_image_id;
    if v_image_changed then
      -- Choose currently unused nonnegative positions outside the final 0..7
      -- range. At most eight old and eight new rows need staging, so 8..31
      -- always has enough free slots even when old positions are sparse or high.
      select array_agg(slot order by slot) into v_stage_positions
        from pg_catalog.generate_series(8, 31) slot
        where not exists (select 1 from public.listing_images li
          where li.listing_id = p_listing_id and li.position = slot);
      v_stage_index := 0;
      for v_existing_image in select li.id from public.listing_images li
          where li.listing_id = p_listing_id order by li.id loop
        v_stage_index := v_stage_index + 1;
        update public.listing_images li set position = v_stage_positions[v_stage_index]
          where li.id = v_existing_image.id;
      end loop;
      for v_i in 1..cardinality(v_ids) loop
        if not exists (select 1 from public.listing_images li where li.id = v_ids[v_i]) then
          v_stage_index := v_stage_index + 1;
          insert into public.listing_images(id,listing_id,storage_path,position,is_reference_image)
            values(v_ids[v_i],p_listing_id,v_paths[v_i],v_stage_positions[v_stage_index],v_flags[v_i]);
        end if;
      end loop;
      v_new.cover_image_id := v_cover;
      v_child_changed := true;
    end if;
  end if;

  v_changed := v_child_changed or to_jsonb(v_new) is distinct from to_jsonb(v_old);
  if v_changed then
    -- The only parent UPDATE in a save, even for a child-only change. Establish
    -- the new cover BEFORE deleting the old row to avoid FK SET NULL + double bump.
    update public.listings l set title=v_new.title, description=v_new.description, slug=v_new.slug,
      price_cents=v_new.price_cents, original_price_cents=v_new.original_price_cents,
      is_negotiable=v_new.is_negotiable, brand=v_new.brand, known_flaws=v_new.known_flaws,
      province_id=v_new.province_id, city_id=v_new.city_id, barangay_id=v_new.barangay_id,
      meetup_note=v_new.meetup_note, stock_quantity=v_new.stock_quantity,
      cover_image_id=v_new.cover_image_id, revision=l.revision+1
      where l.id=p_listing_id;
  end if;
  if v_image_changed then
    delete from public.listing_images li where li.listing_id=p_listing_id and not li.id=any(v_ids);
    for v_i in 1..cardinality(v_ids) loop
      update public.listing_images li set position=v_i-1, is_reference_image=v_flags[v_i] where li.id=v_ids[v_i];
    end loop;
  end if;
  begin
    perform public.validate_published_listing(p_listing_id, v_old.status = 'paused');
  exception when raise_exception then
    get stacked diagnostics v_code = pg_exception_detail;
    if v_code in ('INVALID_IMAGE_STATE','IMAGE_REQUIRED','TOO_MANY_LISTING_IMAGES',
      'REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED','BRAND_NEW_REQUIRES_ACTUAL_IMAGE') then
      raise exception 'Choose valid listing photos.' using detail = 'INVALID_IMAGE_STATE';
    end if;
    raise exception 'Complete the required listing information.' using detail = 'INVALID_PUBLISHED_LISTING';
  end;
  return public.get_published_listing_edit_state(p_listing_id) || jsonb_build_object('changed', v_changed);
exception when data_exception or integrity_constraint_violation then
  -- Roll back the complete operation; expose neither constraint names nor SQL.
  raise exception 'Check the listing information.' using detail = 'INVALID_PUBLISHED_LISTING';
end;
$$;
revoke all on function public.update_published_listing(uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.update_published_listing(uuid, bigint, jsonb, jsonb) to authenticated;
