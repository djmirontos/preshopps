-- Seller Listing Management, canonical correction: closes a validation gap
-- in original_price_cents. listings_original_price_check (0008: `check
-- (original_price_cents is null or original_price_cents >= price_cents)`)
-- evaluates to NULL (satisfied, not violated) under PostgreSQL three-valued
-- logic whenever price_cents itself is NULL -- so a negative
-- original_price_cents could be stored as long as price_cents was null at
-- the same time, and neither create_listing (0056) nor update_listing
-- (0061) had a standalone check catching that case: both only ever compared
-- original_price_cents against price_cents when BOTH were non-null. Product
-- decision, as directed: whenever original_price_cents is supplied/non-null
-- at all, it must independently be >= 0, regardless of whether price_cents
-- is null; the existing "original >= price when both are known" rule is
-- unchanged and preserved verbatim.
--
-- Why 0054-0061 are not edited in place
-- -----------------------------------------------------------------------
-- All are already applied live. Per this project's repeatedly-established
-- rule (0050/0055/0056/0058/0061's own headers for the identical
-- situation), an already-applied migration file is never edited -- a
-- correction gets its own new file. create_listing's parameter list (0056)
-- and update_listing's parameter list (0061, p_listing_id uuid, p_patch
-- jsonb) are both completely unchanged here, so both are CREATE OR REPLACE
-- FUNCTION against their identical current signatures, not a DROP +
-- re-create -- unlike 0061 itself, which had to change update_listing's
-- shape and therefore did need a DROP FUNCTION first.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0061 (update_listing_patch_contract, confirmed
-- live via list_migrations, no drift). Both create_listing and
-- update_listing were re-read in full immediately before writing this file;
-- every line below is copied verbatim from their current live bodies except
-- the one new check added to each (see below). Live data was checked before
-- deciding on the schema change: `select count(*), count(*) filter (where
-- original_price_cents is not null and original_price_cents < 0) from
-- public.listings` returned 0 total rows / 0 negative rows -- there is no
-- existing data that would violate a new CHECK, and no canonical or schema
-- reason was found for original_price_cents to ever legitimately be
-- negative (it is a price, like price_cents itself, which already has its
-- own `>= 0` CHECK from 0008). The new CHECK is therefore added as
-- defense-in-depth alongside the RPC-level fix, exactly as this task asked
-- to inspect and decide.
--
-- Schema change: the smallest justified one
-- -----------------------------------------------------------------------
-- A new, separate CHECK constraint,
-- `listings_original_price_non_negative_check`, is added rather than
-- redefining the existing listings_original_price_check (0008): the
-- existing constraint already correctly expresses "original_price_cents is
-- null OR original_price_cents >= price_cents" and is left completely
-- untouched; the new constraint independently expresses "original_price_cents
-- is null OR original_price_cents >= 0", closing exactly the three-valued-
-- logic gap described above without changing the meaning or behavior of the
-- existing constraint for any row where price_cents is non-null (in that
-- case the existing constraint alone already implies >= 0, since price_cents
-- itself is already >= 0 -- the new constraint only adds coverage for the
-- price_cents IS NULL case).
--
-- RPC changes, precisely scoped
-- -----------------------------------------------------------------------
-- create_listing: one new check, `if p_original_price_cents is not null and
-- p_original_price_cents < 0 then raise ORIGINAL_PRICE_INVALID`, inserted
-- immediately before the existing original-vs-price relational check (both
-- already share the same error code, matching 0059/0061's own reuse of
-- ORIGINAL_PRICE_INVALID for every original-price failure mode). Every
-- other 0056 rule -- title/description/category/type/condition/known_flaws/
-- price/stock/location/fulfillment/images/vehicle/rental, auth, shop
-- ownership, restrictions, public_code/slug generation, cover-image logic,
-- atomicity, grants -- is copied over completely unchanged.
--
-- update_listing: one new check evaluated on the FINAL merged
-- original-price value (not just a newly-supplied one, per this task's own
-- instruction), `if v_final_original_price_cents is not null and
-- v_final_original_price_cents < 0 then raise ORIGINAL_PRICE_INVALID`,
-- inserted immediately after v_final_original_price_cents is resolved
-- (omitted -> preserved; explicit JSON null -> cleared to NULL, unchanged;
-- supplied -> cast) and before the existing original-vs-final-price
-- relational check. An explicit JSON null therefore still passes through as
-- a valid clear (the new check only ever fires when the final value is
-- non-null), and every other 0061 rule -- omitted/set/clear semantics for
-- every other field, the location-clearing cascade, fulfillment whole-set
-- replace, vehicle/rental omitted/clear/upsert, Draft-only gating, ownership,
-- restrictions, final-state validation, public_code immutability, slug
-- regeneration only on an actual title change, atomicity, grants -- is
-- copied over completely unchanged.
--
-- Not touched, per this task's own scope: replace_listing_images (no
-- original-price field exists there at all), publish_listing (its own
-- price/original-price handling was never in scope for this gap and needed
-- no change -- publish_listing does not re-validate original_price_cents at
-- all today, and this task does not ask it to start), any frontend, any
-- order/order_item logic, and post-publish editing.
--
-- Security: both functions remain SECURITY DEFINER, set search_path = '',
-- REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only,
-- unchanged from their current live definitions.

