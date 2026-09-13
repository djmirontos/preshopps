-- Fix: public.update_listing raised "column reference "listing_id" is
-- ambiguous" during live hands-on QA of the seller Create Listing/photo
-- integration work (a separate, still-uncommitted task -- this migration
-- touches nothing from that slice). No schema change, no new function, no
-- RLS/publication change -- exactly one existing function is replaced.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Live definition pulled via pg_get_functiondef immediately before writing
-- this file (not read from an old migration file, per this task's own
-- instruction -- later migrations may have replaced/hardened it since
-- 0059/0061/0062 last touched it). Live signature confirmed unchanged from
-- those migrations: update_listing(p_listing_id uuid, p_patch jsonb DEFAULT
-- '{}'::jsonb) RETURNS TABLE(listing_id uuid, public_code text, slug text,
-- status listing_status_enum, updated_at timestamptz), SECURITY DEFINER,
-- search_path = ''. Live grants confirmed via has_function_privilege:
-- anon = false, authenticated = true, service_role = true (implicit
-- owner-default, untouched) -- identical to what 0059/0061/0062 already
-- established. No function comment exists live (obj_description = null),
-- so none is added here either.
--
-- Root cause (0021/0022/0037 ambiguity-bug family, this codebase's own
-- recurring pattern)
-- -----------------------------------------------------------------------
-- This function's own RETURNS TABLE(listing_id uuid, ...) makes
-- `listing_id` a bare, unqualified identifier resolvable throughout the
-- function body as that OUT column/variable. Five DELETE statements
-- targeted a DIFFERENT table that also happens to have its own literal
-- `listing_id` column (listing_fulfillment_methods, listing_vehicle_
-- details x2, listing_rental_details x2) using a bare `where listing_id =
-- p_listing_id` predicate -- ambiguous between the function's own OUT
-- column and the target table's column, and Postgres correctly refuses to
-- guess. This was LATENT since whichever of 0059/0061/0062 first added
-- these five statements: it only raises when update_listing is actually
-- called with a patch that touches fulfillment_methods, or changes
-- category away from a vehicle/rental type, or explicitly clears/sets
-- vehicle_details/rental_details -- exactly the real-world Save Draft
-- interactions the in-progress seller Create Listing/photo task's own
-- hands-on QA finally exercised for the first time against the live
-- database (prior automated tests all mock update_listing at the JS
-- boundary and never reach this SQL).
--
-- Full-function audit performed (read-only, before writing this file):
-- every OTHER RETURNS TABLE output column name (public_code, slug, status,
-- updated_at) was checked for the same bare-reference collision risk.
-- None exists: the only place `slug` appears as a plain (non-alias-
-- qualified) identifier is the UPDATE statement's own SET target
-- (`slug = v_final_slug`), which Postgres always resolves as a catalog
-- column-name lookup against the table actually being updated (`public.
-- listings as l`), never as a general expression subject to PL/pgSQL
-- variable/OUT-parameter shadowing -- the identical, already-established
-- distinction documented in 0039's own header ("Plain INSERT column-lists
-- are pure catalog lookups against the target table, not expression
-- positions"), which applies equally to UPDATE ... SET targets. No other
-- bare occurrence of public_code/status/updated_at exists at all. The five
-- listing_id DELETEs are the only ambiguity in this function.
--
-- Fix (smallest possible; nothing else touched)
-- -----------------------------------------------------------------------
-- Each of the five DELETE statements now aliases its own target table
-- (`as lfm` / `as lvd` / `as lrd`) and qualifies the WHERE predicate against
-- that alias, exactly resolving the ambiguity the same way this function's
-- own SELECT/UPDATE statements already alias `public.listings as l`
-- elsewhere in this same body. INSERT column-lists and ON CONFLICT targets
-- referencing `listing_id` (listing_fulfillment_methods, listing_vehicle_
-- details, listing_rental_details) are untouched -- confirmed safe catalog-
-- lookup positions, never the source of this bug, per the same 0021/0022/
-- 0037 precedent already relied on elsewhere in this codebase. No business
-- rule, validation, error code, ownership/draft/restriction check, or
-- return shape is changed anywhere in this function -- only these five
-- WHERE predicates gained an explicit table alias.

create or replace function public.update_listing(p_listing_id uuid, p_patch jsonb default '{}'::jsonb)
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
  v_caller_deleted_at timestamptz;
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
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

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
    raise exception 'You are not able to edit listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

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

  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be edited with this operation.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  v_patch := coalesce(p_patch, '{}'::jsonb);
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Patch must be a JSON object.' using detail = 'PATCH_INVALID';
  end if;

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

  if v_final_listing_type is not null and v_final_condition is not null then
    if v_final_listing_type = 'brand_new' and v_final_condition <> 'brand_new' then
      raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;

    if v_final_listing_type = 'preloved' and v_final_condition = 'brand_new' then
      raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;
  end if;

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

  if v_patch ? 'is_negotiable' then
    if jsonb_typeof(v_patch -> 'is_negotiable') <> 'boolean' then
      raise exception 'Negotiable flag is invalid.' using detail = 'IS_NEGOTIABLE_INVALID';
    end if;
    v_final_is_negotiable := (v_patch ->> 'is_negotiable')::boolean;
  else
    v_final_is_negotiable := v_is_negotiable;
  end if;

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

    delete from public.listing_fulfillment_methods as lfm where lfm.listing_id = p_listing_id;

    if v_fulfillment_count > 0 then
      insert into public.listing_fulfillment_methods (listing_id, method)
        select p_listing_id, m from unnest(v_final_fulfillment_methods) as m;
    end if;
  end if;

  if v_final_title <> v_title then
    v_final_slug := lower(regexp_replace(btrim(v_final_title), '[^a-zA-Z0-9]+', '-', 'g'));
    v_final_slug := btrim(v_final_slug, '-');
    if v_final_slug = '' or v_final_slug is null then
      v_final_slug := 'listing';
    end if;
  else
    v_final_slug := v_slug;
  end if;

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

  if not v_final_is_vehicle_category then
    delete from public.listing_vehicle_details as lvd where lvd.listing_id = p_listing_id;
  end if;

  if not v_final_is_rental_category then
    delete from public.listing_rental_details as lrd where lrd.listing_id = p_listing_id;
  end if;

  if v_patch ? 'vehicle_details' then
    v_vehicle_patch := v_patch -> 'vehicle_details';

    if jsonb_typeof(v_vehicle_patch) = 'null' then
      delete from public.listing_vehicle_details as lvd where lvd.listing_id = p_listing_id;
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

  if v_patch ? 'rental_details' then
    v_rental_patch := v_patch -> 'rental_details';

    if jsonb_typeof(v_rental_patch) = 'null' then
      delete from public.listing_rental_details as lrd where lrd.listing_id = p_listing_id;
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
