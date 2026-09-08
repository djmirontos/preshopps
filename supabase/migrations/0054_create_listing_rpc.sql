-- Seller Listing Management, creation foundation: exactly one new
-- SECURITY DEFINER RPC, create_listing. No new table, no new enum, no RLS
-- policy change, no existing function touched. Frontend, update_listing,
-- status-transition RPCs (publish/pause/resume/archive/mark-sold), My
-- Listings, duplicate-listing, Trusted Seller, and moderation/admin are all
-- explicitly out of scope for this migration.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0053_shop_reviews_rating_filter_and_sort
-- (confirmed live via list_migrations, no drift). listings/listing_images/
-- listing_fulfillment_methods/listing_vehicle_details/listing_rental_details
-- confirmed exactly as 0008/0009 left them -- no create_listing/
-- update_listing/publish_listing/any listing-write RPC exists anywhere (a
-- full-text search of every function body found only order-workflow side
-- effects on listings.stock_quantity/reserved_quantity, never a seller-
-- initiated write). Live counts confirmed: 0 shops, 0 listings, 0
-- listing_images -- this is genuinely the first write path into these
-- tables. categories confirmed exactly as 0005 left it: 13 fixed rows,
-- is_inquiry_only true only for 'cars'/'motorcycles'/'for-rent' (by slug).
-- listing_status_enum {draft,available,reserved,paused,sold,archived},
-- listing_type_enum {preloved,brand_new}, listing_condition_enum
-- {brand_new,like_new,very_good,good,fair}, fulfillment_method_enum
-- {meetup,pickup,local_delivery,shipping}, vehicle_registration_status_enum
-- {registered,expired_registration,for_renewal}, rental_period_enum
-- {daily,weekly,monthly,other}, rental_availability_enum
-- {available,unavailable,paused} all confirmed unchanged since 0002.
-- shops.status shop_status_enum {active,away} confirmed unchanged since
-- 0007; user_restrictions/restriction_type_enum {seller_suspended,
-- buyer_restricted,account_suspended} confirmed unchanged since 0004/0031,
-- already used by the exact same INTERACTION_BLOCKED pattern in
-- upsert_review_reply (seller-side write gate). Storage: listing-images
-- bucket + RLS confirmed exactly as 0048 left it -- policies enforce only
-- `(storage.foldername(name))[1] = auth.uid()::text`, nothing about a
-- second path segment (that remains this RPC's own job, exactly as 0048's
-- own header states create_review already does for review_images).
--
-- Category eligibility for vehicle/rental details -- resolved at this
-- layer, not hardcoded, per 0008's own explicit instruction
-- -----------------------------------------------------------------------
-- 0008_listings.sql's own header: category/detail-table validation "must
-- not hardcode specific categories.id values as hidden business constants;
-- it should key off categories.is_inquiry_only / a vehicle-vs-rental
-- distinction resolved at that layer, not a literal ID baked into this
-- schema." is_inquiry_only alone cannot distinguish Cars/Motorcycles
-- (vehicle details) from For Rent (rental details) -- both are
-- is_inquiry_only = true. No schema field encodes that finer distinction
-- (adding one would be a new schema field this task explicitly says not to
-- add unless unavoidable), so this RPC resolves it from categories.slug --
-- the same stable, admin-managed, already-unique identifier this schema
-- already treats as durable reference data (13 fixed rows). 'cars'/
-- 'motorcycles' => vehicle-detail-eligible; 'for-rent' => rental-detail-
-- eligible. This is a judgment call, flagged explicitly rather than
-- silently assumed.
--
-- Draft-only creation
-- -----------------------------------------------------------------------
-- status is never a parameter -- every new listing starts 'draft' via a
-- literal in the INSERT (not even the column default is relied upon, so
-- this is true regardless of any future column-default change). No
-- publish path exists yet, matching 0008's own deferred-publish-RPC note.
--
-- Vehicle/rental details as JSONB, not ~17 flattened parameters
-- -----------------------------------------------------------------------
-- Mirrors the exact "structural, cast-safe" JSONB pattern already proven
-- by submit_cart_order's p_fulfillment_choices (0039/0040): existence
-- (`?`) and jsonb_typeof are checked BEFORE any ->> cast is attempted, and
-- literal enum-like text values are membership-checked before casting to
-- their real enum type. Every field in both detail objects is optional
-- (0008/0009's own header: "the row's mere existence is not required to
-- publish" -- true for every field within it too), so presence of the
-- detail object itself is never required even for a matching category;
-- only its use for a NON-matching category is rejected.
--
-- Images: this migration only creates actual-item photos
-- -----------------------------------------------------------------------
-- PRD 11.2's Reference/Catalog image labeling for Brand New listings is
-- deliberately not exposed here -- this task's own field list is exactly
-- "image storage paths, 1-8" and its own Security section frames the
-- requirement as "1-8 actual listing images". Every image this RPC creates
-- is therefore is_reference_image = false. Labeling specific images as
-- Reference/Catalog is left for a later task (update_listing or a
-- dedicated image-management RPC), not invented here.
--
-- Path validation mirrors the exact same trust-boundary pattern already
-- used by create_shop/update_shop for p_logo_storage_path: each element of
-- p_image_paths must match `^listing-images/{auth.uid()}/`. The path's
-- second segment (a listing id) cannot be validated against this listing's
-- own id, because the listing does not exist yet at upload time -- the
-- exact same chicken-and-egg case 0048's own header already resolved for
-- review_images by anchoring solely on the uploader's own id.
--
-- public_code / slug generation -- exact existing canonical convention,
-- not invented
-- -----------------------------------------------------------------------
-- listings.public_code has "identical shape" to orders.public_code
-- (0039's own header): text, UNIQUE, non-blank CHECK, no format CHECK, no
-- existing generator function. This migration reuses submit_cart_order's
-- exact generation shape -- 'PSL-' || upper(encode(extensions
-- .gen_random_bytes(8), 'hex')) (PSL = Preshopps Listing, parallel to
-- submit_cart_order's own PSO = Preshopps Order prefix) -- inside the same
-- loop-and-catch-unique_violation retry shape already proven there.
-- listings.slug is NOT unique (0008's own header: "a cosmetic,
-- title-derived part of the URL only") and needs no retry loop; it is
-- derived from p_title using the exact same normalization rule already
-- established by generate_unique_shop_slug/lib/seller/slugify.ts
-- (lowercase, non-alphanumeric runs collapsed to one hyphen, leading/
-- trailing hyphens trimmed, 'listing' fallback if that normalizes to
-- empty) -- never client-supplied (no p_slug parameter exists).
--
-- Seller eligibility ("shop must be eligible... under current canonical
-- restrictions/status rules")
-- -----------------------------------------------------------------------
-- shop_status_enum has exactly {active, away} -- PRD 6.5 never states Away
-- blocks any seller action (ShopForm's own copy: "Your shop stays visible,
-- but marked as away"), so shops.status is read but not gated on here.
-- The actual canonical restriction surface for a seller-initiated write is
-- user_restrictions: seller_suspended/account_suspended block listing
-- creation (INTERACTION_BLOCKED), mirroring upsert_review_reply's own
-- caller-side seller-write gate exactly. buyer_restricted is deliberately
-- not checked -- it governs buyer-side actions, not seller listing
-- creation, matching the buyer/seller restriction-type split already
-- established across the reviews module.
--
-- Atomicity
-- -----------------------------------------------------------------------
-- The entire function body runs as one implicit transaction (a single
-- top-level RPC call, no internal COMMIT). Any exception raised anywhere
-- after the listings INSERT -- fulfillment rows, image rows, cover-image
-- update, vehicle/rental detail insert -- rolls back that INSERT and every
-- statement after it together; nothing partial can remain. The only retry
-- loop (public_code collision) is itself fully contained inside this same
-- transaction and only ever retries the listings INSERT statement, never
-- anything that follows it.
--
-- Security: SECURITY DEFINER, SET search_path = '', every table/type
-- reference fully schema-qualified. Caller identity derived exclusively
-- from auth.uid() -- no owner/shop id is ever trusted from the client.
-- REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only --
-- listing creation is a sign-in-only surface, matching every other
-- owner-write RPC in this schema. No direct table write is exposed to any
-- client role -- listings/listing_images/listing_fulfillment_methods/
-- listing_vehicle_details/listing_rental_details all already carry zero
-- client write policies (RLS enabled, zero policies, confirmed live), so
-- this RPC is the only write path. This migration does not reference
-- orders/order_items/inventory_reservations anywhere -- an
-- already-accepted order's snapshot data lives entirely inside
-- order_items, structurally untouched by construction.

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

  -- ===================== title / description (required) =====================
  v_title := nullif(btrim(p_title), '');
  if v_title is null then
    raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
  end if;

  v_description := nullif(btrim(p_description), '');
  if v_description is null then
    raise exception 'Listing description is required.' using detail = 'DESCRIPTION_REQUIRED';
  end if;

  -- ===================== category (required, must exist) =====================
  if p_category_id is null then
    raise exception 'Category is required.' using detail = 'CATEGORY_REQUIRED';
  end if;

  select c.slug into v_category_slug
    from public.categories c
    where c.id = p_category_id;

  if not found then
    raise exception 'Selected category does not exist.' using detail = 'CATEGORY_NOT_FOUND';
  end if;

  v_is_vehicle_category := v_category_slug in ('cars', 'motorcycles');
  v_is_rental_category := v_category_slug = 'for-rent';

  -- ===================== listing type / condition (required, cross-validated) =====================
  if p_listing_type is null then
    raise exception 'Listing type is required.' using detail = 'LISTING_TYPE_REQUIRED';
  end if;

  if p_condition is null then
    raise exception 'Condition is required.' using detail = 'CONDITION_REQUIRED';
  end if;

  if p_listing_type = 'brand_new' and p_condition <> 'brand_new' then
    raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
  end if;

  if p_listing_type = 'preloved' and p_condition = 'brand_new' then
    raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
  end if;

  -- ===================== known flaws (required only for Fair) =====================
  v_known_flaws := nullif(btrim(p_known_flaws), '');
  if p_condition = 'fair' and v_known_flaws is null then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price (required) =====================
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
  end if;

  if p_original_price_cents is not null and p_original_price_cents < p_price_cents then
    raise exception 'Original price must not be lower than the current price.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  -- ===================== stock quantity =====================
  if p_stock_quantity is null or p_stock_quantity < 1 then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location (province + city required, barangay optional) =====================
  if p_province_id is null then
    raise exception 'Province is required.' using detail = 'PROVINCE_REQUIRED';
  end if;

  if p_city_id is null then
    raise exception 'City/municipality is required.' using detail = 'CITY_REQUIRED';
  end if;

  if not exists (
    select 1 from public.cities_municipalities c
    where c.id = p_city_id and c.province_id = p_province_id
  ) then
    raise exception 'Selected city does not belong to the selected province.' using detail = 'INVALID_CITY_FOR_PROVINCE';
  end if;

  if p_barangay_id is not null and not exists (
    select 1 from public.barangays b
    where b.id = p_barangay_id and b.city_id = p_city_id
  ) then
    raise exception 'Selected barangay does not belong to the selected city.' using detail = 'INVALID_BARANGAY_FOR_CITY';
  end if;

  -- ===================== optional plain fields =====================
  v_brand := nullif(btrim(p_brand), '');
  v_meetup_note := nullif(btrim(p_meetup_note), '');

  -- ===================== fulfillment methods (required, non-empty, no duplicates) =====================
  v_fulfillment_count := coalesce(array_length(p_fulfillment_methods, 1), 0);

  if v_fulfillment_count < 1 then
    raise exception 'At least one fulfillment method is required.' using detail = 'FULFILLMENT_REQUIRED';
  end if;

  if v_fulfillment_count <> (select count(distinct m) from unnest(p_fulfillment_methods) m) then
    raise exception 'Duplicate fulfillment method selected.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== images (required, 1-8, ownership-validated) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count < 1 then
    raise exception 'At least one photo is required.' using detail = 'IMAGE_REQUIRED';
  end if;

  if v_image_count > 8 then
    raise exception 'A listing may have at most 8 photos.' using detail = 'TOO_MANY_LISTING_IMAGES';
  end if;

  foreach v_path in array p_image_paths loop
    if v_path is null
       or v_path !~ '[^[:space:]]'
       or v_path !~ ('^listing-images/' || v_caller::text || '/') then
      raise exception 'One or more listing photos are invalid.' using detail = 'LISTING_IMAGE_PATH_INVALID';
    end if;
  end loop;

  -- ===================== vehicle details (optional; only for Cars/Motorcycles) =====================
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

  -- ===================== rental details (optional; only for For Rent) =====================
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

  -- ===================== insert the listing (draft only; public_code generated + retried on collision) =====================
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
        p_stock_quantity, p_province_id, p_city_id, p_barangay_id, v_meetup_note, 'draft',
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

  -- ===================== fulfillment methods =====================
  insert into public.listing_fulfillment_methods (listing_id, method)
    select v_listing_id, m from unnest(p_fulfillment_methods) as m;

  -- ===================== images, preserving submitted order as position 0..N-1 =====================
  for i in 1..v_image_count loop
    insert into public.listing_images (listing_id, storage_path, position, is_reference_image)
      values (v_listing_id, p_image_paths[i], i - 1, false);
  end loop;

  -- ===================== deterministic cover image: always the first submitted photo =====================
  select li.id into v_cover_image_id
    from public.listing_images li
    where li.listing_id = v_listing_id and li.position = 0;

  update public.listings as l
    set cover_image_id = v_cover_image_id
    where l.id = v_listing_id;

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