alter table public.listings
  add constraint listings_original_price_non_negative_check
    check (original_price_cents is null or original_price_cents >= 0);

-- ============================================================
-- create_listing (adds the original-price non-negative check only)
-- ============================================================
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

  -- ===================== title (required -- the one deliberate Draft floor) =====================
  v_title := nullif(btrim(p_title), '');
  if v_title is null then
    raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
  end if;

  -- ===================== description (optional while Draft; blank normalizes to NULL; required at publish) =====================
  v_description := nullif(btrim(p_description), '');

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

  -- ===================== original price: independently non-negative whenever supplied, regardless of whether price is known =====================
  if p_original_price_cents is not null and p_original_price_cents < 0 then
    raise exception 'Original price is invalid.' using detail = 'ORIGINAL_PRICE_INVALID';
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

-- ============================================================
-- update_listing (adds the original-price non-negative check only, evaluated on the FINAL merged value)
-- ============================================================
create or replace function public.update_listing(
  p_listing_id uuid,
  p_patch jsonb default '{}'::jsonb
)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  status public.listing_status_enum,
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
  v_listing_status public.listing_status_enum;
  v_patch jsonb;
  v_title text;
  v_description text;
  v_category_id integer;
  v_listing_type public.listing_type_enum;
  v_condition public.listing_condition_enum;
  v_known_flaws text;
  v_brand text;
  v_price_cents bigint;
  v_original_price_cents bigint;
  v_is_negotiable boolean;
  v_stock_quantity integer;
  v_province_id integer;
  v_city_id integer;
  v_barangay_id integer;
  v_meetup_note text;
  v_public_code text;
  v_slug text;
  v_final_title text;
  v_final_description text;
  v_final_category_id integer;
  v_final_category_slug text;
  v_final_is_vehicle_category boolean;
  v_final_is_rental_category boolean;
  v_final_listing_type public.listing_type_enum;
  v_final_condition public.listing_condition_enum;
  v_final_known_flaws text;
  v_final_brand text;
  v_final_price_cents bigint;
  v_final_original_price_cents bigint;
  v_final_is_negotiable boolean;
  v_final_stock_quantity integer;
  v_final_province_id integer;
  v_final_city_id integer;
  v_final_barangay_id integer;
  v_final_meetup_note text;
  v_final_slug text;
  v_fulfillment_touched boolean;
  v_final_fulfillment_methods public.fulfillment_method_enum[];
  v_fulfillment_count integer;
  v_vehicle_patch jsonb;
  v_rental_patch jsonb;
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
  v_updated_at timestamptz;
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
    raise exception 'You are not able to edit listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.shop_id, l.status, l.title, l.description, l.category_id, l.listing_type, l.condition,
         l.known_flaws, l.brand, l.price_cents, l.original_price_cents, l.is_negotiable,
         l.stock_quantity, l.province_id, l.city_id, l.barangay_id, l.meetup_note,
         l.public_code, l.slug
    into v_listing_shop_id, v_listing_status, v_title, v_description, v_category_id, v_listing_type, v_condition,
         v_known_flaws, v_brand, v_price_cents, v_original_price_cents, v_is_negotiable,
         v_stock_quantity, v_province_id, v_city_id, v_barangay_id, v_meetup_note,
         v_public_code, v_slug
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to edit this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  -- ===================== draft-only editing (see 0059's own header: post-publish editing is a canon-permitted, deliberately deferred follow-up) =====================
  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be edited with this operation.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  -- ===================== patch must be a JSON object =====================
  v_patch := coalesce(p_patch, '{}'::jsonb);
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Patch must be a JSON object.' using detail = 'PATCH_INVALID';
  end if;

  -- ===================== title: never clearable, must remain non-blank =====================
  if v_patch ? 'title' then
    if jsonb_typeof(v_patch -> 'title') <> 'string' then
      raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
    end if;
    v_final_title := nullif(btrim(v_patch ->> 'title'), '');
    if v_final_title is null then
      raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
    end if;
  else
    v_final_title := v_title;
  end if;

  -- ===================== description: nullable while draft, explicit JSON null clears it =====================
  if v_patch ? 'description' then
    if jsonb_typeof(v_patch -> 'description') = 'null' then
      v_final_description := null;
    else
      if jsonb_typeof(v_patch -> 'description') <> 'string' then
        raise exception 'Description must be text.' using detail = 'DESCRIPTION_INVALID';
      end if;
      v_final_description := nullif(btrim(v_patch ->> 'description'), '');
    end if;
  else
    v_final_description := v_description;
  end if;

  -- ===================== category: nullable, explicit JSON null clears it =====================
  if v_patch ? 'category_id' then
    if jsonb_typeof(v_patch -> 'category_id') = 'null' then
      v_final_category_id := null;
    else
      if jsonb_typeof(v_patch -> 'category_id') <> 'number' then
        raise exception 'Category is invalid.' using detail = 'CATEGORY_INVALID';
      end if;
      v_final_category_id := (v_patch ->> 'category_id')::integer;
    end if;
  else
    v_final_category_id := v_category_id;
  end if;

  if v_final_category_id is not null then
    select c.slug into v_final_category_slug
      from public.categories c
      where c.id = v_final_category_id;

    if not found then
      raise exception 'Selected category does not exist.' using detail = 'CATEGORY_NOT_FOUND';
    end if;

    v_final_is_vehicle_category := v_final_category_slug in ('cars', 'motorcycles');
    v_final_is_rental_category := v_final_category_slug = 'for-rent';
  else
    v_final_is_vehicle_category := false;
    v_final_is_rental_category := false;
  end if;

  -- ===================== listing type: nullable, explicit JSON null clears it =====================
  if v_patch ? 'listing_type' then
    if jsonb_typeof(v_patch -> 'listing_type') = 'null' then
      v_final_listing_type := null;
    else
      if jsonb_typeof(v_patch -> 'listing_type') <> 'string'
         or (v_patch ->> 'listing_type') not in ('preloved', 'brand_new') then
        raise exception 'Listing type is invalid.' using detail = 'LISTING_TYPE_INVALID';
      end if;
      v_final_listing_type := (v_patch ->> 'listing_type')::public.listing_type_enum;
    end if;
  else
    v_final_listing_type := v_listing_type;
  end if;

  -- ===================== condition: nullable, explicit JSON null clears it =====================
  if v_patch ? 'condition' then
    if jsonb_typeof(v_patch -> 'condition') = 'null' then
      v_final_condition := null;
    else
      if jsonb_typeof(v_patch -> 'condition') <> 'string'
         or (v_patch ->> 'condition') not in ('brand_new', 'like_new', 'very_good', 'good', 'fair') then
        raise exception 'Condition is invalid.' using detail = 'CONDITION_INVALID';
      end if;
      v_final_condition := (v_patch ->> 'condition')::public.listing_condition_enum;
    end if;
  else
    v_final_condition := v_condition;
  end if;

  -- ===================== listing type / condition, cross-validated on final merged state =====================
  if v_final_listing_type is not null and v_final_condition is not null then
    if v_final_listing_type = 'brand_new' and v_final_condition <> 'brand_new' then
      raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;

    if v_final_listing_type = 'preloved' and v_final_condition = 'brand_new' then
      raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;
  end if;

  -- ===================== known flaws: nullable, explicit JSON null clears it; evaluated against final condition =====================
  if v_patch ? 'known_flaws' then
    if jsonb_typeof(v_patch -> 'known_flaws') = 'null' then
      v_final_known_flaws := null;
    else
      if jsonb_typeof(v_patch -> 'known_flaws') <> 'string' then
        raise exception 'Known flaws must be text.' using detail = 'KNOWN_FLAWS_INVALID';
      end if;
      v_final_known_flaws := nullif(btrim(v_patch ->> 'known_flaws'), '');
    end if;
  else
    v_final_known_flaws := v_known_flaws;
  end if;

  if v_final_condition = 'fair' and v_final_known_flaws is null then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price: nullable, explicit JSON null clears it =====================
  if v_patch ? 'price_cents' then
    if jsonb_typeof(v_patch -> 'price_cents') = 'null' then
      v_final_price_cents := null;
    else
      if jsonb_typeof(v_patch -> 'price_cents') <> 'number' then
        raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
      end if;
      v_final_price_cents := (v_patch ->> 'price_cents')::bigint;
      if v_final_price_cents < 0 then
        raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
      end if;
    end if;
  else
    v_final_price_cents := v_price_cents;
  end if;

  -- ===================== original price: nullable, explicit JSON null clears it; independently non-negative whenever the FINAL value is non-null =====================
  if v_patch ? 'original_price_cents' then
    if jsonb_typeof(v_patch -> 'original_price_cents') = 'null' then
      v_final_original_price_cents := null;
    else
      if jsonb_typeof(v_patch -> 'original_price_cents') <> 'number' then
        raise exception 'Original price is invalid.' using detail = 'ORIGINAL_PRICE_INVALID';
      end if;
      v_final_original_price_cents := (v_patch ->> 'original_price_cents')::bigint;
    end if;
  else
    v_final_original_price_cents := v_original_price_cents;
  end if;

  if v_final_original_price_cents is not null and v_final_original_price_cents < 0 then
    raise exception 'Original price is invalid.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  if v_final_original_price_cents is not null and v_final_price_cents is not null
     and v_final_original_price_cents < v_final_price_cents then
    raise exception 'Original price must not be lower than the current price.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  -- ===================== is_negotiable: NOT NULL column, cannot be cleared =====================
  if v_patch ? 'is_negotiable' then
    if jsonb_typeof(v_patch -> 'is_negotiable') <> 'boolean' then
      raise exception 'Negotiable flag is invalid.' using detail = 'IS_NEGOTIABLE_INVALID';
    end if;
    v_final_is_negotiable := (v_patch ->> 'is_negotiable')::boolean;
  else
    v_final_is_negotiable := v_is_negotiable;
  end if;

  -- ===================== stock quantity: cannot be cleared, must remain >= 1 =====================
  if v_patch ? 'stock_quantity' then
    if jsonb_typeof(v_patch -> 'stock_quantity') <> 'number' then
      raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
    end if;
    v_final_stock_quantity := (v_patch ->> 'stock_quantity')::integer;
  else
    v_final_stock_quantity := v_stock_quantity;
  end if;

  if v_final_stock_quantity is null or v_final_stock_quantity < 1 then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location: each level nullable, explicit JSON null clears it =====================
  if v_patch ? 'province_id' then
    if jsonb_typeof(v_patch -> 'province_id') = 'null' then
      v_final_province_id := null;
    else
      if jsonb_typeof(v_patch -> 'province_id') <> 'number' then
        raise exception 'Province is invalid.' using detail = 'PROVINCE_INVALID';
      end if;
      v_final_province_id := (v_patch ->> 'province_id')::integer;
    end if;
  else
    v_final_province_id := v_province_id;
  end if;

  if v_patch ? 'city_id' then
    if jsonb_typeof(v_patch -> 'city_id') = 'null' then
      v_final_city_id := null;
    else
      if jsonb_typeof(v_patch -> 'city_id') <> 'number' then
        raise exception 'City/municipality is invalid.' using detail = 'CITY_INVALID';
      end if;
      v_final_city_id := (v_patch ->> 'city_id')::integer;
    end if;
  else
    v_final_city_id := v_city_id;
    -- cascade: province was cleared and the caller did not itself touch city_id
    if v_final_province_id is null then
      v_final_city_id := null;
    end if;
  end if;

  if v_patch ? 'barangay_id' then
    if jsonb_typeof(v_patch -> 'barangay_id') = 'null' then
      v_final_barangay_id := null;
    else
      if jsonb_typeof(v_patch -> 'barangay_id') <> 'number' then
        raise exception 'Barangay is invalid.' using detail = 'BARANGAY_INVALID';
      end if;
      v_final_barangay_id := (v_patch ->> 'barangay_id')::integer;
    end if;
  else
    v_final_barangay_id := v_barangay_id;
    -- cascade: city ended up null (explicitly or via the province cascade above) and the caller did not itself touch barangay_id
    if v_final_city_id is null then
      v_final_barangay_id := null;
    end if;
  end if;

  if v_final_city_id is not null and v_final_province_id is null then
    raise exception 'City requires province to also be specified.' using detail = 'CITY_REQUIRES_PROVINCE';
  end if;

  if v_final_barangay_id is not null and v_final_city_id is null then
    raise exception 'Barangay requires city to also be specified.' using detail = 'BARANGAY_REQUIRES_CITY';
  end if;

  if v_final_province_id is not null and v_final_city_id is not null and not exists (
    select 1 from public.cities_municipalities c
    where c.id = v_final_city_id and c.province_id = v_final_province_id
  ) then
    raise exception 'Selected city does not belong to the selected province.' using detail = 'INVALID_CITY_FOR_PROVINCE';
  end if;

  if v_final_barangay_id is not null and v_final_city_id is not null and not exists (
    select 1 from public.barangays b
    where b.id = v_final_barangay_id and b.city_id = v_final_city_id
  ) then
    raise exception 'Selected barangay does not belong to the selected city.' using detail = 'INVALID_BARANGAY_FOR_CITY';
  end if;

  -- ===================== brand: nullable, explicit JSON null clears it =====================
  if v_patch ? 'brand' then
    if jsonb_typeof(v_patch -> 'brand') = 'null' then
      v_final_brand := null;
    else
      if jsonb_typeof(v_patch -> 'brand') <> 'string' then
        raise exception 'Brand must be text.' using detail = 'BRAND_INVALID';
      end if;
      v_final_brand := nullif(btrim(v_patch ->> 'brand'), '');
    end if;
  else
    v_final_brand := v_brand;
  end if;

  -- ===================== meetup note: nullable, explicit JSON null clears it =====================
  if v_patch ? 'meetup_note' then
    if jsonb_typeof(v_patch -> 'meetup_note') = 'null' then
      v_final_meetup_note := null;
    else
      if jsonb_typeof(v_patch -> 'meetup_note') <> 'string' then
        raise exception 'Meetup note must be text.' using detail = 'MEETUP_NOTE_INVALID';
      end if;
      v_final_meetup_note := nullif(btrim(v_patch ->> 'meetup_note'), '');
    end if;
  else
    v_final_meetup_note := v_meetup_note;
  end if;

  -- ===================== fulfillment methods: whole-set replace, only when the key is present (including an explicit empty array) =====================
  if v_patch ? 'fulfillment_methods' then
    if jsonb_typeof(v_patch -> 'fulfillment_methods') <> 'array' then
      raise exception 'Fulfillment methods must be a list.' using detail = 'FULFILLMENT_INVALID';
    end if;

    if exists (
      select 1 from jsonb_array_elements_text(v_patch -> 'fulfillment_methods') as m
      where m not in ('meetup', 'pickup', 'local_delivery', 'shipping')
    ) then
      raise exception 'Fulfillment methods contain an invalid value.' using detail = 'FULFILLMENT_INVALID';
    end if;

    select array_agg(m::public.fulfillment_method_enum) into v_final_fulfillment_methods
      from jsonb_array_elements_text(v_patch -> 'fulfillment_methods') as m;

    v_fulfillment_touched := true;
  else
    v_fulfillment_touched := false;
  end if;

  if v_fulfillment_touched then
    v_fulfillment_count := coalesce(array_length(v_final_fulfillment_methods, 1), 0);

    if v_fulfillment_count > 0
       and v_fulfillment_count <> (select count(distinct m) from unnest(v_final_fulfillment_methods) m) then
      raise exception 'Duplicate fulfillment method selected.' using detail = 'FULFILLMENT_INVALID';
    end if;

    delete from public.listing_fulfillment_methods where listing_id = p_listing_id;

    if v_fulfillment_count > 0 then
      insert into public.listing_fulfillment_methods (listing_id, method)
        select p_listing_id, m from unnest(v_final_fulfillment_methods) as m;
    end if;
  end if;

  -- ===================== slug: regenerated only if title actually changed =====================
  if v_final_title <> v_title then
    v_final_slug := lower(regexp_replace(btrim(v_final_title), '[^a-zA-Z0-9]+', '-', 'g'));
    v_final_slug := btrim(v_final_slug, '-');
    if v_final_slug = '' or v_final_slug is null then
      v_final_slug := 'listing';
    end if;
  else
    v_final_slug := v_slug;
  end if;

  -- ===================== apply the merged update (public_code and status are never written here) =====================
  update public.listings as l
    set title = v_final_title,
        description = v_final_description,
        category_id = v_final_category_id,
        listing_type = v_final_listing_type,
        condition = v_final_condition,
        known_flaws = v_final_known_flaws,
        brand = v_final_brand,
        price_cents = v_final_price_cents,
        original_price_cents = v_final_original_price_cents,
        is_negotiable = v_final_is_negotiable,
        stock_quantity = v_final_stock_quantity,
        province_id = v_final_province_id,
        city_id = v_final_city_id,
        barangay_id = v_final_barangay_id,
        meetup_note = v_final_meetup_note,
        slug = v_final_slug
    where l.id = p_listing_id
    returning l.updated_at into v_updated_at;

  -- ===================== vehicle/rental: drop extension rows the final category no longer supports (unconditional, regardless of whether the patch touched them) =====================
  if not v_final_is_vehicle_category then
    delete from public.listing_vehicle_details where listing_id = p_listing_id;
  end if;

  if not v_final_is_rental_category then
    delete from public.listing_rental_details where listing_id = p_listing_id;
  end if;

  -- ===================== vehicle details: omitted -> preserve; explicit null -> delete; object -> validate against FINAL category + upsert =====================
  if v_patch ? 'vehicle_details' then
    v_vehicle_patch := v_patch -> 'vehicle_details';

    if jsonb_typeof(v_vehicle_patch) = 'null' then
      delete from public.listing_vehicle_details where listing_id = p_listing_id;
    else
      if jsonb_typeof(v_vehicle_patch) <> 'object' then
        raise exception 'Vehicle details must be a JSON object.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;

      if not v_final_is_vehicle_category then
        raise exception 'Vehicle details are only allowed for Cars/Motorcycles listings.' using detail = 'VEHICLE_DETAILS_NOT_ALLOWED';
      end if;

      v_vehicle_brand := null;
      v_vehicle_model := null;
      v_vehicle_year := null;
      v_vehicle_mileage_km := null;
      v_vehicle_transmission := null;
      v_vehicle_fuel_type := null;
      v_vehicle_registration_status := null;
      v_vehicle_documents := null;

      if v_vehicle_patch ? 'brand' then
        if jsonb_typeof(v_vehicle_patch -> 'brand') <> 'string' then
          raise exception 'Vehicle brand must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_brand := nullif(btrim(v_vehicle_patch ->> 'brand'), '');
      end if;

      if v_vehicle_patch ? 'model' then
        if jsonb_typeof(v_vehicle_patch -> 'model') <> 'string' then
          raise exception 'Vehicle model must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_model := nullif(btrim(v_vehicle_patch ->> 'model'), '');
      end if;

      if v_vehicle_patch ? 'year' then
        if jsonb_typeof(v_vehicle_patch -> 'year') <> 'number' then
          raise exception 'Vehicle year must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_year := (v_vehicle_patch ->> 'year')::smallint;
        if v_vehicle_year < 1900 then
          raise exception 'Vehicle year is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
      end if;

      if v_vehicle_patch ? 'mileage_km' then
        if jsonb_typeof(v_vehicle_patch -> 'mileage_km') <> 'number' then
          raise exception 'Vehicle mileage must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_mileage_km := (v_vehicle_patch ->> 'mileage_km')::integer;
        if v_vehicle_mileage_km < 0 then
          raise exception 'Vehicle mileage is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
      end if;

      if v_vehicle_patch ? 'transmission' then
        if jsonb_typeof(v_vehicle_patch -> 'transmission') <> 'string' then
          raise exception 'Vehicle transmission must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_transmission := nullif(btrim(v_vehicle_patch ->> 'transmission'), '');
      end if;

      if v_vehicle_patch ? 'fuel_type' then
        if jsonb_typeof(v_vehicle_patch -> 'fuel_type') <> 'string' then
          raise exception 'Vehicle fuel type must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_fuel_type := nullif(btrim(v_vehicle_patch ->> 'fuel_type'), '');
      end if;

      if v_vehicle_patch ? 'registration_status' then
        if jsonb_typeof(v_vehicle_patch -> 'registration_status') <> 'string'
           or (v_vehicle_patch ->> 'registration_status') not in ('registered', 'expired_registration', 'for_renewal') then
          raise exception 'Vehicle registration status is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_registration_status := (v_vehicle_patch ->> 'registration_status')::public.vehicle_registration_status_enum;
      end if;

      if v_vehicle_patch ? 'documents_available' then
        if jsonb_typeof(v_vehicle_patch -> 'documents_available') <> 'array'
           or exists (
             select 1 from jsonb_array_elements(v_vehicle_patch -> 'documents_available') e
             where jsonb_typeof(e) <> 'string'
           ) then
          raise exception 'Vehicle documents must be a list of text values.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        select array_agg(doc) into v_vehicle_documents
          from jsonb_array_elements_text(v_vehicle_patch -> 'documents_available') as doc;
      end if;

      insert into public.listing_vehicle_details (
        listing_id, brand, model, year, mileage_km, transmission, fuel_type,
        registration_status, documents_available
      )
      values (
        p_listing_id, v_vehicle_brand, v_vehicle_model, v_vehicle_year, v_vehicle_mileage_km,
        v_vehicle_transmission, v_vehicle_fuel_type, v_vehicle_registration_status, v_vehicle_documents
      )
      on conflict (listing_id) do update set
        brand = excluded.brand,
        model = excluded.model,
        year = excluded.year,
        mileage_km = excluded.mileage_km,
        transmission = excluded.transmission,
        fuel_type = excluded.fuel_type,
        registration_status = excluded.registration_status,
        documents_available = excluded.documents_available;
    end if;
  end if;

  -- ===================== rental details: omitted -> preserve; explicit null -> delete; object -> validate against FINAL category + upsert =====================
  if v_patch ? 'rental_details' then
    v_rental_patch := v_patch -> 'rental_details';

    if jsonb_typeof(v_rental_patch) = 'null' then
      delete from public.listing_rental_details where listing_id = p_listing_id;
    else
      if jsonb_typeof(v_rental_patch) <> 'object' then
        raise exception 'Rental details must be a JSON object.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;

      if not v_final_is_rental_category then
        raise exception 'Rental details are only allowed for For Rent listings.' using detail = 'RENTAL_DETAILS_NOT_ALLOWED';
      end if;

      v_rental_price_cents := null;
      v_rental_period := null;
      v_rental_security_deposit_cents := null;
      v_rental_terms := null;
      v_rental_minimum_period := null;
      v_rental_capacity := null;
      v_rental_whats_included := null;
      v_rental_rules_restrictions := null;
      v_rental_availability := 'available';

      if v_rental_patch ? 'rental_price_cents' then
        if jsonb_typeof(v_rental_patch -> 'rental_price_cents') <> 'number' then
          raise exception 'Rental price must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_price_cents := (v_rental_patch ->> 'rental_price_cents')::bigint;
        if v_rental_price_cents < 0 then
          raise exception 'Rental price is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
      end if;

      if v_rental_patch ? 'rental_period' then
        if jsonb_typeof(v_rental_patch -> 'rental_period') <> 'string'
           or (v_rental_patch ->> 'rental_period') not in ('daily', 'weekly', 'monthly', 'other') then
          raise exception 'Rental period is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_period := (v_rental_patch ->> 'rental_period')::public.rental_period_enum;
      end if;

      if v_rental_patch ? 'security_deposit_cents' then
        if jsonb_typeof(v_rental_patch -> 'security_deposit_cents') <> 'number' then
          raise exception 'Security deposit must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_security_deposit_cents := (v_rental_patch ->> 'security_deposit_cents')::bigint;
        if v_rental_security_deposit_cents < 0 then
          raise exception 'Security deposit is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
      end if;

      if v_rental_patch ? 'rental_terms' then
        if jsonb_typeof(v_rental_patch -> 'rental_terms') <> 'string' then
          raise exception 'Rental terms must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_terms := nullif(btrim(v_rental_patch ->> 'rental_terms'), '');
      end if;

      if v_rental_patch ? 'minimum_rental_period' then
        if jsonb_typeof(v_rental_patch -> 'minimum_rental_period') <> 'string' then
          raise exception 'Minimum rental period must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_minimum_period := nullif(btrim(v_rental_patch ->> 'minimum_rental_period'), '');
      end if;

      if v_rental_patch ? 'capacity' then
        if jsonb_typeof(v_rental_patch -> 'capacity') <> 'number' then
          raise exception 'Capacity must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_capacity := (v_rental_patch ->> 'capacity')::integer;
        if v_rental_capacity <= 0 then
          raise exception 'Capacity is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
      end if;

      if v_rental_patch ? 'whats_included' then
        if jsonb_typeof(v_rental_patch -> 'whats_included') <> 'string' then
          raise exception 'What''s included must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_whats_included := nullif(btrim(v_rental_patch ->> 'whats_included'), '');
      end if;

      if v_rental_patch ? 'rules_restrictions' then
        if jsonb_typeof(v_rental_patch -> 'rules_restrictions') <> 'string' then
          raise exception 'Rules/restrictions must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_rules_restrictions := nullif(btrim(v_rental_patch ->> 'rules_restrictions'), '');
      end if;

      if v_rental_patch ? 'availability' then
        if jsonb_typeof(v_rental_patch -> 'availability') <> 'string'
           or (v_rental_patch ->> 'availability') not in ('available', 'unavailable', 'paused') then
          raise exception 'Rental availability is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_availability := (v_rental_patch ->> 'availability')::public.rental_availability_enum;
      end if;

      insert into public.listing_rental_details (
        listing_id, rental_price_cents, rental_period, security_deposit_cents, rental_terms,
        minimum_rental_period, capacity, whats_included, rules_restrictions, availability
      )
      values (
        p_listing_id, v_rental_price_cents, v_rental_period, v_rental_security_deposit_cents, v_rental_terms,
        v_rental_minimum_period, v_rental_capacity, v_rental_whats_included, v_rental_rules_restrictions,
        v_rental_availability
      )
      on conflict (listing_id) do update set
        rental_price_cents = excluded.rental_price_cents,
        rental_period = excluded.rental_period,
        security_deposit_cents = excluded.security_deposit_cents,
        rental_terms = excluded.rental_terms,
        minimum_rental_period = excluded.minimum_rental_period,
        capacity = excluded.capacity,
        whats_included = excluded.whats_included,
        rules_restrictions = excluded.rules_restrictions,
        availability = excluded.availability;
    end if;
  end if;

  return query
    select p_listing_id, v_public_code, v_final_slug, v_listing_status, v_updated_at;
end;
$$;

revoke all on function public.update_listing(uuid, jsonb) from public;
revoke all on function public.update_listing(uuid, jsonb) from anon;
grant execute on function public.update_listing(uuid, jsonb) to authenticated;
