-- Public marketplace browsing, part 2 of 2: the three public read RPCs
-- (browse_listings, get_listing_detail, get_shop_detail) that serve
-- listings/shops publicly. No tables, indexes, or policies -- those were
-- added in 0035, which this migration relies on entirely.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0035_public_browsing_indexes_and_reference_rls;
-- this is the next migration, no drift. listings/listing_images/shops
-- schemas confirmed unchanged from prior inspection. listing_fulfillment_methods
-- is (listing_id, method), PK (listing_id, method), FK listing_id -> listings
-- ON DELETE CASCADE. listing_vehicle_details: (listing_id, brand, model, year
-- smallint, mileage_km integer, transmission text, fuel_type text,
-- registration_status vehicle_registration_status_enum, documents_available
-- text[], created_at, updated_at) -- all of brand/model/year/mileage/
-- transmission/fuel/registration/documents are explicitly public buyer-facing
-- per PRD S13.1; created_at/updated_at are internal and excluded.
-- listing_rental_details: (listing_id, rental_price_cents, rental_period
-- rental_period_enum, security_deposit_cents, rental_terms,
-- minimum_rental_period, capacity, whats_included, rules_restrictions,
-- availability rental_availability_enum not null default 'available',
-- created_at, updated_at) -- all rental_* fields are explicitly public
-- buyer-facing per PRD S13.2 (including availability, PRD's own "Rental
-- availability states"); created_at/updated_at excluded as internal. No
-- field in either detail table looked administrative/private -- nothing
-- excluded beyond the two internal timestamp columns each.
-- categories: (id, name, slug, is_inquiry_only, sort_order, created_at).
-- shop_slugs: (slug, shop_id, is_current, created_at) -- confirmed the
-- historical-slug resolution mechanism. reviews, orders, user_restrictions
-- schemas confirmed unchanged from the reviews/messaging migrations.
-- Enums reconfirmed exact: listing_status_enum (draft, available, reserved,
-- paused, sold, archived), listing_type_enum (preloved, brand_new),
-- listing_condition_enum (brand_new, like_new, very_good, good, fair),
-- fulfillment_method_enum (meetup, pickup, local_delivery, shipping),
-- shop_status_enum (active, away -- no suspended value, confirming
-- moderation suspension lives only in user_restrictions), restriction_type_enum
-- (seller_suspended, buyer_restricted, account_suspended).
--
-- All 9 expected indexes confirmed live (listings_available_newest_idx,
-- listings_available_category_newest_idx, listings_available_province_newest_idx,
-- listings_available_city_newest_idx, listings_available_barangay_newest_idx,
-- listings_shop_newest_idx, listings_available_price_idx,
-- listings_title_trgm_idx, shops_name_trgm_idx). All 5 reference-data
-- policies from 0035 confirmed live, plus the 8 pre-existing policies
-- (13 total). No browse_listings/get_listing_detail/get_shop_detail (or any
-- other listing/shop/browse-named function) exists yet -- clean namespace,
-- no collision. No missing schema/index was discovered; 0036 relies entirely
-- on what 0035 and earlier migrations already provide.
--
-- Seller moderation visibility gate (applies identically in all three
-- functions, at every surface: global browse, shop-scoped browse, listing
-- detail, shop detail)
-- -----------------------------------------------------------------------
-- A shop is hidden wherever its current owner has an active
-- (lifted_at IS NULL) seller_suspended OR account_suspended restriction:
--   not exists (
--     select 1 from public.user_restrictions ur
--     where ur.user_id = <shop owner> and ur.lifted_at is null
--       and ur.restriction_type in ('seller_suspended', 'account_suspended')
--   )
-- browse_listings simply omits the rows (WHERE clause). get_listing_detail
-- and get_shop_detail both raise the same generic NOT_FOUND code used for a
-- genuinely nonexistent row -- a suspended shop's listing/shop page is
-- indistinguishable from one that never existed, exactly per the locked
-- privacy requirement. Away shops are never gated -- shop_status_enum has no
-- suspended value at all; "away" is purely an informational status.
--
-- Search wildcard escaping (locked decision)
-- -----------------------------------------------------------------------
-- browse_listings normalizes p_search (trim; empty/whitespace -> no filter;
-- >100 chars -> SEARCH_QUERY_TOO_LONG) and then escapes literal backslash,
-- percent, and underscore -- in that exact order, backslash first -- before
-- wrapping the term in '%...%' and matching with ILIKE ... ESCAPE '\'. This
-- is not an injection concern (the pattern is bound as a parameter, never
-- concatenated into SQL text); it exists purely so a search for "100% cotton"
-- or "foo_bar" matches those literal characters rather than being
-- interpreted as LIKE wildcard syntax.
--
-- Sort/cursor implementation
-- -----------------------------------------------------------------------
-- p_sort is validated against a static three-value whitelist
-- ('newest' | 'price_low' | 'price_high') in plpgsql, not a new enum type,
-- per the locked decision. browse_listings uses three fully separate static
-- IF/ELSIF return-query branches (never a CASE-conditional ORDER BY or any
-- dynamic/EXECUTE SQL) -- each branch is a complete, independently readable
-- statement differing only in its keyset predicate and ORDER BY, matching
-- this project's established branching style (e.g. upsert_review_reply's
-- first-reply/edit branches) and leaving zero ambiguity about how sorting is
-- resolved. Each branch validates and uses only its own relevant cursor
-- pair; the irrelevant cursor parameter for that sort is never read,
-- implementing "ignore rather than reject" exactly as specified.
--
-- Ambiguity-bug re-audit (0021/0022 precedent): every table column read in
-- all three functions is alias-qualified (l., s., cat., prov., city., bgy.,
-- veh., rent., img., imgs., fm., rv., ord., lst., ss.), including every
-- column whose name collides with one of that function's own RETURNS TABLE
-- output-column names (listing_id/shop_id/slug/title/status/created_at/
-- price_cents/public_code/review_count/average_rating/current_slug and
-- others). Plain PL/pgSQL variables (v_search, v_search_pattern,
-- v_listing_id, v_shop_id, v_requested_slug, v_public_code) are read as
-- host-language values, never as bare table columns, so their reuse of
-- output-adjacent names carries no ambiguity risk, per established
-- precedent. No dynamic SQL anywhere in this migration.
--
-- Cardinality safety: browse_listings' cover image is resolved via a plain
-- equality join on listings.cover_image_id = listing_images.id (the
-- composite FK listings_cover_image_id_fkey guarantees at most one matching
-- row, already scoped to the correct listing); the fulfillment filter uses
-- EXISTS rather than a join; get_listing_detail/get_shop_detail aggregate
-- images/fulfillment/reviews/orders/listings via LEFT JOIN LATERAL scalar
-- aggregates so each function returns exactly one row regardless of how many
-- child rows exist -- no DISTINCT band-aid anywhere.

