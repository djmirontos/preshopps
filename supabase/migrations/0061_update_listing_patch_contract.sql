-- Seller Listing Management, canonical correction: 0059's update_listing used
-- plain named parameters defaulting to NULL, which cannot distinguish "field
-- omitted" from "field explicitly cleared to NULL." PRD 10.6's own rule ("A
-- Draft may be incomplete") cuts both ways: a seller must be able to not only
-- fill in an optional field, but also un-fill one they set by mistake, while
-- still Draft. This migration supersedes update_listing with a JSONB patch
-- contract that makes all three states -- omitted / explicitly cleared /
-- supplied -- unambiguous. replace_listing_images (0060) was re-inspected
-- (full source re-read immediately before writing this file) and has no
-- related defect: an explicit empty p_image_paths array already correctly
-- clears every image and sets cover_image_id to NULL; p_reference_flags
-- either matches p_image_paths in length or is rejected
-- (IMAGE_ARRAYS_LENGTH_MISMATCH); the two-defaulted-parameter signature is
-- valid Postgres parameter ordering (confirmed live via pg_proc); 0-8 and
-- deterministic-cover-at-position-0 behavior are unchanged and correct. It is
-- therefore NOT modified by this migration.
--
-- Why 0059/0060 are not edited in place
-- -----------------------------------------------------------------------
-- Both are already applied live. Per this project's repeatedly-established
-- rule (0050/0055/0056/0058's own headers for the identical situation), an
-- already-applied migration file is never edited -- a correction gets its
-- own new file. 0059 is left byte-for-byte untouched as a historical record
-- of what was applied then; 0060 is untouched because inspection found no
-- defect (see above). This migration is update_listing's next, current home.
--
-- Why this is a DROP + CREATE, not a CREATE OR REPLACE
-- -----------------------------------------------------------------------
-- Every other correction in this schema's history (0050, 0055, 0056, 0058)
-- was a same-signature CREATE OR REPLACE because the parameter list never
-- changed shape. Here it must: 0059's update_listing takes 19 named
-- parameters; the corrected contract takes exactly 2 (p_listing_id,
-- p_patch). CREATE OR REPLACE FUNCTION cannot change a function's parameter
-- list -- attempting it raises a native Postgres error. The task's own
-- instruction ("do not retain a confusing overloaded old/new update_listing
-- pair") independently rules out simply adding the new signature alongside
-- the old one as a second overload. The correct, and only structurally
-- possible, fix is therefore: DROP FUNCTION on 0059's exact original
-- signature, then CREATE FUNCTION for the new one, both under the same
-- final name (update_listing) -- there is no frontend caller yet (confirmed:
-- no app/seller or lib/seller reference to update_listing exists anywhere in
-- this codebase), so there is no call site to migrate and no reason to keep
-- a versioned or dual-named function around "just in case."
--
-- The patch contract: JSONB key presence distinguishes all three states
-- -----------------------------------------------------------------------
-- A plain SQL parameter cannot distinguish "omitted" from "explicitly NULL"
-- -- both evaluate identically inside the function body. JSONB can, via two
-- independent checks used together everywhere below:
--   1. `v_patch ? 'field'`                    -- was this key present at all?
--   2. `jsonb_typeof(v_patch -> 'field') = 'null'`  -- if present, is its
--      value the JSON null literal? (NOT the same as a SQL NULL -- a JSONB
--      value produced by `-> 'field'` for a JSON null is never SQL NULL, so
--      this must be checked via jsonb_typeof, not `IS NULL`; extracting via
--      `->>` instead would collapse this exact distinction back to SQL NULL,
--      which is precisely what must be avoided here.)
-- Every editable field below is resolved through exactly this three-way
-- branch: key absent -> keep the existing stored value; key present with
-- JSON null -> clear to NULL (only for fields where nullable/permitted);
-- key present with a real value -> validate and set. This is the smallest
-- structurally sound way to express the required three states -- it reuses
-- JSONB machinery this codebase already relies on elsewhere (create_listing
-- and 0059's own p_vehicle_details/p_rental_details structural validation),
-- rather than inventing a new sentinel type or a second "which fields were
-- touched" boolean array parameter.
--
-- Not clearable, by canon or by structural necessity: title (must remain
-- non-blank -- a JSON null or blank value for the "title" key raises
-- TITLE_REQUIRED, exactly as before), stock_quantity (must remain >= 1 --
-- a JSON null raises STOCK_QUANTITY_INVALID), is_negotiable (the column
-- itself is NOT NULL -- a JSON null raises IS_NEGOTIABLE_INVALID; this
-- follows from the column's own existing constraint, not a new decision).
-- listing_id/shop_id/owner_id/public_code/status remain entirely absent
-- from the patch's field surface, exactly as in 0059 -- there is no key by
-- which a caller could even attempt to touch them.
--
-- Location clearing: cascade only overrides fields the caller did not touch
-- -----------------------------------------------------------------------
-- After resolving each of province_id/city_id/barangay_id through the same
-- three-way branch independently, a cascade pass runs before the existing
-- hierarchy checks (CITY_REQUIRES_PROVINCE, BARANGAY_REQUIRES_CITY,
-- INVALID_CITY_FOR_PROVINCE, INVALID_BARANGAY_FOR_CITY, all unchanged from
-- 0059/create_listing): if the final province_id ends up NULL and the
-- caller's patch did NOT itself touch city_id, city_id is forced to NULL
-- too (and, by the same rule applied next, barangay_id along with it if the
-- caller didn't touch that either). This gives exactly the three examples
-- required: clearing barangay alone leaves province/city untouched and
-- valid; clearing city cascades barangay to NULL when the caller left
-- barangay unmentioned; clearing province cascades both city and barangay
-- to NULL when the caller left them both unmentioned. The cascade only ever
-- overrides a field the caller's own patch did not mention -- if a caller
-- explicitly supplies a new city_id in the very same call as clearing
-- province_id, that is a genuine contradiction and is correctly rejected by
-- the existing CITY_REQUIRES_PROVINCE check, not silently resolved in
-- either direction.
--
-- Fulfillment methods: unchanged tri-state, now expressed as a JSONB array
-- -----------------------------------------------------------------------
-- Same semantics as 0059 (omitted -> preserve; supplied, including an
-- explicit empty array -> whole-set replace), just carried as
-- patch->'fulfillment_methods' (a JSON array of method-name strings,
-- membership-checked against the four real fulfillment_method_enum labels
-- before casting -- the same "validate membership before cast" pattern
-- 0056 already uses for vehicle registration_status/rental_period/
-- availability) instead of a separate array parameter.
--
-- Vehicle/rental extensions: explicit clear now deletes the row outright
-- -----------------------------------------------------------------------
-- patch key absent -> the existing extension row (if any) is left
-- completely untouched. patch key present as a JSON object -> validated
-- against the FINAL resolved category exactly as 0059 did (
-- VEHICLE_DETAILS_NOT_ALLOWED / RENTAL_DETAILS_NOT_ALLOWED when the final
-- category does not support it) and upserted via the identical
-- ON CONFLICT (listing_id) DO UPDATE 0059 already used -- the *contents* of
-- the vehicle/rental object still replace the whole row per call (any
-- sub-field omitted from the object is stored as NULL), unchanged from
-- 0059; only the new top-level presence/null/object three-way distinction
-- is new. patch key present as JSON null -> the extension row is deleted
-- outright, unconditionally (deleting is always safe -- there is no orphan
-- risk from removing an extension row while its listing's category still
-- happens to support one). Independently of any of the above, the
-- automatic "category changed to something incompatible -> delete the
-- now-invalid extension row" cleanup from 0059 is preserved verbatim and
-- runs regardless of whether the patch touched vehicle_details/
-- rental_details at all.
--
-- Preserved verbatim from 0059/publish_listing/create_listing: SECURITY
-- DEFINER, set search_path = '', REVOKE ALL FROM public/anon, GRANT EXECUTE
-- TO authenticated only, identity exclusively from auth.uid(), the caller's
-- shop resolved via owner_id, the seller_suspended/account_suspended
-- restriction check, the listing row locked FOR UPDATE as the universal
-- serialization point before any read/write of it or its child tables, the
-- draft-only edit gate (LISTING_NOT_DRAFT), all final-state validation
-- rules (category/type/condition cross-validation, Fair-requires-
-- known_flaws, price/original-price, stock >= 1, location hierarchy),
-- public_code never written, slug regenerated only when the final title
-- differs from the stored title, one implicit transaction per call with no
-- explicit COMMIT, and zero references to orders/order_items/
-- inventory_reservations/snapshots.

drop function if exists public.update_listing(
  uuid, text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean,
  text, text, integer, integer, integer, integer, text, public.fulfillment_method_enum[], jsonb, jsonb
);

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

  -- ===================== original price: nullable, explicit JSON null clears it =====================
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
