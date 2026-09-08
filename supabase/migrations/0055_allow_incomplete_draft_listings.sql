-- Seller Listing Management, canonical correction: Draft listings may be
-- incomplete (locked product decision, documented in PRD 10.6 / ARCHITECTURE
-- "Draft vs publish validation boundary" / ARCHITECTURE_ESSENTIALS / AGENTS.md
-- / CLAUDE.md). Strict completeness validation belongs at the draft ->
-- available (publish) transition, not at draft creation. This migration
-- corrects create_listing (0054) accordingly and makes the minimal schema
-- change required to make that possible.
--
-- Why 0054 is not edited in place
-- -----------------------------------------------------------------------
-- 0054_create_listing_rpc.sql was already applied live before this
-- correction was requested. Editing an already-applied migration file in
-- place is exactly the mistake 0050_shop_setup_custom_slug.sql's own header
-- already documents and corrects for this project (0049 was restored
-- verbatim to what was actually applied; the slug-customization delta got
-- its own properly-versioned file instead) -- the identical location data
-- correction (0051 kept untouched, 0052 as the new source of truth) follows
-- the same rule. 0054's file is therefore left byte-for-byte untouched; this
-- migration is create_listing's corrected home. create_listing's parameter
-- LIST (names, types, order, count) is completely unchanged from 0054 --
-- only column nullability and the function body's validation logic change --
-- so this is CREATE OR REPLACE FUNCTION against the identical signature, not
-- a DROP + re-create under a new signature (Postgres identifies a function
-- by name + parameter TYPE list, which has not changed).
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0054_create_listing_rpc (confirmed live via
-- list_migrations, no drift). Live column nullability confirmed via
-- information_schema.columns immediately before writing this file:
-- category_id, listing_type, condition, price_cents, province_id, city_id
-- are all `not null` with no column default -- these six structurally
-- prevent an incomplete draft today and are the only columns this migration
-- relaxes. title and description are also `not null` with no default, but
-- are deliberately NOT relaxed here -- see "Title/description" below.
-- stock_quantity is `not null default 1` -- already tolerates omission via
-- its own column default, needs no change. 0 shops/listings/listing_images
-- confirmed live (still true -- no data exists yet, so this ALTER TABLE has
-- no existing rows to reconcile).
--
-- Schema change: the smallest justified one
-- -----------------------------------------------------------------------
-- `alter table listings alter column X drop not null` for exactly the six
-- columns above. No CHECK constraint is touched or redefined -- every
-- existing CHECK on this table already evaluates to NULL (which Postgres
-- treats as satisfied, not a violation) when one or more of its referenced
-- columns is NULL, and only evaluates to a hard FALSE when a genuine,
-- fully-known mismatch exists. Verified for each one by hand:
--   listings_type_condition_check: with either listing_type or condition
--     NULL, both OR-branches evaluate to NULL or FALSE-via-short-circuit,
--     never a false-positive FALSE -- passes. With both genuinely known and
--     mismatched (e.g. brand_new + fair), both branches evaluate FALSE --
--     correctly rejected. Cross-validation "when both are known" therefore
--     falls out of the existing CHECK's own three-valued logic; the RPC's
--     own pre-check below only needs to additionally gate on both being
--     non-null before comparing them.
--   listings_fair_requires_known_flaws_check: with condition NULL, the
--     `condition <> 'fair'` operand is NULL, and `NULL OR anything-except-
--     TRUE` is NULL (not a violation) regardless of known_flaws -- Fair's
--     requirement only ever fires when condition is genuinely 'fair'.
--   listings_price_cents_check / listings_original_price_check: NULL
--     price_cents/original_price_cents make their respective CHECK operands
--     NULL, never FALSE -- both already no-op correctly on an unset value.
-- No new CHECK, trigger, or index is added or removed. RLS is unaffected
-- (still zero client policies on listings/listing_images/
-- listing_fulfillment_methods/listing_vehicle_details/
-- listing_rental_details -- create_listing remains the only write path).
--
-- Title / description: deliberately NOT relaxed -- a reported ambiguity,
-- not a silent decision
-- -----------------------------------------------------------------------
-- The locked product decision's own enumerated "a Draft may temporarily
-- have" list (both when first stated, and as repeated in this correction
-- task's own field list) never includes title or description -- only
-- images, price, category, condition, listing type, fulfillment methods,
-- complete location, and vehicle/rental detail are named. PRD 10.6's own
-- prose ("None of them are required to create or save a Draft") is broader
-- than that enumerated list, since it refers back to ALL of 10.1's field
-- list, which includes Product title and Description -- an inconsistency
-- this migration does not attempt to silently resolve by picking the
-- broader reading. Given (a) neither locked enumeration ever named title or
-- description, (b) both remain schema `not null` today, and (c) a listing
-- row with no title at all would be unidentifiable in a future "My
-- Listings" list, this migration treats title AND description as the
-- floor: still required to create a Draft, matching this task's own
-- suggested default for title ("may remain the minimum required field").
-- Reported explicitly, not decided silently -- see this task's own report
-- for the recommended small follow-up doc clarification.
--
-- Location: partial states are ordered top-down, not sparse
-- -----------------------------------------------------------------------
-- "Validated for whichever location ids are present, without forcing
-- complete province/city/barangay" is implemented as: no location at all,
-- OR province alone, OR province+city, OR province+city+barangay are all
-- valid partial states; city-without-province and barangay-without-city are
-- rejected explicitly by the RPC (CITY_REQUIRES_PROVINCE /
-- BARANGAY_REQUIRES_CITY) rather than silently accepted. This is a
-- necessary RPC-level rule, not merely a preference: the composite FKs
-- (listings_city_province_fkey / listings_barangay_city_fkey) use Postgres's
-- default MATCH SIMPLE semantics, under which a multi-column FK is skipped
-- entirely the moment ANY of its own columns is NULL -- so a row with
-- city_id set and province_id NULL would not be caught by the database FK
-- at all. Rejecting that shape explicitly at the RPC keeps "a city always
-- has a real, consistent province" true for every stored row, exactly as
-- every other location-bearing table in this schema already guarantees.
--
-- Category-gated vehicle/rental JSON when category itself is unknown
-- -----------------------------------------------------------------------
-- "Vehicle JSON accepted only for cars/motorcycles when category is known"
-- / "rental JSON accepted only for For Rent when category is known" is
-- implemented literally: when p_category_id is NULL, both
-- v_is_vehicle_category and v_is_rental_category are false, so supplying
-- either detail object without a category is rejected by the same
-- VEHICLE_DETAILS_NOT_ALLOWED / RENTAL_DETAILS_NOT_ALLOWED codes 0054
-- already used for a category mismatch -- category-unknown is treated as a
-- (currently) non-vehicle, non-rental category, not as "anything goes."
--
-- Fulfillment / images: minimum-cardinality requirements removed, per-item
-- validation kept
-- -----------------------------------------------------------------------
-- FULFILLMENT_REQUIRED and IMAGE_REQUIRED are removed -- a Draft may have
-- zero fulfillment methods and zero images. Everything that validates a
-- SUPPLIED value is unchanged: duplicate fulfillment methods are still
-- rejected when two or more are given; each supplied image path is still
-- validated to belong to auth.uid() under listing-images; at most 8 images
-- is still enforced; submitted image order is still preserved as position
-- 0..N-1. Cover image assignment is now conditional: with zero images,
-- cover_image_id is simply never touched by this function and stays NULL
-- (its natural post-INSERT state, since the initial INSERT never sets it);
-- with one or more images, the image at position 0 is still deterministically
-- assigned as cover, exactly as 0054 already did.
--
-- Atomicity/security: unchanged from 0054 -- SECURITY DEFINER,
-- set search_path = '', REVOKE ALL FROM public/anon, GRANT EXECUTE TO
-- authenticated only, no client-supplied owner/public_code/slug/status/
-- cover_image_id, one implicit transaction per call, zero references to
-- orders/order_items/inventory_reservations.

