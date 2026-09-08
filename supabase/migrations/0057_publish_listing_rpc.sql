-- Seller Listing Management, publish foundation: exactly one new SECURITY
-- DEFINER RPC, publish_listing -- the draft -> available transition and the
-- strict completeness validation boundary the canonical decision locks
-- (PRD 10.6 / ARCHITECTURE / ARCHITECTURE_ESSENTIALS / AGENTS.md /
-- CLAUDE.md: "Draft may be incomplete. Publishing is the strict validation
-- boundary."). No new table, enum, or RLS policy. update_listing,
-- pause/resume/archive/mark-sold, image-management, and frontend are all
-- explicitly out of scope for this migration.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0056_draft_title_required_description_optional
-- (confirmed live via list_migrations, no drift). listings columns
-- confirmed exactly as 0055/0056 left them: title not null (never
-- relaxed), description/category_id/listing_type/condition/price_cents/
-- province_id/city_id all nullable, stock_quantity not null default 1,
-- barangay_id nullable, status listing_status_enum default 'draft',
-- published_at nullable with no default. listing_images confirmed exactly
-- as 0009 left it: id, listing_id (FK CASCADE), storage_path (non-blank
-- CHECK), position (>= 0 CHECK only -- no upper bound, no minimum-count
-- constraint of any kind), is_reference_image (not null default false),
-- created_at. listing_fulfillment_methods/listing_vehicle_details/
-- listing_rental_details confirmed unchanged since 0008. categories
-- confirmed unchanged since 0005 (13 fixed rows, is_inquiry_only boolean).
-- user_restrictions/restriction_type_enum confirmed unchanged. No
-- publish_listing or similar function exists anywhere -- clean namespace.
-- No table or column anywhere in the schema tracks Marketplace
-- Rules/Prohibited Items Policy acceptance (confirmed by a full-text
-- search of every migration for terms/polic/accept/agreement-shaped
-- column names on profiles/shops -- none exist) -- see "Policy acceptance
-- gap" below.
--
-- Reference/catalog image gap -- reported, not silently worked around
-- -----------------------------------------------------------------------
-- PRD 11.2 allows a Brand New listing to additionally include labeled
-- Reference/Catalog images. create_listing (0054/0055/0056) always inserts
-- every listing_images row with is_reference_image = false -- there is
-- currently NO RPC anywhere that can ever set is_reference_image = true.
-- This migration does not invent one: creating/labeling images is
-- image-management's job (a future update_listing or dedicated RPC), not
-- publish_listing's. What IS implemented here is the full, correct
-- VALIDATION logic against whatever is_reference_image values actually
-- exist: Pre-loved listings are rejected if any reference image is present
-- (REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED), and Brand New listings must
-- have at least one actual-item (is_reference_image = false) photo
-- (BRAND_NEW_REQUIRES_ACTUAL_IMAGE). Given today's reality, the Pre-loved
-- check can never actually fire (no row can be a reference image yet) and
-- the Brand New check always passes trivially (every image is an actual
-- item today) -- but the logic is written generically against the real
-- column, not hardcoded to today's all-false reality, so it needs no
-- further change once an image-management RPC exists that can set
-- is_reference_image = true.
--
-- Policy acceptance gap -- reported, not invented
-- -----------------------------------------------------------------------
-- PRD 5.5: "Before publishing their first listing, sellers must also
-- accept: Marketplace Rules, Prohibited Items Policy." No column, table, or
-- existing RPC anywhere in this schema records this acceptance. This
-- migration does not gate on it and does not invent a new column/table to
-- track it -- doing so would be a materially new product surface (an
-- acceptance-tracking mechanism, likely UI-facing) well beyond "the
-- smallest additive migration needed for publish_listing", and the task's
-- own instruction is to enforce this only if the mechanism is "already
-- canonical" at the data-model level, which it is not. Reported explicitly
-- as a real gap that must be closed (a small tracking column/table plus
-- this RPC checking it) before this PRD requirement can actually be
-- enforced.
--
-- Away status is not seller suspension
-- -----------------------------------------------------------------------
-- shop_status_enum {active, away} is read nowhere in this function. PRD 6.5
-- never states Away blocks any seller action, matching create_listing's
-- own identical reasoning (0054's header) for the same question -- only
-- user_restrictions (seller_suspended/account_suspended) gates a seller
-- write, exactly as create_listing and upsert_review_reply already do.
--
-- Publish completeness, precisely mapped to canon
-- -----------------------------------------------------------------------
-- title: re-validated defensively even though it is structurally
-- impossible to be blank today (listings.title has stayed NOT NULL with a
-- non-blank CHECK since 0008, untouched by every Draft-incompleteness
-- migration) -- matches this schema's own "explicit check as a friendly
-- backstop to the real constraint" convention used everywhere else, and
-- protects this RPC if title's nullability were ever relaxed later without
-- this function being revisited.
-- description/category/listing_type/condition/price/province/city: each
-- was made nullable specifically so Draft could omit it (0055/0056) --
-- publish is exactly the boundary that requires them again, so each gets
-- an explicit "is null" rejection here.
-- listing_type/condition cross-validation and Fair-requires-known_flaws:
-- identical predicate shape to create_listing's own pre-checks (which
-- mirror listings_type_condition_check /
-- listings_fair_requires_known_flaws_check exactly) -- now unconditional,
-- since both operands are already guaranteed non-null by the checks above.
-- stock_quantity >= 1: already structurally guaranteed (not null default 1,
-- plus listings_stock_quantity_check) -- re-checked defensively only, can
-- never actually fire today.
-- barangay "optional but valid if supplied": already guaranteed correct by
-- create_listing's own insert-time validation (composite FK cannot drift
-- without an update RPC, which does not exist yet) -- not re-validated
-- here to avoid redundant work; flagged so a future update_listing knows
-- this invariant must be preserved if barangay ever becomes editable.
-- fulfillment methods "where applicable": required (>= 1 row) only when
-- the listing's category is NOT is_inquiry_only (Cars/Motorcycles/For
-- Rent skip the normal cart/fulfillment flow entirely per PRD 13.3) --
-- resolved from categories.is_inquiry_only, the same existing data-driven
-- flag create_listing already uses for vehicle/rental eligibility, not a
-- hardcoded category list.
-- images: 1-8 total (0009's own header explicitly deferred both bounds to
-- "the future trusted publish/image-management path" -- this is that
-- path), plus the Pre-loved/Brand-New rules above.
-- vehicle/rental: no additional validation. Every field in both detail
-- tables is optional per PRD 13.1/13.2, the row's own existence is not
-- required (0008/0009's own header), and whatever IS stored already
-- satisfies its own table's CHECK constraints from insert time -- there is
-- nothing further canon requires at publish.
--
-- State / inventory
-- -----------------------------------------------------------------------
-- Only draft -> available. published_at is set to the transaction-stable
-- now() (always NULL beforehand, since no publish/un-publish path has ever
-- existed before this migration). reserved_quantity is never referenced or
-- written -- it stays at whatever create_listing left it (0; no order can
-- reference a draft listing, since draft listings are never visible to
-- buyers). No row in orders/order_items/inventory_reservations is read or
-- written. Publishing does not reserve inventory, matching PRD 21.6's own
-- "submitting an order request does not reserve stock" precedent extended
-- to publishing itself (an even earlier point in the lifecycle).
--
-- Atomicity/security: SECURITY DEFINER, set search_path = '', caller
-- identity exclusively from auth.uid(), the listing row is locked FOR
-- UPDATE as the universal serialization point (prevents a double-publish
-- race), REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only.
-- No client-supplied status, shop id, owner id, or listing field of any
-- kind -- p_listing_id is the only parameter, an opaque lookup key whose
-- ownership is re-derived from the row itself, never trusted from the
-- client.

create or replace function public.publish_listing(
  p_listing_id uuid
)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  status public.listing_status_enum,
  published_at timestamptz
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
  if v_stock_quantity is null or v_stock_quantity < 1 then
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
