-- Admin listing hide/unhide -- repository-local database slice only.
-- Repository-local until reviewed/applied. Not deployed by this migration
-- file's mere presence in the repo.
--
-- Why this migration is needed (found during a read-only audit, not assumed)
-- -----------------------------------------------------------------------
-- PRD 31 ("Reporting and Moderation") lists, as its own separate admin
-- capability, "Hide/remove listings" -- distinct from "Suspend seller
-- privileges." No RPC for this exists today: update_listing_status (0094)
-- is strictly seller-owner-only (resolves the caller's own shop, rejects
-- NOT_LISTING_OWNER otherwise) and has no admin bypass of any kind. The
-- only existing moderation lever, apply_user_restriction, suspends the
-- ENTIRE seller -- every listing they have, not just the reported one.
-- This migration adds the smallest independent mechanism: a nullable
-- admin-only flag on listings, checked as an additional, orthogonal gate
-- in the three public read paths that expose listing details/images
-- (get_listing_detail, browse_listings, get_my_favorites) -- the exact
-- same additive pattern the seller-suspension check already uses
-- everywhere, never replacing the existing status/suspension checks.
--
-- moderation_actions was inspected and found NOT reusable here: its
-- target_user_id, restriction_type, and restriction_id columns are all
-- NOT NULL (the last with a hard FK into user_restrictions), so it is
-- structurally hard-wired to restriction apply/lift events only, with no
-- listing reference column at all. Retrofitting nullable columns plus new
-- CHECK logic onto that table would be a larger, messier change than a
-- new, narrow, purpose-built sibling table -- so this migration adds one:
-- listing_moderation_actions, mirroring moderation_actions' own
-- RLS-enabled/zero-client-policy/trusted-RPC-only convention exactly
-- (confirmed live: reports/moderation_actions/user_restrictions/listings
-- all have relrowsecurity = true with zero policies -- the established
-- "no client write policy; access only through SECURITY DEFINER RPCs"
-- boundary in this schema).
--
-- Independence from seller status changes: update_listing_status (0094)
-- is NOT redefined by this migration and never references
-- hidden_by_admin_at -- a seller has no way to read or clear it. Unhiding
-- only clears this one flag; it never touches listings.status or
-- user_restrictions, so a listing whose seller is separately suspended
-- (or whose own status is draft/paused) remains correctly excluded by
-- those independent, pre-existing checks after an unhide -- the three
-- gates (status, suspension, admin-hidden) are combined with AND
-- throughout, never OR, so clearing one alone can never re-expose a
-- listing that another gate still excludes.
--
-- Order history / messages: order_items.listing_cover_image_snapshot_path
-- is a plain, independently-populated text column (0009), never read by
-- any of the three functions touched here, and this migration adds no
-- reference to order_items, listing_images, or storage.objects anywhere.
-- Confirmed live immediately before writing this file: 25 order_items
-- carry a cover-image snapshot, 0 of which would be affected by anything
-- in this migration.
--
-- Scope: no admin UI, no review-image change, no Storage policy/object
-- change, no change to update_listing_status or any seller-facing RPC.

-- ============================================================
-- 1. listings.hidden_by_admin_at -- nullable, default null, independent
--    of listings.status and archived_at
-- ============================================================
alter table public.listings
  add column hidden_by_admin_at timestamptz null;

-- ============================================================
-- 2. listing_moderation_actions -- dedicated, append-only audit trail
--    for this action only (see header for why moderation_actions itself
--    is not reused)
-- ============================================================
create type public.listing_moderation_action_type_enum as enum (
  'hidden',
  'unhidden'
);

create table public.listing_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  action_type public.listing_moderation_action_type_enum not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint listing_moderation_actions_reason_required_for_hide_check
    check (action_type <> 'hidden' or (reason is not null and length(btrim(reason)) > 0))
);

create index listing_moderation_actions_listing_id_created_at_idx
  on public.listing_moderation_actions (listing_id, created_at desc, id desc);

-- Same trusted-RPC-only boundary already established for reports/
-- moderation_actions/user_restrictions/listings (RLS enabled, zero
-- client-facing policies -- confirmed live for all four before writing
-- this file). No policy is added here; access is exclusively through the
-- SECURITY DEFINER functions below.
alter table public.listing_moderation_actions enable row level security;

