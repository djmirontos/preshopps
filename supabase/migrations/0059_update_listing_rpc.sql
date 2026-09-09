-- Seller Listing Management: update_listing, the Draft-editing counterpart to
-- create_listing (0054/0055/0056). Lets a seller revise their own Draft
-- listing's scalar/relational fields across multiple sessions before
-- publishing. Additive only: one new function. No table, enum, RLS policy,
-- or column is created here. Listing photo management is a separate RPC
-- (0060_listing_image_management_rpc.sql, replace_listing_images) -- this
-- function never touches listing_images or listings.cover_image_id.
--
-- Canonical editability finding (surfaced, not silently decided)
-- -----------------------------------------------------------------------
-- PRD 10.6 frames the Draft -> Available boundary as where completeness is
-- enforced, and this task's own goal is "edit their own listing Draft ...
-- before publish." However PRD 29.1 ("Listing Editing and Inventory
-- Protection") explicitly permits editing a listing AFTER an order request
-- exists too, with the added constraint that "active accepted orders must
-- retain their original order snapshot" and "critical order details such as
-- price/identity must not silently mutate the buyer's agreed order." Canon
-- is therefore NOT silent on post-publish editing -- it affirmatively
-- allows it, under a snapshot-protection rule this task was explicitly told
-- not to build ("do not touch orders/order_items/snapshots"). Implementing
-- 29.1 correctly would require deciding which fields count as "critical,"
-- how an update interacts with an accepted order's frozen snapshot, and
-- whether/how a reserved-inventory listing's editable surface differs from
-- a Draft's -- all order-semantics decisions the Escalation Rule requires be
-- surfaced before implementation, not folded into a "foundation" task whose
-- own scope excludes order/order_item/snapshot work. This migration
-- therefore implements Draft-only editing now and reports 29.1's
-- post-publish editing allowance as a distinct, deliberately deferred
-- follow-up decision -- not something silently ignored or silently
-- overreached into.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0058_seller_policy_acceptance (confirmed live
-- via list_migrations, no drift). listings' current CHECK constraints
-- (0008, corrected by 0028 for stock_quantity) were re-read in full:
-- listings_type_condition_check, listings_fair_requires_known_flaws_check,
-- listings_title_not_blank_check, listings_description_not_blank_check,
-- listings_price_cents_check (>= 0), listings_original_price_check
-- (original_price_cents is null or >= price_cents), listings_stock_quantity_check
-- (>= 0, loosened by 0028 solely for the order-completion pathway --
-- create_listing's own business rule still requires >= 1 for any
-- seller-supplied value, and this migration mirrors that, not the raw >= 0
-- floor). No update_listing or similarly-named function exists anywhere --
-- clean namespace. create_listing (0056) and publish_listing (0058) were
-- both re-read in full immediately before writing this file; every
-- validation rule below is a direct mirror of theirs, evaluated against the
-- final merged (existing-row + supplied-argument) state rather than the
-- raw arguments alone, per this task's explicit requirement.
--
-- Partial-update semantics -- the one real design decision, reported
-- -----------------------------------------------------------------------
-- Every parameter defaults to NULL, meaning "not supplied -- leave this
-- field unchanged," mirroring this codebase's only existing convention for
-- optional RPC input (create_listing's own optional parameters). Plain SQL
-- has no way to distinguish "caller omitted this argument" from "caller
-- explicitly passed NULL" -- both evaluate identically inside the function
-- body. Consequence, reported rather than silently worked around: for the
-- free-text fields (description, brand, known_flaws, meetup_note) a caller
-- CAN explicitly clear a previously-set value back to empty by passing an
-- empty string (normalized to NULL via nullif(btrim(...), ''), exactly like
-- create_listing already does) -- but for every non-text nullable column
-- (category_id, listing_type, condition, price_cents, original_price_cents,
-- province_id, city_id, barangay_id) there is no way to explicitly clear an
-- already-set value back to NULL through this RPC; only setting it to a new
-- non-null value is possible. This is a genuine, honest limitation, not an
-- invented one: building a sentinel/patch mechanism to lift it was judged
-- out of scope for this foundation task (not requested, and this
-- codebase's established idiom uses plain named parameters everywhere
-- else) -- flagged here as a product/design decision for a future task if
-- "un-set a previously-set field" turns out to be a real seller need.
--
-- Location hierarchy validation is likewise evaluated only against the
-- final merged (province_id, city_id, barangay_id) trio -- if a seller
-- changes province_id without also resupplying a compatible city_id, the
-- update is correctly rejected (INVALID_CITY_FOR_PROVINCE) rather than
-- silently clearing the now-stale city; the caller is expected to resupply
-- the full compatible trio together when changing any one level.
--
-- Security: SECURITY DEFINER, set search_path = '', REVOKE ALL FROM
-- public/anon, GRANT EXECUTE TO authenticated only. Identity comes
-- exclusively from auth.uid() -- no p_user_id/p_owner_id/p_shop_id
-- parameter exists. owner_id, shop_id, public_code, status, and
-- cover_image_id are never accepted as parameters; public_code is never
-- written by this function at all, and status only ever participates as a
-- read (the draft-only gate), never a write. One implicit transaction per
-- call; the listing row is locked FOR UPDATE before any read or write of
-- its own or its child tables, the same universal serialization point
-- convention used by every other ownership-gated write RPC in this schema.
-- Zero references to orders/order_items/inventory_reservations.

create or replace function public.update_listing(
  p_listing_id uuid,
  p_title text default null,
  p_description text default null,
  p_category_id integer default null,
  p_listing_type public.listing_type_enum default null,
  p_condition public.listing_condition_enum default null,
  p_price_cents bigint default null,
  p_original_price_cents bigint default null,
  p_is_negotiable boolean default null,
  p_brand text default null,
  p_known_flaws text default null,
  p_stock_quantity integer default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_meetup_note text default null,
  p_fulfillment_methods public.fulfillment_method_enum[] default null,
  p_vehicle_details jsonb default null,
  p_rental_details jsonb default null
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
  v_fulfillment_count integer;
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

  -- ===================== draft-only editing (see header: post-publish editing is a canon-permitted, deliberately deferred follow-up) =====================
  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be edited with this operation.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  -- ===================== title (may never become blank) =====================
  if p_title is not null then
    v_final_title := nullif(btrim(p_title), '');
    if v_final_title is null then
      raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
    end if;
  else
    v_final_title := v_title;
  end if;

  -- ===================== description (nullable while draft; explicit '' clears it) =====================
  if p_description is not null then
    v_final_description := nullif(btrim(p_description), '');
  else
    v_final_description := v_description;
  end if;

  -- ===================== category (validated + resolved only when supplied; final state otherwise) =====================
  v_final_category_id := coalesce(p_category_id, v_category_id);

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

  -- ===================== listing type / condition, cross-validated on final merged state =====================
  v_final_listing_type := coalesce(p_listing_type, v_listing_type);
  v_final_condition := coalesce(p_condition, v_condition);

  if v_final_listing_type is not null and v_final_condition is not null then
    if v_final_listing_type = 'brand_new' and v_final_condition <> 'brand_new' then
      raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;

    if v_final_listing_type = 'preloved' and v_final_condition = 'brand_new' then
      raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;
  end if;

  -- ===================== known flaws, evaluated against final merged condition/known_flaws =====================
  if p_known_flaws is not null then
    v_final_known_flaws := nullif(btrim(p_known_flaws), '');
  else
    v_final_known_flaws := v_known_flaws;
  end if;

  if v_final_condition = 'fair' and v_final_known_flaws is null then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price / original price, validated on final merged state =====================
  v_final_price_cents := coalesce(p_price_cents, v_price_cents);
  v_final_original_price_cents := coalesce(p_original_price_cents, v_original_price_cents);

  if v_final_price_cents is not null and v_final_price_cents < 0 then
    raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
  end if;

  if v_final_original_price_cents is not null and v_final_price_cents is not null
     and v_final_original_price_cents < v_final_price_cents then
    raise exception 'Original price must not be lower than the current price.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  v_final_is_negotiable := coalesce(p_is_negotiable, v_is_negotiable);

  -- ===================== stock quantity, validated on final merged state (>= 1 -- 0 is reserved for the order-completion pathway) =====================
  v_final_stock_quantity := coalesce(p_stock_quantity, v_stock_quantity);

  if v_final_stock_quantity is null or v_final_stock_quantity < 1 then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location, validated on final merged trio =====================
  v_final_province_id := coalesce(p_province_id, v_province_id);
  v_final_city_id := coalesce(p_city_id, v_city_id);
  v_final_barangay_id := coalesce(p_barangay_id, v_barangay_id);

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

  -- ===================== optional plain fields (explicit '' clears) =====================
  if p_brand is not null then
    v_final_brand := nullif(btrim(p_brand), '');
  else
    v_final_brand := v_brand;
  end if;

  if p_meetup_note is not null then
    v_final_meetup_note := nullif(btrim(p_meetup_note), '');
  else
    v_final_meetup_note := v_meetup_note;
  end if;

  -- ===================== fulfillment methods: whole-set replace, only when supplied =====================
  if p_fulfillment_methods is not null then
    v_fulfillment_count := coalesce(array_length(p_fulfillment_methods, 1), 0);

    if v_fulfillment_count > 0
       and v_fulfillment_count <> (select count(distinct m) from unnest(p_fulfillment_methods) m) then
      raise exception 'Duplicate fulfillment method selected.' using detail = 'FULFILLMENT_INVALID';
    end if;

    delete from public.listing_fulfillment_methods where listing_id = p_listing_id;

    if v_fulfillment_count > 0 then
      insert into public.listing_fulfillment_methods (listing_id, method)
        select p_listing_id, m from unnest(p_fulfillment_methods) as m;
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

  -- ===================== vehicle/rental: drop extension rows the final category no longer supports =====================
  if not v_final_is_vehicle_category then
    delete from public.listing_vehicle_details where listing_id = p_listing_id;
  end if;

  if not v_final_is_rental_category then
    delete from public.listing_rental_details where listing_id = p_listing_id;
  end if;

  -- ===================== vehicle details (validated against the FINAL category; upserted only when supplied) =====================
  if p_vehicle_details is not null then
    if not v_final_is_vehicle_category then
      raise exception 'Vehicle details are only allowed for Cars/Motorcycles listings.' using detail = 'VEHICLE_DETAILS_NOT_ALLOWED';
    end if;

    if jsonb_typeof(p_vehicle_details) <> 'object' then
      raise exception 'Vehicle details must be a JSON object.' using detail = 'VEHICLE_DETAILS_INVALID';
    end if;

    v_vehicle_brand := null;
    v_vehicle_model := null;
    v_vehicle_year := null;
    v_vehicle_mileage_km := null;
    v_vehicle_transmission := null;
    v_vehicle_fuel_type := null;
    v_vehicle_registration_status := null;
    v_vehicle_documents := null;

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

  -- ===================== rental details (validated against the FINAL category; upserted only when supplied) =====================
  if p_rental_details is not null then
    if not v_final_is_rental_category then
      raise exception 'Rental details are only allowed for For Rent listings.' using detail = 'RENTAL_DETAILS_NOT_ALLOWED';
    end if;

    if jsonb_typeof(p_rental_details) <> 'object' then
      raise exception 'Rental details must be a JSON object.' using detail = 'RENTAL_DETAILS_INVALID';
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

  return query
    select p_listing_id, v_public_code, v_final_slug, v_listing_status, v_updated_at;
end;
$$;

revoke all on function public.update_listing(
  uuid, text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean,
  text, text, integer, integer, integer, integer, text, public.fulfillment_method_enum[], jsonb, jsonb
) from public;

revoke all on function public.update_listing(
  uuid, text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean,
  text, text, integer, integer, integer, integer, text, public.fulfillment_method_enum[], jsonb, jsonb
) from anon;

grant execute on function public.update_listing(
  uuid, text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean,
  text, text, integer, integer, integer, integer, text, public.fulfillment_method_enum[], jsonb, jsonb
) to authenticated;