-- ============================================================
-- browse_listings
-- ============================================================
-- Single function serving the homepage default feed, Fresh Finds (smaller
-- limit), Pre-loved/Brand New sections (p_listing_type), category/search
-- browsing, and shop-scoped browsing (p_shop_id) -- no per-section function
-- exists or is needed. Global mode (p_shop_id IS NULL) admits status =
-- 'available' only; shop-scoped mode (p_shop_id IS NOT NULL) admits status
-- IN ('available', 'reserved') for that shop only -- this is the only
-- surface where p_shop_id changes status eligibility, and it can never leak
-- reserved listings into the global feed because the two branches of the
-- status predicate are mutually exclusive on p_shop_id being null or not.
-- paused/sold/archived/draft are never reachable through this function
-- under any parameter combination. Returns exactly the card fields a
-- marketplace listing card needs -- no review_count/average_rating (PRD S16:
-- "Do not clutter cards with ... Full seller rating details"), no owner_id,
-- no stock/reservation internals, no listing_metrics.
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

revoke all on function public.browse_listings(
  text, integer, public.listing_type_enum, public.listing_condition_enum,
  bigint, bigint, integer, integer, integer, public.fulfillment_method_enum,
  uuid, text, integer, timestamptz, bigint, uuid
) from public;
grant execute on function public.browse_listings(
  text, integer, public.listing_type_enum, public.listing_condition_enum,
  bigint, bigint, integer, integer, integer, public.fulfillment_method_enum,
  uuid, text, integer, timestamptz, bigint, uuid
) to anon;
grant execute on function public.browse_listings(
  text, integer, public.listing_type_enum, public.listing_condition_enum,
  bigint, bigint, integer, integer, integer, public.fulfillment_method_enum,
  uuid, text, integer, timestamptz, bigint, uuid
) to authenticated;