-- ============================================================
-- 3. admin_hide_listing -- admin-only; sets hidden_by_admin_at
-- ============================================================
create or replace function public.admin_hide_listing(p_listing_id uuid, p_reason text)
returns table (listing_id uuid, hidden_by_admin_at timestamptz, was_already_hidden boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_reason text;
  v_existing_hidden_at timestamptz;
  v_new_hidden_at timestamptz;
begin
  -- ===================== authentication + admin authorization (identical pattern to apply_user_restriction/0067) =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A reason is required.' using detail = 'REASON_REQUIRED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.hidden_by_admin_at into v_existing_hidden_at
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  -- ===================== idempotent: already hidden is a safe no-op, matching apply_user_restriction's own convention =====================
  if v_existing_hidden_at is not null then
    return query
      select p_listing_id, v_existing_hidden_at, true;
    return;
  end if;

  v_new_hidden_at := now();

  update public.listings as l
    set hidden_by_admin_at = v_new_hidden_at
    where l.id = p_listing_id;

  insert into public.listing_moderation_actions (admin_id, listing_id, action_type, reason)
    values (v_caller, p_listing_id, 'hidden', v_reason);

  return query
    select p_listing_id, v_new_hidden_at, false;
end;
$$;

revoke all on function public.admin_hide_listing(uuid, text) from public;
revoke all on function public.admin_hide_listing(uuid, text) from anon;
grant execute on function public.admin_hide_listing(uuid, text) to authenticated;

-- ============================================================
-- 4. admin_unhide_listing -- admin-only; clears hidden_by_admin_at only.
--    Never touches listings.status or user_restrictions -- a listing
--    excluded by either of those independent gates remains excluded.
-- ============================================================
create or replace function public.admin_unhide_listing(p_listing_id uuid, p_note text default null)
returns table (listing_id uuid, hidden_by_admin_at timestamptz, was_already_visible boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_note text;
  v_existing_hidden_at timestamptz;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.hidden_by_admin_at into v_existing_hidden_at
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  -- ===================== idempotent: already visible (never hidden, or already unhidden) is a safe no-op =====================
  if v_existing_hidden_at is null then
    return query
      select p_listing_id, null::timestamptz, true;
    return;
  end if;

  v_note := nullif(btrim(p_note), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Note is too long.' using detail = 'ADMIN_UNHIDE_NOTE_TOO_LONG';
  end if;

  update public.listings as l
    set hidden_by_admin_at = null
    where l.id = p_listing_id;

  insert into public.listing_moderation_actions (admin_id, listing_id, action_type, reason)
    values (v_caller, p_listing_id, 'unhidden', v_note);

  return query
    select p_listing_id, null::timestamptz, false;
end;
$$;

revoke all on function public.admin_unhide_listing(uuid, text) from public;
revoke all on function public.admin_unhide_listing(uuid, text) from anon;
grant execute on function public.admin_unhide_listing(uuid, text) to authenticated;

-- ============================================================
-- 5. get_listing_detail -- adds `and l.hidden_by_admin_at is null` to the
--    existing visibility gate only. Every other line unchanged from the
--    current live definition (0036).
-- ============================================================
create or replace function public.get_listing_detail(p_public_code text)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  title text,
  description text,
  listing_type public.listing_type_enum,
  condition public.listing_condition_enum,
  known_flaws text,
  brand text,
  price_cents bigint,
  original_price_cents bigint,
  is_negotiable boolean,
  status public.listing_status_enum,
  available_quantity integer,
  meetup_note text,
  published_at timestamptz,
  created_at timestamptz,
  category_id integer,
  category_name text,
  is_inquiry_only boolean,
  province_name text,
  city_name text,
  barangay_name text,
  image_paths text[],
  fulfillment_methods public.fulfillment_method_enum[],
  shop_id uuid,
  shop_slug text,
  shop_name text,
  shop_description text,
  shop_logo_storage_path text,
  shop_messenger_link text,
  shop_status public.shop_status_enum,
  shop_is_trusted_seller boolean,
  shop_member_since timestamptz,
  review_count bigint,
  average_rating numeric,
  vehicle_brand text,
  vehicle_model text,
  vehicle_year smallint,
  vehicle_mileage_km integer,
  vehicle_transmission text,
  vehicle_fuel_type text,
  vehicle_registration_status public.vehicle_registration_status_enum,
  vehicle_documents_available text[],
  rental_price_cents bigint,
  rental_period public.rental_period_enum,
  rental_security_deposit_cents bigint,
  rental_terms text,
  rental_minimum_rental_period text,
  rental_capacity integer,
  rental_whats_included text,
  rental_rules_restrictions text,
  rental_availability public.rental_availability_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_code text;
  v_listing_id uuid;
begin
  v_public_code := nullif(btrim(p_public_code), '');

  if v_public_code is null then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  -- ===================== visibility gate: status + admin-hidden + shop-suspension, single lookup =====================
  select l.id into v_listing_id
    from public.listings l
    join public.shops s on s.id = l.shop_id
    where l.public_code = v_public_code
      and l.status in ('available', 'reserved', 'sold', 'archived')
      and l.hidden_by_admin_at is null
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      );

  if v_listing_id is null then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  return query
    select
      l.id as listing_id,
      l.public_code,
      l.slug,
      l.title,
      l.description,
      l.listing_type,
      l.condition,
      l.known_flaws,
      l.brand,
      l.price_cents,
      l.original_price_cents,
      l.is_negotiable,
      l.status,
      l.available_quantity,
      l.meetup_note,
      l.published_at,
      l.created_at,
      l.category_id,
      cat.name as category_name,
      cat.is_inquiry_only,
      prov.name as province_name,
      city.name as city_name,
      bgy.name as barangay_name,
      coalesce(imgs.image_paths, '{}'::text[]) as image_paths,
      coalesce(fm.methods, '{}'::public.fulfillment_method_enum[]) as fulfillment_methods,
      s.id as shop_id,
      s.slug as shop_slug,
      s.name as shop_name,
      s.description as shop_description,
      s.logo_storage_path as shop_logo_storage_path,
      s.messenger_link as shop_messenger_link,
      s.status as shop_status,
      s.is_trusted_seller as shop_is_trusted_seller,
      s.created_at as shop_member_since,
      coalesce(rv.review_count, 0) as review_count,
      rv.average_rating,
      veh.brand as vehicle_brand,
      veh.model as vehicle_model,
      veh.year as vehicle_year,
      veh.mileage_km as vehicle_mileage_km,
      veh.transmission as vehicle_transmission,
      veh.fuel_type as vehicle_fuel_type,
      veh.registration_status as vehicle_registration_status,
      veh.documents_available as vehicle_documents_available,
      rent.rental_price_cents,
      rent.rental_period,
      rent.security_deposit_cents as rental_security_deposit_cents,
      rent.rental_terms,
      rent.minimum_rental_period as rental_minimum_rental_period,
      rent.capacity as rental_capacity,
      rent.whats_included as rental_whats_included,
      rent.rules_restrictions as rental_rules_restrictions,
      rent.availability as rental_availability
    from public.listings l
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    join public.provinces prov on prov.id = l.province_id
    join public.cities_municipalities city on city.id = l.city_id
    left join public.barangays bgy on bgy.id = l.barangay_id
    left join public.listing_vehicle_details veh on veh.listing_id = l.id
    left join public.listing_rental_details rent on rent.listing_id = l.id
    left join lateral (
      select array_agg(li.storage_path order by li.position asc) as image_paths
      from public.listing_images li
      where li.listing_id = l.id
    ) imgs on true
    left join lateral (
      select array_agg(lfm.method order by lfm.method) as methods
      from public.listing_fulfillment_methods lfm
      where lfm.listing_id = l.id
    ) fm on true
    left join lateral (
      select count(*) as review_count, avg(r.rating)::numeric as average_rating
      from public.reviews r
      where r.shop_id = l.shop_id
    ) rv on true
    where l.id = v_listing_id;
end;
$$;

revoke all on function public.get_listing_detail(text) from public;
grant execute on function public.get_listing_detail(text) to anon;
grant execute on function public.get_listing_detail(text) to authenticated;

-- ============================================================
-- 6. browse_listings -- adds `and l.hidden_by_admin_at is null` to all
--    three sort branches' identical status/suspension predicate. Every
--    other line unchanged from the current live definition (0036).
-- ============================================================
create or replace function public.browse_listings(
  p_search text default null,
  p_category_id integer default null,
  p_listing_type public.listing_type_enum default null,
  p_condition public.listing_condition_enum default null,
  p_min_price_cents bigint default null,
  p_max_price_cents bigint default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_fulfillment_method public.fulfillment_method_enum default null,
  p_shop_id uuid default null,
  p_sort text default 'newest',
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_price_cents bigint default null,
  p_before_id uuid default null
)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  title text,
  price_cents bigint,
  original_price_cents bigint,
  is_negotiable boolean,
  listing_type public.listing_type_enum,
  condition public.listing_condition_enum,
  status public.listing_status_enum,
  is_inquiry_only boolean,
  created_at timestamptz,
  category_id integer,
  category_name text,
  province_name text,
  city_name text,
  barangay_name text,
  cover_image_storage_path text,
  shop_id uuid,
  shop_slug text,
  shop_name text,
  shop_logo_storage_path text,
  shop_status public.shop_status_enum,
  is_trusted_seller boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text;
  v_escaped_search text;
  v_search_pattern text;
begin
  -- ===================== sort validation (static whitelist, no new enum) =====================
  if p_sort not in ('newest', 'price_low', 'price_high') then
    raise exception 'Sort must be newest, price_low, or price_high.' using detail = 'SORT_INVALID';
  end if;

  -- ===================== limit validation =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  -- ===================== cursor validation, only the pair relevant to p_sort =====================
  if p_sort = 'newest' then
    if (p_before_created_at is null) <> (p_before_id is null) then
      raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
    end if;
  else
    if (p_before_price_cents is null) <> (p_before_id is null) then
      raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
    end if;
  end if;

  -- ===================== price filter validation =====================
  if p_min_price_cents is not null and p_min_price_cents < 0 then
    raise exception 'Price filter must be non-negative.' using detail = 'PRICE_FILTER_INVALID';
  end if;

  if p_max_price_cents is not null and p_max_price_cents < 0 then
    raise exception 'Price filter must be non-negative.' using detail = 'PRICE_FILTER_INVALID';
  end if;

  if p_min_price_cents is not null and p_max_price_cents is not null and p_min_price_cents > p_max_price_cents then
    raise exception 'Minimum price cannot exceed maximum price.' using detail = 'PRICE_FILTER_INVALID';
  end if;

  -- ===================== search normalization + literal wildcard escaping =====================
  v_search := nullif(regexp_replace(p_search, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_search is not null and char_length(v_search) > 100 then
    raise exception 'Search query is too long.' using detail = 'SEARCH_QUERY_TOO_LONG';
  end if;

  if v_search is not null then
    v_escaped_search := replace(v_search, '\', '\\');
    v_escaped_search := replace(v_escaped_search, '%', '\%');
    v_escaped_search := replace(v_escaped_search, '_', '\_');
    v_search_pattern := '%' || v_escaped_search || '%';
  end if;

  -- ===================== newest: keyset on (created_at, id) DESC =====================
  if p_sort = 'newest' then
    return query
      select
        l.id as listing_id,
        l.public_code,
        l.slug,
        l.title,
        l.price_cents,
        l.original_price_cents,
        l.is_negotiable,
        l.listing_type,
        l.condition,
        l.status,
        cat.is_inquiry_only,
        l.created_at,
        l.category_id,
        cat.name as category_name,
        prov.name as province_name,
        city.name as city_name,
        bgy.name as barangay_name,
        img.storage_path as cover_image_storage_path,
        s.id as shop_id,
        s.slug as shop_slug,
        s.name as shop_name,
        s.logo_storage_path as shop_logo_storage_path,
        s.status as shop_status,
        s.is_trusted_seller
      from public.listings l
      join public.shops s on s.id = l.shop_id
      join public.categories cat on cat.id = l.category_id
      join public.provinces prov on prov.id = l.province_id
      join public.cities_municipalities city on city.id = l.city_id
      left join public.barangays bgy on bgy.id = l.barangay_id
      left join public.listing_images img on img.id = l.cover_image_id
      where
        (
          (p_shop_id is null and l.status = 'available')
          or (p_shop_id is not null and l.shop_id = p_shop_id and l.status in ('available', 'reserved'))
        )
        and l.hidden_by_admin_at is null
        and not exists (
          select 1 from public.user_restrictions ur
          where ur.user_id = s.owner_id
            and ur.lifted_at is null
            and ur.restriction_type in ('seller_suspended', 'account_suspended')
        )
        and (p_category_id is null or l.category_id = p_category_id)
        and (p_listing_type is null or l.listing_type = p_listing_type)
        and (p_condition is null or l.condition = p_condition)
        and (p_min_price_cents is null or l.price_cents >= p_min_price_cents)
        and (p_max_price_cents is null or l.price_cents <= p_max_price_cents)
        and (p_province_id is null or l.province_id = p_province_id)
        and (p_city_id is null or l.city_id = p_city_id)
        and (p_barangay_id is null or l.barangay_id = p_barangay_id)
        and (
          p_fulfillment_method is null
          or exists (
            select 1 from public.listing_fulfillment_methods lfm
            where lfm.listing_id = l.id and lfm.method = p_fulfillment_method
          )
        )
        and (
          v_search_pattern is null
          or l.title ilike v_search_pattern escape '\'
          or l.description ilike v_search_pattern escape '\'
          or cat.name ilike v_search_pattern escape '\'
          or s.name ilike v_search_pattern escape '\'
          or prov.name ilike v_search_pattern escape '\'
          or city.name ilike v_search_pattern escape '\'
          or bgy.name ilike v_search_pattern escape '\'
        )
        and (
          p_before_created_at is null
          or (l.created_at, l.id) < (p_before_created_at, p_before_id)
        )
      order by l.created_at desc, l.id desc
      limit p_limit;

  -- ===================== price_low: keyset on (price_cents, id) ASC =====================
  elsif p_sort = 'price_low' then
    return query
      select
        l.id as listing_id,
        l.public_code,
        l.slug,
        l.title,
        l.price_cents,
        l.original_price_cents,
        l.is_negotiable,
        l.listing_type,
        l.condition,
        l.status,
        cat.is_inquiry_only,
        l.created_at,
        l.category_id,
        cat.name as category_name,
        prov.name as province_name,
        city.name as city_name,
        bgy.name as barangay_name,
        img.storage_path as cover_image_storage_path,
        s.id as shop_id,
        s.slug as shop_slug,
        s.name as shop_name,
        s.logo_storage_path as shop_logo_storage_path,
        s.status as shop_status,
        s.is_trusted_seller
      from public.listings l
      join public.shops s on s.id = l.shop_id
      join public.categories cat on cat.id = l.category_id
      join public.provinces prov on prov.id = l.province_id
      join public.cities_municipalities city on city.id = l.city_id
      left join public.barangays bgy on bgy.id = l.barangay_id
      left join public.listing_images img on img.id = l.cover_image_id
      where
        (
          (p_shop_id is null and l.status = 'available')
          or (p_shop_id is not null and l.shop_id = p_shop_id and l.status in ('available', 'reserved'))
        )
        and l.hidden_by_admin_at is null
        and not exists (
          select 1 from public.user_restrictions ur
          where ur.user_id = s.owner_id
            and ur.lifted_at is null
            and ur.restriction_type in ('seller_suspended', 'account_suspended')
        )
        and (p_category_id is null or l.category_id = p_category_id)
        and (p_listing_type is null or l.listing_type = p_listing_type)
        and (p_condition is null or l.condition = p_condition)
        and (p_min_price_cents is null or l.price_cents >= p_min_price_cents)
        and (p_max_price_cents is null or l.price_cents <= p_max_price_cents)
        and (p_province_id is null or l.province_id = p_province_id)
        and (p_city_id is null or l.city_id = p_city_id)
        and (p_barangay_id is null or l.barangay_id = p_barangay_id)
        and (
          p_fulfillment_method is null
          or exists (
            select 1 from public.listing_fulfillment_methods lfm
            where lfm.listing_id = l.id and lfm.method = p_fulfillment_method
          )
        )
        and (
          v_search_pattern is null
          or l.title ilike v_search_pattern escape '\'
          or l.description ilike v_search_pattern escape '\'
          or cat.name ilike v_search_pattern escape '\'
          or s.name ilike v_search_pattern escape '\'
          or prov.name ilike v_search_pattern escape '\'
          or city.name ilike v_search_pattern escape '\'
          or bgy.name ilike v_search_pattern escape '\'
        )
        and (
          p_before_price_cents is null
          or (l.price_cents, l.id) > (p_before_price_cents, p_before_id)
        )
      order by l.price_cents asc, l.id asc
      limit p_limit;

  -- ===================== price_high: keyset on (price_cents, id) DESC =====================
  else
    return query
      select
        l.id as listing_id,
        l.public_code,
        l.slug,
        l.title,
        l.price_cents,
        l.original_price_cents,
        l.is_negotiable,
        l.listing_type,
        l.condition,
        l.status,
        cat.is_inquiry_only,
        l.created_at,
        l.category_id,
        cat.name as category_name,
        prov.name as province_name,
        city.name as city_name,
        bgy.name as barangay_name,
        img.storage_path as cover_image_storage_path,
        s.id as shop_id,
        s.slug as shop_slug,
        s.name as shop_name,
        s.logo_storage_path as shop_logo_storage_path,
        s.status as shop_status,
        s.is_trusted_seller
      from public.listings l
      join public.shops s on s.id = l.shop_id
      join public.categories cat on cat.id = l.category_id
      join public.provinces prov on prov.id = l.province_id
      join public.cities_municipalities city on city.id = l.city_id
      left join public.barangays bgy on bgy.id = l.barangay_id
      left join public.listing_images img on img.id = l.cover_image_id
      where
        (
          (p_shop_id is null and l.status = 'available')
          or (p_shop_id is not null and l.shop_id = p_shop_id and l.status in ('available', 'reserved'))
        )
        and l.hidden_by_admin_at is null
        and not exists (
          select 1 from public.user_restrictions ur
          where ur.user_id = s.owner_id
            and ur.lifted_at is null
            and ur.restriction_type in ('seller_suspended', 'account_suspended')
        )
        and (p_category_id is null or l.category_id = p_category_id)
        and (p_listing_type is null or l.listing_type = p_listing_type)
        and (p_condition is null or l.condition = p_condition)
        and (p_min_price_cents is null or l.price_cents >= p_min_price_cents)
        and (p_max_price_cents is null or l.price_cents <= p_max_price_cents)
        and (p_province_id is null or l.province_id = p_province_id)
        and (p_city_id is null or l.city_id = p_city_id)
        and (p_barangay_id is null or l.barangay_id = p_barangay_id)
        and (
          p_fulfillment_method is null
          or exists (
            select 1 from public.listing_fulfillment_methods lfm
            where lfm.listing_id = l.id and lfm.method = p_fulfillment_method
          )
        )
        and (
          v_search_pattern is null
          or l.title ilike v_search_pattern escape '\'
          or l.description ilike v_search_pattern escape '\'
          or cat.name ilike v_search_pattern escape '\'
          or s.name ilike v_search_pattern escape '\'
          or prov.name ilike v_search_pattern escape '\'
          or city.name ilike v_search_pattern escape '\'
          or bgy.name ilike v_search_pattern escape '\'
        )
        and (
          p_before_price_cents is null
          or (l.price_cents, l.id) < (p_before_price_cents, p_before_id)
        )
      order by l.price_cents desc, l.id desc
      limit p_limit;
  end if;
end;
$$;

revoke all on function public.browse_listings(text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, integer, integer, integer, public.fulfillment_method_enum, uuid, text, integer, timestamptz, bigint, uuid) from public;
revoke all on function public.browse_listings(text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, integer, integer, integer, public.fulfillment_method_enum, uuid, text, integer, timestamptz, bigint, uuid) from anon;
grant execute on function public.browse_listings(text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, integer, integer, integer, public.fulfillment_method_enum, uuid, text, integer, timestamptz, bigint, uuid) to anon;
grant execute on function public.browse_listings(text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, integer, integer, integer, public.fulfillment_method_enum, uuid, text, integer, timestamptz, bigint, uuid) to authenticated;

-- ============================================================
-- 7. get_my_favorites -- adds `and l.hidden_by_admin_at is null` to the
--    is_visible lateral check only. Every other line unchanged from the
--    current live definition (0037).
-- ============================================================
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
        and l.hidden_by_admin_at is null
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