alter table listings
  alter column category_id drop not null,
  alter column listing_type drop not null,
  alter column condition drop not null,
  alter column price_cents drop not null,
  alter column province_id drop not null,
  alter column city_id drop not null;

create or replace function public.create_listing(
  p_title text default null,
  p_description text default null,
  p_category_id integer default null,
  p_listing_type public.listing_type_enum default null,
  p_condition public.listing_condition_enum default null,
  p_price_cents bigint default null,
  p_original_price_cents bigint default null,
  p_is_negotiable boolean default false,
  p_brand text default null,
  p_known_flaws text default null,
  p_stock_quantity integer default 1,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_meetup_note text default null,
  p_fulfillment_methods public.fulfillment_method_enum[] default null,
  p_image_paths text[] default null,
  p_vehicle_details jsonb default null,
  p_rental_details jsonb default null
)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  status public.listing_status_enum,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_shop_id uuid;
  v_title text;
  v_description text;
  v_category_slug text;
  v_is_vehicle_category boolean;
  v_is_rental_category boolean;
  v_brand text;
  v_known_flaws text;
  v_meetup_note text;
  v_image_count integer;
  v_path text;
  v_fulfillment_count integer;
  v_slug text;
  v_public_code text;
  v_now timestamptz;
  v_listing_id uuid;
  v_created_at timestamptz;
  v_cover_image_id uuid;
  v_constraint_name text;
  v_vehicle_brand text;
  v_vehicle_model text;
  v_vehicle_year smallint;
  v_vehicle_mileage_km integer;
  v_vehicle_transmission text;
  v_vehicle_fuel_type text;
  v_vehicle_registration_status public.vehicle_registration_status_enum;
  v_vehicle_documents text[];
  v_rental_price_cents bigint;
  v_rental_period public.rental_period_enum;
  v_rental_security_deposit_cents bigint;
  v_rental_terms text;
  v_rental_minimum_period text;
  v_rental_capacity integer;
  v_rental_whats_included text;
  v_rental_rules_restrictions text;
  v_rental_availability public.rental_availability_enum;
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
    raise exception 'You are not able to create listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== title / description (still required -- see this migration's header) =====================
  v_title := nullif(btrim(p_title), '');
  if v_title is null then
    raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
  end if;

  v_description := nullif(btrim(p_description), '');
  if v_description is null then
    raise exception 'Listing description is required.' using detail = 'DESCRIPTION_REQUIRED';
  end if;

  -- ===================== category (optional; validated + resolved only when supplied) =====================
  if p_category_id is not null then
    select c.slug into v_category_slug
      from public.categories c
      where c.id = p_category_id;

    if not found then
      raise exception 'Selected category does not exist.' using detail = 'CATEGORY_NOT_FOUND';
    end if;

    v_is_vehicle_category := v_category_slug in ('cars', 'motorcycles');
    v_is_rental_category := v_category_slug = 'for-rent';
  else
    v_is_vehicle_category := false;
    v_is_rental_category := false;
  end if;

  -- ===================== listing type / condition (optional; cross-validated only when both known) =====================
  if p_listing_type is not null and p_condition is not null then
    if p_listing_type = 'brand_new' and p_condition <> 'brand_new' then
      raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;

    if p_listing_type = 'preloved' and p_condition = 'brand_new' then
      raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;
  end if;

  -- ===================== known flaws (required only when condition is actually Fair) =====================
  v_known_flaws := nullif(btrim(p_known_flaws), '');
  if p_condition = 'fair' and v_known_flaws is null then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price (optional; validated only when supplied) =====================
  if p_price_cents is not null and p_price_cents < 0 then
    raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
  end if;

  if p_original_price_cents is not null and p_price_cents is not null and p_original_price_cents < p_price_cents then
    raise exception 'Original price must not be lower than the current price.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  -- ===================== stock quantity (defaults to 1; validated only when explicitly supplied) =====================
  if p_stock_quantity is not null and p_stock_quantity < 1 then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location (fully optional; partial states validated top-down) =====================
  if p_city_id is not null and p_province_id is null then
    raise exception 'City requires province to also be specified.' using detail = 'CITY_REQUIRES_PROVINCE';
  end if;

  if p_barangay_id is not null and p_city_id is null then
    raise exception 'Barangay requires city to also be specified.' using detail = 'BARANGAY_REQUIRES_CITY';
  end if;

  if p_province_id is not null and p_city_id is not null and not exists (
    select 1 from public.cities_municipalities c
    where c.id = p_city_id and c.province_id = p_province_id
  ) then
    raise exception 'Selected city does not belong to the selected province.' using detail = 'INVALID_CITY_FOR_PROVINCE';
  end if;

  if p_barangay_id is not null and p_city_id is not null and not exists (
    select 1 from public.barangays b
    where b.id = p_barangay_id and b.city_id = p_city_id
  ) then
    raise exception 'Selected barangay does not belong to the selected city.' using detail = 'INVALID_BARANGAY_FOR_CITY';
  end if;

  -- ===================== optional plain fields =====================
  v_brand := nullif(btrim(p_brand), '');
  v_meetup_note := nullif(btrim(p_meetup_note), '');

  -- ===================== fulfillment methods (optional; deduplicated only when supplied) =====================
  v_fulfillment_count := coalesce(array_length(p_fulfillment_methods, 1), 0);

  if v_fulfillment_count > 0
     and v_fulfillment_count <> (select count(distinct m) from unnest(p_fulfillment_methods) m) then
    raise exception 'Duplicate fulfillment method selected.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== images (optional, 0-8; ownership-validated for whichever are supplied) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 8 then
    raise exception 'A listing may have at most 8 photos.' using detail = 'TOO_MANY_LISTING_IMAGES';
  end if;

  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null
         or v_path !~ '[^[:space:]]'
         or v_path !~ ('^listing-images/' || v_caller::text || '/') then
        raise exception 'One or more listing photos are invalid.' using detail = 'LISTING_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== vehicle details (optional; only for Cars/Motorcycles, only when category known) =====================
  if p_vehicle_details is not null then
    if not v_is_vehicle_category then
      raise exception 'Vehicle details are only allowed for Cars/Motorcycles listings.' using detail = 'VEHICLE_DETAILS_NOT_ALLOWED';
    end if;

    if jsonb_typeof(p_vehicle_details) <> 'object' then
      raise exception 'Vehicle details must be a JSON object.' using detail = 'VEHICLE_DETAILS_INVALID';
    end if;

    if p_vehicle_details ? 'brand' then
      if jsonb_typeof(p_vehicle_details -> 'brand') <> 'string' then
        raise exception 'Vehicle brand must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_brand := nullif(btrim(p_vehicle_details ->> 'brand'), '');
    end if;

    if p_vehicle_details ? 'model' then
      if jsonb_typeof(p_vehicle_details -> 'model') <> 'string' then
        raise exception 'Vehicle model must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_model := nullif(btrim(p_vehicle_details ->> 'model'), '');
    end if;

    if p_vehicle_details ? 'year' then
      if jsonb_typeof(p_vehicle_details -> 'year') <> 'number' then
        raise exception 'Vehicle year must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_year := (p_vehicle_details ->> 'year')::smallint;
      if v_vehicle_year < 1900 then
        raise exception 'Vehicle year is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
    end if;

    if p_vehicle_details ? 'mileage_km' then
      if jsonb_typeof(p_vehicle_details -> 'mileage_km') <> 'number' then
        raise exception 'Vehicle mileage must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_mileage_km := (p_vehicle_details ->> 'mileage_km')::integer;
      if v_vehicle_mileage_km < 0 then
        raise exception 'Vehicle mileage is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
    end if;

    if p_vehicle_details ? 'transmission' then
      if jsonb_typeof(p_vehicle_details -> 'transmission') <> 'string' then
        raise exception 'Vehicle transmission must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_transmission := nullif(btrim(p_vehicle_details ->> 'transmission'), '');
    end if;

    if p_vehicle_details ? 'fuel_type' then
      if jsonb_typeof(p_vehicle_details -> 'fuel_type') <> 'string' then
        raise exception 'Vehicle fuel type must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_fuel_type := nullif(btrim(p_vehicle_details ->> 'fuel_type'), '');
    end if;

    if p_vehicle_details ? 'registration_status' then
      if jsonb_typeof(p_vehicle_details -> 'registration_status') <> 'string'
         or (p_vehicle_details ->> 'registration_status') not in ('registered', 'expired_registration', 'for_renewal') then
        raise exception 'Vehicle registration status is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_registration_status := (p_vehicle_details ->> 'registration_status')::public.vehicle_registration_status_enum;
    end if;

    if p_vehicle_details ? 'documents_available' then
      if jsonb_typeof(p_vehicle_details -> 'documents_available') <> 'array'
         or exists (
           select 1 from jsonb_array_elements(p_vehicle_details -> 'documents_available') e
           where jsonb_typeof(e) <> 'string'
         ) then
        raise exception 'Vehicle documents must be a list of text values.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      select array_agg(doc) into v_vehicle_documents
        from jsonb_array_elements_text(p_vehicle_details -> 'documents_available') as doc;
    end if;
  end if;

  -- ===================== rental details (optional; only for For Rent, only when category known) =====================
  if p_rental_details is not null then
    if not v_is_rental_category then
      raise exception 'Rental details are only allowed for For Rent listings.' using detail = 'RENTAL_DETAILS_NOT_ALLOWED';
    end if;

    if jsonb_typeof(p_rental_details) <> 'object' then
      raise exception 'Rental details must be a JSON object.' using detail = 'RENTAL_DETAILS_INVALID';
    end if;

    if p_rental_details ? 'rental_price_cents' then
      if jsonb_typeof(p_rental_details -> 'rental_price_cents') <> 'number' then
        raise exception 'Rental price must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_price_cents := (p_rental_details ->> 'rental_price_cents')::bigint;
      if v_rental_price_cents < 0 then
        raise exception 'Rental price is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
    end if;

    if p_rental_details ? 'rental_period' then
      if jsonb_typeof(p_rental_details -> 'rental_period') <> 'string'
         or (p_rental_details ->> 'rental_period') not in ('daily', 'weekly', 'monthly', 'other') then
        raise exception 'Rental period is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_period := (p_rental_details ->> 'rental_period')::public.rental_period_enum;
    end if;

    if p_rental_details ? 'security_deposit_cents' then
      if jsonb_typeof(p_rental_details -> 'security_deposit_cents') <> 'number' then
        raise exception 'Security deposit must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_security_deposit_cents := (p_rental_details ->> 'security_deposit_cents')::bigint;
      if v_rental_security_deposit_cents < 0 then
        raise exception 'Security deposit is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
    end if;

    if p_rental_details ? 'rental_terms' then
      if jsonb_typeof(p_rental_details -> 'rental_terms') <> 'string' then
        raise exception 'Rental terms must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_terms := nullif(btrim(p_rental_details ->> 'rental_terms'), '');
    end if;

    if p_rental_details ? 'minimum_rental_period' then
      if jsonb_typeof(p_rental_details -> 'minimum_rental_period') <> 'string' then
        raise exception 'Minimum rental period must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_minimum_period := nullif(btrim(p_rental_details ->> 'minimum_rental_period'), '');
    end if;

    if p_rental_details ? 'capacity' then
      if jsonb_typeof(p_rental_details -> 'capacity') <> 'number' then
        raise exception 'Capacity must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_capacity := (p_rental_details ->> 'capacity')::integer;
      if v_rental_capacity <= 0 then
        raise exception 'Capacity is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
    end if;

    if p_rental_details ? 'whats_included' then
      if jsonb_typeof(p_rental_details -> 'whats_included') <> 'string' then
        raise exception 'What''s included must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_whats_included := nullif(btrim(p_rental_details ->> 'whats_included'), '');
    end if;

    if p_rental_details ? 'rules_restrictions' then
      if jsonb_typeof(p_rental_details -> 'rules_restrictions') <> 'string' then
        raise exception 'Rules/restrictions must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_rules_restrictions := nullif(btrim(p_rental_details ->> 'rules_restrictions'), '');
    end if;

    if p_rental_details ? 'availability' then
      if jsonb_typeof(p_rental_details -> 'availability') <> 'string'
         or (p_rental_details ->> 'availability') not in ('available', 'unavailable', 'paused') then
        raise exception 'Rental availability is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_availability := (p_rental_details ->> 'availability')::public.rental_availability_enum;
    else
      v_rental_availability := 'available';
    end if;
  end if;

  -- ===================== slug: derived from title, same normalization as generate_unique_shop_slug =====================
  v_slug := lower(regexp_replace(btrim(v_title), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');
  if v_slug = '' or v_slug is null then
    v_slug := 'listing';
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  -- ===================== insert the listing (draft only, may be incomplete; public_code generated + retried on collision) =====================
  loop
    v_public_code := 'PSL-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));

    begin
      insert into public.listings as l (
        shop_id, category_id, title, slug, public_code, listing_type, condition,
        known_flaws, description, brand, price_cents, is_negotiable, original_price_cents,
        stock_quantity, province_id, city_id, barangay_id, meetup_note, status,
        created_at, updated_at
      )
      values (
        v_shop_id, p_category_id, v_title, v_slug, v_public_code, p_listing_type, p_condition,
        v_known_flaws, v_description, v_brand, p_price_cents, coalesce(p_is_negotiable, false), p_original_price_cents,
        coalesce(p_stock_quantity, 1), p_province_id, p_city_id, p_barangay_id, v_meetup_note, 'draft',
        v_now, v_now
      )
      returning l.id, l.created_at into v_listing_id, v_created_at;

      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name <> 'listings_public_code_key' then
          raise;
        end if;
        -- otherwise: a same-instant public_code collision -- loop and retry
        -- with a freshly generated code.
    end;
  end loop;

  -- ===================== fulfillment methods (only if any were supplied) =====================
  if v_fulfillment_count > 0 then
    insert into public.listing_fulfillment_methods (listing_id, method)
      select v_listing_id, m from unnest(p_fulfillment_methods) as m;
  end if;

  -- ===================== images, preserving submitted order as position 0..N-1 (only if any were supplied) =====================
  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.listing_images (listing_id, storage_path, position, is_reference_image)
        values (v_listing_id, p_image_paths[i], i - 1, false);
    end loop;

    -- ===================== deterministic cover image: the first submitted photo. Zero images => cover_image_id stays NULL. =====================
    select li.id into v_cover_image_id
      from public.listing_images li
      where li.listing_id = v_listing_id and li.position = 0;

    update public.listings as l
      set cover_image_id = v_cover_image_id
      where l.id = v_listing_id;
  end if;

  -- ===================== vehicle details =====================
  if p_vehicle_details is not null then
    insert into public.listing_vehicle_details (
      listing_id, brand, model, year, mileage_km, transmission, fuel_type,
      registration_status, documents_available, created_at, updated_at
    )
    values (
      v_listing_id, v_vehicle_brand, v_vehicle_model, v_vehicle_year, v_vehicle_mileage_km,
      v_vehicle_transmission, v_vehicle_fuel_type, v_vehicle_registration_status,
      v_vehicle_documents, v_now, v_now
    );
  end if;

  -- ===================== rental details =====================
  if p_rental_details is not null then
    insert into public.listing_rental_details (
      listing_id, rental_price_cents, rental_period, security_deposit_cents, rental_terms,
      minimum_rental_period, capacity, whats_included, rules_restrictions, availability,
      created_at, updated_at
    )
    values (
      v_listing_id, v_rental_price_cents, v_rental_period, v_rental_security_deposit_cents, v_rental_terms,
      v_rental_minimum_period, v_rental_capacity, v_rental_whats_included, v_rental_rules_restrictions,
      v_rental_availability, v_now, v_now
    );
  end if;

  return query
    select v_listing_id, v_public_code, v_slug, 'draft'::public.listing_status_enum, v_created_at;
end;
$$;

revoke all on function public.create_listing(
  text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean, text, text,
  integer, integer, integer, integer, text, public.fulfillment_method_enum[], text[], jsonb, jsonb
) from public;

revoke all on function public.create_listing(
  text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean, text, text,
  integer, integer, integer, integer, text, public.fulfillment_method_enum[], text[], jsonb, jsonb
) from anon;

grant execute on function public.create_listing(
  text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean, text, text,
  integer, integer, integer, integer, text, public.fulfillment_method_enum[], text[], jsonb, jsonb
) to authenticated;
