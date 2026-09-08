-- Seller Listing Management, canonical correction: closes the seller
-- policy-acceptance gap PRD 5.5 requires and 0057's own header reported as
-- a real, un-invented gap ("This migration does not gate on it and does
-- not invent a new column/table to track it... Reported explicitly as a
-- real gap that must be closed... before this PRD requirement can actually
-- be enforced"). Adds exactly one nullable profiles column, exactly one new
-- RPC (accept_seller_policies), and one additional check inside
-- publish_listing. Signup-time Terms of Use / Privacy Policy acceptance
-- (PRD 5.5's other sentence) and any future policy-versioning/re-acceptance
-- design are both explicitly out of scope, per the investigation this
-- migration is based on: canon is silent on both, and inventing either now
-- would not be implementing a canonical requirement.
--
-- Why 0057 is not edited in place
-- -----------------------------------------------------------------------
-- 0057_publish_listing_rpc.sql is already applied live. Per this project's
-- repeatedly-established rule (0050, 0055, 0056's own headers for the
-- identical situation), an already-applied migration file is never edited
-- -- a correction gets its own new file. 0057 is left byte-for-byte
-- untouched; this migration is publish_listing's next, current home.
-- publish_listing's parameter list (just p_listing_id uuid) is completely
-- unchanged, so this is again CREATE OR REPLACE FUNCTION against the
-- identical signature, not a DROP + re-create.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0057_publish_listing_rpc (confirmed live via
-- list_migrations, no drift). profiles columns confirmed exactly as 0004
-- left them: id, display_name, avatar_storage_path, province_id, city_id,
-- barangay_id, deleted_at, created_at, updated_at -- no terms/policy/
-- consent column of any kind (confirmed by a prior read-only investigation:
-- a full-text search of every migration and profiles' own column list
-- found zero acceptance-tracking infrastructure anywhere in this schema,
-- including for the separate, still-unbuilt signup-time Terms of
-- Use/Privacy Policy acceptance PRD 5.5 also requires). No
-- accept_seller_policies or similarly-named function exists anywhere --
-- clean namespace. publish_listing confirmed exactly as 0057 left it (full
-- source re-read immediately before writing this file).
--
-- Schema change: the smallest justified one
-- -----------------------------------------------------------------------
-- `alter table profiles add column seller_policies_accepted_at timestamptz`
-- -- nullable, no default, no CHECK. NULL means "not yet accepted";
-- non-null means "accepted, at this timestamp" -- no separate boolean
-- column, matching the exact shape already established by profiles.
-- deleted_at on the same table (a single nullable timestamp meaning
-- "this happened once, permanently, or never"). PRD 5.5 names Marketplace
-- Rules and Prohibited Items Policy as one combined bullet ("sellers must
-- also accept: Marketplace Rules, Prohibited Items Policy"), not two
-- independent consents, so one shared timestamp for both is the correct,
-- smallest representation -- not an arbitrary merge of two unrelated
-- things. No policy-version identifier or audit metadata (IP/user-agent)
-- column is added: canon specifies none, and building one now would be
-- inventing a requirement, not implementing one (see the prior read-only
-- investigation this migration is based on).
--
-- accept_seller_policies: idempotent, no client-supplied timestamp
-- -----------------------------------------------------------------------
-- Locks the caller's own profile row FOR UPDATE (the same universal
-- serialization point convention used everywhere else in this schema) so
-- two concurrent calls cannot both observe NULL and race to set slightly
-- different timestamps. If seller_policies_accepted_at is already non-null,
-- it is left completely untouched and that original value is returned --
-- accepting twice is a safe no-op, never a silent re-stamp. p_accepted_at
-- is never a parameter, so a client can never supply or overwrite the
-- timestamp; the only value ever written is this function's own
-- transaction-stable now(). No p_user_id/p_profile_id parameter exists --
-- identity comes exclusively from auth.uid().
--
-- publish_listing: one additional gate, unconditional on every call
-- -----------------------------------------------------------------------
-- Checked on every publish call, not "only the seller's first listing" --
-- these are behaviorally identical given a persistent, never-cleared
-- acceptance flag (once set, every later publish call's check trivially
-- passes; it can only ever actually block a genuinely-unaccepted seller's
-- first attempt), and checking unconditionally is simpler and race-free
-- compared to trying to detect "is this actually my first listing," which
-- would need its own fragile query against other listings. Placed
-- immediately after the existing auth/shop/restriction/listing-ownership/
-- draft-status checks and before the field-completeness validation block,
-- exactly as directed -- a seller who has not accepted never even reaches
-- the completeness checks, matching this function's existing "cheapest/
-- most-fundamental gate first" ordering (auth, then shop, then
-- restrictions, then ownership, then this, then field-by-field
-- completeness). Every other 0057 rule is preserved verbatim: draft-only
-- transition, full completeness validation, the inquiry-only fulfillment
-- exception, the Pre-loved/Brand-New image rules, draft -> available only,
-- no inventory reservation, no orders/order_items writes, the FOR UPDATE
-- listing lock, published_at behavior, and all grants/security posture.
--
-- Security: both accept_seller_policies and the updated publish_listing
-- remain SECURITY DEFINER, set search_path = '', REVOKE ALL FROM
-- public/anon, GRANT EXECUTE TO authenticated only. No client-supplied
-- identity, timestamp, or listing field of any kind.

alter table profiles
  add column seller_policies_accepted_at timestamptz;

-- ============================================================
-- accept_seller_policies
-- ============================================================
create or replace function public.accept_seller_policies()
returns table (
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_accepted_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock the caller's own profile row (universal serialization point) =====================
  select p.seller_policies_accepted_at into v_accepted_at
    from public.profiles p
    where p.id = v_caller
    for update;

  if not found then
    raise exception 'Profile not found.' using detail = 'PROFILE_NOT_FOUND';
  end if;

  -- ===================== idempotent: set once, preserve the original timestamp thereafter =====================
  if v_accepted_at is null then
    v_accepted_at := now();

    update public.profiles as p
      set seller_policies_accepted_at = v_accepted_at
      where p.id = v_caller;
  end if;

  return query
    select v_accepted_at;
end;
$$;

revoke all on function public.accept_seller_policies() from public;
revoke all on function public.accept_seller_policies() from anon;
grant execute on function public.accept_seller_policies() to authenticated;

-- ============================================================
-- publish_listing (adds the seller policy-acceptance gate only)
-- ============================================================
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

  -- ===================== seller policy acceptance (PRD 5.5) -- checked on every publish call =====================
  select p.seller_policies_accepted_at into v_seller_policies_accepted_at
    from public.profiles p
    where p.id = v_caller;

  if v_seller_policies_accepted_at is null then
    raise exception 'You must accept the Marketplace Rules and Prohibited Items Policy before publishing.' using detail = 'SELLER_POLICIES_NOT_ACCEPTED';
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