-- ============================================================
-- get_listing_detail
-- ============================================================
-- Looked up by listings.public_code -- the schema's actual unique identity
-- (slug alone is not unique; the canonical /item/{slug}-{public_code} URL
-- relies on public_code). Visible for available/reserved/sold/archived;
-- paused/draft/suspended-shop all collapse to the same LISTING_NOT_FOUND,
-- never revealing which case occurred. available_quantity is returned;
-- stock_quantity/reserved_quantity are never exposed. Images ordered by
-- position, fulfillment methods ordered by method, both returned as empty
-- arrays (never NULL) when absent. Review count/average computed directly
-- against reviews for the listing's shop (not a call to
-- get_shop_review_summary), zero-review case naturally yields 0/NULL.
-- Vehicle/rental detail fields are left-joined and simply come back null for
-- listings without a matching detail row.
create or replace function public.get_listing_detail(
  p_public_code text
)
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

  -- ===================== visibility gate: status + shop-suspension, single lookup =====================
  select l.id into v_listing_id
    from public.listings l
    join public.shops s on s.id = l.shop_id
    where l.public_code = v_public_code
      and l.status in ('available', 'reserved', 'sold', 'archived')
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
-- get_shop_detail
-- ============================================================
-- Resolved against shop_slugs.slug (any historical slug, not just the
-- current one), returning both current_slug and is_current_slug so the
-- caller can redirect a historical slug to the canonical one -- this
-- function never performs an HTTP redirect itself. Suspended shop ->
-- SHOP_NOT_FOUND (same code as a genuinely nonexistent slug). Away shops are
-- always visible. active_listing_count counts status = 'available' only
-- (reserved is deliberately not counted as active, per the locked
-- definition); completed_order_count counts orders with status =
-- 'completed'; review_count/average_rating computed directly against
-- reviews, zero-review case naturally yields 0/NULL. Only
-- featured_listing_id is returned (a bare id) -- no nested listing card is
-- embedded, so a paused/draft featured listing can never leak through this
-- projection.
create or replace function public.get_shop_detail(
  p_slug text
)
returns table (
  shop_id uuid,
  requested_slug text,
  current_slug text,
  is_current_slug boolean,
  name text,
  description text,
  logo_storage_path text,
  messenger_link text,
  shop_status public.shop_status_enum,
  is_trusted_seller boolean,
  member_since timestamptz,
  province_name text,
  city_name text,
  barangay_name text,
  review_count bigint,
  average_rating numeric,
  completed_order_count bigint,
  active_listing_count bigint,
  featured_listing_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_slug text;
  v_shop_id uuid;
begin
  v_requested_slug := nullif(btrim(p_slug), '');

  if v_requested_slug is null then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== visibility gate: historical-slug resolution + shop-suspension =====================
  select ss.shop_id into v_shop_id
    from public.shop_slugs ss
    join public.shops s on s.id = ss.shop_id
    where ss.slug = v_requested_slug
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      );

  if v_shop_id is null then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  return query
    select
      s.id as shop_id,
      v_requested_slug as requested_slug,
      s.slug as current_slug,
      (v_requested_slug = s.slug) as is_current_slug,
      s.name,
      s.description,
      s.logo_storage_path,
      s.messenger_link,
      s.status as shop_status,
      s.is_trusted_seller,
      s.created_at as member_since,
      prov.name as province_name,
      city.name as city_name,
      bgy.name as barangay_name,
      coalesce(rv.review_count, 0) as review_count,
      rv.average_rating,
      coalesce(ord.completed_order_count, 0) as completed_order_count,
      coalesce(lst.active_listing_count, 0) as active_listing_count,
      s.featured_listing_id
    from public.shops s
    join public.provinces prov on prov.id = s.province_id
    join public.cities_municipalities city on city.id = s.city_id
    left join public.barangays bgy on bgy.id = s.barangay_id
    left join lateral (
      select count(*) as review_count, avg(r.rating)::numeric as average_rating
      from public.reviews r
      where r.shop_id = s.id
    ) rv on true
    left join lateral (
      select count(*) as completed_order_count
      from public.orders o
      where o.shop_id = s.id and o.status = 'completed'
    ) ord on true
    left join lateral (
      select count(*) as active_listing_count
      from public.listings l
      where l.shop_id = s.id and l.status = 'available'
    ) lst on true
    where s.id = v_shop_id;
end;
$$;

revoke all on function public.get_shop_detail(text) from public;
grant execute on function public.get_shop_detail(text) to anon;
grant execute on function public.get_shop_detail(text) to authenticated;
