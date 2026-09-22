-- Brand New condition auto-assignment: resolves a genuine implementation
-- defect against unanimous canonical text (PRD 10.1, ARCHITECTURE.md
-- "Condition rules", ARCHITECTURE_ESSENTIALS.md, CLAUDE.md). All four
-- sources agree: "Brand New listing => condition automatically brand_new".
-- The Condition control has always been correctly hidden in the seller
-- form for Brand New (ListingForm.tsx), with copy promising the value is
-- assigned automatically -- but no code path anywhere (client or server)
-- ever actually set it. A Brand New listing's `condition` column has
-- therefore always been left NULL unless the seller happened to select a
-- Pre-loved condition first and then switched listing type without it
-- being cleared (not the normal flow). At publish time,
-- validate_published_listing (0094, unchanged by this migration) correctly
-- raises CONDITION_REQUIRED for a NULL condition, which is why every
-- Brand New listing has been unable to publish.
--
-- Root cause confirmed by exhaustive trace (LAUNCH UX read-only audit,
-- performed before this file was written): create_listing (latest:
-- 0100_allow_incomplete_fair_condition_draft.sql) and update_listing
-- (same file) both cross-validate an explicit, non-null condition against
-- listing_type, but neither ever derives/assigns a null one. publish_listing
-- (0094_published_listing_editing.sql) never writes `condition` at all; it
-- only validates and flips status. This has been true since the earliest
-- revisions of all three functions (0054/0059/0057) -- not a regression.
--
-- Fix: three functions, one predicate each, no relaxation of validation
-- -----------------------------------------------------------------------
-- Whenever the FINAL/effective listing_type is 'brand_new' and the
-- resolved condition is NULL (omitted, or explicitly cleared -- exactly
-- what today's client sends), derive condition := 'brand_new'. An
-- EXPLICIT, non-null, incompatible condition (e.g. 'fair') is a genuine
-- contradiction, not an absence, and remains rejected by the existing,
-- unchanged LISTING_TYPE_CONDITION_MISMATCH checks in all three functions
-- -- this migration never touches those checks. Pre-loved + explicit
-- condition='brand_new' likewise remains rejected, unchanged.
--
--   create_listing: derives on `p_condition is null` after its own
--     existing (unchanged) mismatch check, before the row is inserted.
--   update_listing: derives on the resolved `v_final_condition is null`
--     after its own existing (unchanged) mismatch check, before the row
--     is updated. Reached only for a Draft the caller already owns (this
--     function's own pre-existing LISTING_NOT_DRAFT/NOT_LISTING_OWNER
--     gates, both untouched).
--   publish_listing: the one path the two functions above cannot reach --
--     an existing Draft published directly, with no intervening
--     create_listing/update_listing call. Because
--     validate_published_listing performs its own independent, fresh
--     `select l.* into strict v_listing ... where l.id = p_listing_id`
--     (0094, unchanged), a local PL/pgSQL variable correction alone would
--     not be visible to it -- the fix here is therefore a real
--     `update public.listings set condition = 'brand_new' where id =
--     p_listing_id`, executed on the row already locked by this
--     function's own pre-existing `for update` (line ~283 of the 0094
--     definition) and only after every existing authorization/eligibility
--     check (ownership, Draft-status, seller-policy acceptance) has
--     already passed -- an unauthorized or ineligible caller is rejected
--     before ever reaching this statement, exactly as today. It runs
--     immediately before the existing, unchanged call to
--     validate_published_listing, inside the same implicit transaction as
--     the rest of the function -- a later validation failure (or any
--     other exception) aborts the whole transaction and rolls this
--     UPDATE back with it, per ordinary Postgres/PL/pgSQL semantics
--     (publish_listing has no exception handler that could swallow that).
--
-- Trigger/revision/timestamp effects, source-inspected against pg_trigger/
-- pg_get_triggerdef on the live project -- NOT runtime-verified against an
-- actual publish_listing execution (no rehearsal database was available;
-- see this task's own database-rehearsal suite, tests/database/brand-new-
-- condition-fix.*, for the still-outstanding runtime proof)
-- -----------------------------------------------------------------------
-- public.listings carries exactly two BEFORE UPDATE FOR EACH ROW triggers,
-- neither modified, redefined, disabled, or otherwise touched by this
-- migration:
--
--   guard_listing_revision (0094) only bumps `revision` when
--   `old.published_at is not null or new.published_at is not null or
--   old.status in ('available','paused','reserved','sold')`; for every
--   other row (i.e. an ordinary Draft not yet transitioning to Available
--   in THIS statement) it takes the `else` branch and holds revision at
--   its current value regardless of what else changed. The new UPDATE
--   inside publish_listing runs BEFORE the existing status/published_at-
--   flipping UPDATE in the same function, so at the moment it fires the
--   row is still status='draft' with published_at still NULL -- none of
--   the trigger's three bump conditions is true, so `revision` should be
--   left unchanged (per the trigger's own documented "Drafts remain at
--   zero until publication" contract). The immediately-following,
--   pre-existing status-flip UPDATE bumps revision exactly as it always
--   has -- unaffected, unchanged, still exactly one bump per publish.
--
--   set_updated_at (0008_listings.sql, `before update on listings for
--   each row execute function extensions.moddatetime('updated_at')`) has
--   always fired on every UPDATE to this table, independently of this
--   migration -- it is why update_listing's own pre-existing UPDATE
--   returns a real `updated_at` value despite never setting that column
--   in its own SET clause. The new normalization UPDATE this migration
--   adds inside publish_listing causes one additional firing of this
--   trigger, immediately before the pre-existing status-flip UPDATE's own
--   firing of the same trigger, both within the same transaction.
--   moddatetime is documented to derive its value from the current
--   transaction's timestamp, which is stable across statements within one
--   transaction, so both firings should set `updated_at` to the same
--   value -- meaning the final persisted `updated_at` should be
--   unaffected relative to pre-migration behavior. guard_listing_revision
--   already excludes `updated_at` from its own change-detection diff, so
--   this extra firing should not interact with the revision-bump logic
--   above either.
--
-- order_items.listing_condition_snapshot (0094) is populated only by
-- order-creation RPCs, never read or written here -- no interaction; a
-- Draft can have no orders yet.
--
-- Why 0094/0100 are not edited in place
-- -----------------------------------------------------------------------
-- Both are already applied live. Per this project's established rule, an
-- already-applied migration file is never edited -- a correction gets its
-- own new file. This migration is create_listing's, update_listing's, and
-- publish_listing's next, current home; 0094 and 0100 are left
-- byte-for-byte untouched. All three functions' parameter lists (names,
-- types, order, count) are completely unchanged, so all three are
-- CREATE OR REPLACE FUNCTION against identical signatures, not a
-- DROP + re-create.
--
-- Objects deliberately NOT touched by this migration: validate_published_
-- listing, update_listing_status, update_published_listing,
-- replace_listing_images, get_published_listing_edit_state,
-- guard_listing_revision, every RLS policy, every Storage policy, every
-- listing enum/column, the listings_type_condition_check /
-- listings_fair_requires_known_flaws_check CHECK constraints. No backfill
-- UPDATE against existing rows is included -- every existing Draft is
-- healed lazily, the next time it is saved OR published, by the
-- corrected functions themselves; no explicit data migration is required
-- for the publish journey to succeed. Fair/Known-Flaws publish-time
-- enforcement (migration 0100) is untouched and orthogonal (a different
-- condition value, a different check, in a different function --
-- validate_published_listing).
--
-- Security: unchanged from 0100/0094 for all three functions -- SECURITY
-- DEFINER, set search_path = '', identical REVOKE/GRANT shape, no
-- client-supplied owner/public_code/slug/status/cover_image_id/revision.
-- No RLS, Storage policy, or grant on any other object is touched. No new
-- schema object, enum, index, or trigger is added.

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
  v_caller_deleted_at timestamptz;
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

  -- ===================== Brand New condition auto-assignment (canonical rule: PRD 10.1, ARCHITECTURE.md "Condition rules") =====================
  -- A NULL/omitted condition for an effective Brand New listing type is the
  -- normal, expected shape this form's own UI produces (the Condition
  -- control is deliberately hidden for Brand New) -- distinct from the
  -- explicit-incompatible-value case the mismatch check above already
  -- rejects (e.g. an explicit 'fair'), which remains rejected unchanged.
  -- p_condition is reassigned directly (a plain PL/pgSQL parameter is a
  -- local variable within the function body) since it is what the later
  -- INSERT below already uses verbatim -- no new variable is introduced.
  if p_listing_type = 'brand_new' and p_condition is null then
    p_condition := 'brand_new';
  end if;

  -- ===================== known flaws (normalized only; Fair's requirement is enforced at publish time, not here -- see this migration's header) =====================
  v_known_flaws := nullif(btrim(p_known_flaws), '');

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

  -- ===================== Brand New condition auto-assignment (canonical rule: PRD 10.1, ARCHITECTURE.md "Condition rules") =====================
  -- Mirrors create_listing's own identical derivation above -- a resolved
  -- NULL condition against a resolved brand_new listing_type is the
  -- normal, expected shape (the client's own Condition control is hidden
  -- for Brand New and, until this fix, never sent a value); an explicit,
  -- non-null, incompatible condition remains rejected by the unchanged
  -- mismatch check immediately above this block, never silently
  -- overridden.
  if v_final_listing_type = 'brand_new' and v_final_condition is null then
    v_final_condition := 'brand_new';
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

  -- ===================== known flaws requirement moved to publish time -- see this migration's header =====================

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

  -- ===================== Brand New condition auto-assignment, before strict validation =====================
  -- Closes the one path create_listing/update_listing's own derivation
  -- cannot reach: an existing Draft (created before this fix, or simply
  -- never re-saved since) published directly with no intervening
  -- update_listing call. validate_published_listing below performs its
  -- own independent, fresh read of this row, so this must be a real
  -- UPDATE on the row already locked above -- a local variable correction
  -- alone would not be visible to that fresh read. Reached only after
  -- every authorization/eligibility check above (ownership, Draft status,
  -- seller-policy acceptance) has already passed -- an unauthorized or
  -- ineligible caller never reaches this statement. Runs before the
  -- status transition below, so guard_listing_revision's own "Drafts
  -- remain at zero" branch still applies to this UPDATE -- no extra
  -- revision bump (see this migration's header for the full trigger
  -- analysis). If validate_published_listing (or anything else below)
  -- subsequently raises, this UPDATE is rolled back with the rest of the
  -- transaction -- this function has no exception handler that could
  -- swallow that.
  if v_listing_type = 'brand_new' and v_condition is null then
    update public.listings as l
      set condition = 'brand_new'
      where l.id = p_listing_id;
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

revoke all on function public.publish_listing(uuid) from public;
revoke all on function public.publish_listing(uuid) from anon;
grant execute on function public.publish_listing(uuid) to authenticated;
