-- Seller Shop Setup + Management module, write layer: create_shop and
-- update_shop -- exactly two new SECURITY DEFINER RPCs, plus one private
-- (ungranted) slug-generation helper they both call. No new table, no new
-- enum, no RLS policy change, no existing function touched.
--
-- Why this migration is needed (found during inspection, not assumed)
-- -----------------------------------------------------------------------
-- 0007_shops.sql's own header is explicit: "Until that RPC exists,
-- application code must not be permitted to create shops directly ... RLS
-- is already enabled on both tables with zero policies defined, so every
-- client write is already default-denied." Confirmed still true live:
-- shops carries exactly one policy (shops_select_owner, SELECT only, added
-- by 0031 for messaging's own needs) and shop_slugs carries zero policies
-- of any kind. No create_shop/update_shop/rename_shop function exists
-- anywhere in the migration history. This migration builds exactly the
-- write path 0007 deferred, following the same pattern already used for
-- reviews (0034) and every order-lifecycle RPC: SECURITY DEFINER, owner
-- identity from auth.uid() only, RLS stays at zero policies for direct
-- client writes.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0048_media_storage_foundation (confirmed live
-- via list_migrations, no drift). shops columns confirmed exactly as 0007
-- left them: id, owner_id (UNIQUE, FK profiles RESTRICT), name (NOT NULL,
-- non-blank CHECK, no length CHECK), slug (NOT NULL, UNIQUE, format CHECK
-- `^[a-z0-9]+(-[a-z0-9]+)*$`), description (nullable, no CHECK),
-- logo_storage_path (nullable), province_id/city_id (NOT NULL, composite
-- FK hierarchy), barangay_id (nullable, composite FK to city),
-- messenger_link (nullable), status (shop_status_enum, NOT NULL, default
-- 'active' -- confirmed live the enum has EXACTLY {active, away}, no
-- 'suspended' member exists at the type level, so a client can never pass
-- an invalid status value through this RPC's typed parameter regardless of
-- validation logic), is_trusted_seller/trusted_seller_calculated_at
-- (system-only, never exposed as a parameter here or anywhere below).
-- shop_slugs confirmed exactly as 0007 left it: slug (PK, global
-- namespace, format CHECK), shop_id (FK RESTRICT), is_current (exactly one
-- TRUE row per shop via the partial unique index). provinces/
-- cities_municipalities/barangays confirmed exactly as 0003/0006 left
-- them (integer identity PKs, composite-FK hierarchy); confirmed live all
-- three tables currently hold zero rows (a data-seeding gap, out of this
-- migration's scope -- reported separately, not fabricated here).
--
-- Slug generation -- a deliberate, smallest-scope product decision
-- -----------------------------------------------------------------------
-- PRD 6.3 allows a seller to customize their slug during setup, but this
-- task's own brief frames it as backend-authoritative-preferred ("If
-- frontend must provide slug: generate a sensible default from name ...
-- backend remains authoritative for uniqueness"). Building seller-editable
-- slug UI/validation is a materially separate surface from "create/update
-- my shop" and is not in this task's field list (Section 4) -- deferred,
-- not built here. The slug is therefore always derived from p_name
-- server-side (never trusted from the client at all -- no p_slug
-- parameter exists on either RPC), via the private helper below, which
-- normalizes the name and appends a numeric suffix on collision against
-- shop_slugs' global namespace. shop_slugs is append-only and global (a
-- renamed-away-from slug is never freed, per 0007's own design), so no
-- "exclude this shop's own current slug" parameter is needed.
--
-- create_shop: buyer-derived-to-seller creation, one shop per account
-- -----------------------------------------------------------------------
-- ONE_SHOP_ALREADY_EXISTS is both an explicit pre-check (clear error code)
-- and structurally guaranteed by shops.owner_id's own UNIQUE constraint
-- (caught as a fallback via unique_violation, matching create_review's own
-- pre-check-plus-catch pattern). status is never a parameter -- every new
-- shop starts 'active' via the column default, matching "Existing seller
-- may toggle Active/Away" (Section 9) reading naturally as an
-- already-has-a-shop action, not a creation-time one. featured_listing_id
-- is never a parameter -- it does not exist as a column at all yet (0007's
-- own header: deferred until listings exist, added later by a dedicated
-- ALTER TABLE once the Listings module ships), so there is nothing to wire
-- up regardless of this task's own "Section 10" framing.
--
-- update_shop: full-replace update of the caller's own shop only
-- -----------------------------------------------------------------------
-- Locates the caller's shop via owner_id = auth.uid() (never a client-
-- supplied shop id) -- SHOP_NOT_FOUND if the caller has no shop yet
-- ("create your shop first"). p_status is typed shop_status_enum, so
-- Postgres itself rejects any value outside {active, away} at the call
-- boundary -- no runtime branch could ever accept a 'suspended' or other
-- admin-only value even if one existed in the enum (it doesn't). Slug is
-- only regenerated when the name actually changes into a different
-- normalized base than the current slug -- a save with an unchanged name
-- never touches shop_slugs, avoiding pointless slug churn on every save.
-- When the name does change enough to need a new slug: insert the new
-- current-slug row, flip the previous current-slug row's is_current to
-- false (never deleted -- it keeps resolving via get_shop_detail's
-- existing historical-slug lookup, preserving PRD 6.3's "old slugs
-- redirect" guarantee untouched), update shops.slug (the cache). Never
-- accepts or writes is_trusted_seller/trusted_seller_calculated_at --
-- there is no parameter for either, so a seller cannot self-mark Trusted
-- Seller through this RPC no matter what a malicious client sends.
--
-- Logo path trust boundary
-- -----------------------------------------------------------------------
-- p_logo_storage_path is optional client-supplied metadata (a string, not
-- a verified file reference) -- storage RLS (0048) already guarantees a
-- client can only ever have *uploaded* a real file under
-- `shop-images/{their own auth.uid()}/...`, but nothing stops a client
-- from passing an arbitrary path STRING pointing at a file some other
-- account uploaded, without ever uploading anything themselves. Both RPCs
-- therefore validate (when non-null) that the path is exactly of the form
-- `shop-images/{caller's own auth.uid()}/...` before ever storing it --
-- cheap, in-scope defense-in-depth that closes that specific gap without
-- touching storage architecture at all.
--
-- Security: both RPCs are SECURITY DEFINER, SET search_path = '', every
-- table reference fully schema-qualified. Caller identity derived
-- exclusively from auth.uid() -- no client-supplied owner/user id is ever
-- trusted. REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated
-- only on create_shop/update_shop -- shop management is a sign-in-only
-- surface, matching every other owner-write RPC in this schema. The
-- private slug helper receives no GRANT to any role at all (only
-- reachable from within another SECURITY DEFINER function's own execution
-- context, exactly like a normal internal function call) -- it is not a
-- client-callable RPC.

-- ============================================================
-- generate_unique_shop_slug (private helper, no client grant)
-- ============================================================
create or replace function public.generate_unique_shop_slug(
  p_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
begin
  v_base := lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := btrim(v_base, '-');

  if v_base = '' or v_base is null then
    v_base := 'shop';
  end if;

  v_candidate := v_base;

  while exists (select 1 from public.shop_slugs ss where ss.slug = v_candidate) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix::text;
  end loop;

  return v_candidate;
end;
$$;

-- Postgres grants EXECUTE on every newly created function to PUBLIC by
-- default -- explicitly revoked here so this helper is truly unreachable
-- by any client role, matching the header's own claim. This does NOT
-- affect create_shop/update_shop's own internal calls to it below: a
-- SECURITY DEFINER function's body runs as its OWNER (the role that
-- applied this migration), and Postgres checks EXECUTE privilege against
-- whichever role is currently executing -- inside create_shop/update_shop
-- that is always the owner, which implicitly has EXECUTE on every function
-- it owns regardless of any GRANT/REVOKE to other roles.
revoke all on function public.generate_unique_shop_slug(text) from public;
revoke all on function public.generate_unique_shop_slug(text) from anon;
revoke all on function public.generate_unique_shop_slug(text) from authenticated;

-- ============================================================
-- create_shop
-- ============================================================
create or replace function public.create_shop(
  p_name text,
  p_description text default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_messenger_link text default null,
  p_logo_storage_path text default null
)
returns table (
  shop_id uuid,
  slug text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_name text;
  v_description text;
  v_messenger_link text;
  v_logo_storage_path text;
  v_slug text;
  v_shop_id uuid;
  v_created_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== one shop per account (pre-check; UNIQUE(owner_id) is the final guard) =====================
  if exists (select 1 from public.shops s where s.owner_id = v_caller) then
    raise exception 'You already have a shop.' using detail = 'SHOP_ALREADY_EXISTS';
  end if;

  -- ===================== name (required) =====================
  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'Shop name is required.' using detail = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Shop name is too long.' using detail = 'NAME_TOO_LONG';
  end if;

  -- ===================== description (optional) =====================
  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Shop description is too long.' using detail = 'DESCRIPTION_TOO_LONG';
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

  -- ===================== messenger link (optional; minimal sanity check, no domain allowlist) =====================
  v_messenger_link := nullif(btrim(p_messenger_link), '');
  if v_messenger_link is not null then
    if char_length(v_messenger_link) > 2048 then
      raise exception 'Messenger link is too long.' using detail = 'MESSENGER_LINK_TOO_LONG';
    end if;
    if v_messenger_link !~* '^https?://\S+$' then
      raise exception 'Messenger link must be a valid web address.' using detail = 'INVALID_MESSENGER_LINK';
    end if;
  end if;

  -- ===================== logo path (optional; must be the caller's own storage path) =====================
  v_logo_storage_path := nullif(btrim(p_logo_storage_path), '');
  if v_logo_storage_path is not null and v_logo_storage_path !~ ('^shop-images/' || v_caller::text || '/') then
    raise exception 'Invalid logo image.' using detail = 'INVALID_LOGO_PATH';
  end if;

  -- ===================== slug (server-derived from name, never client-supplied) =====================
  v_slug := public.generate_unique_shop_slug(v_name);

  -- ===================== transaction-stable time =====================
  v_created_at := now();

  begin
    insert into public.shops as s (
      owner_id, name, slug, description, logo_storage_path,
      province_id, city_id, barangay_id, messenger_link,
      created_at, updated_at
    )
    values (
      v_caller, v_name, v_slug, v_description, v_logo_storage_path,
      p_province_id, p_city_id, p_barangay_id, v_messenger_link,
      v_created_at, v_created_at
    )
    returning s.id into v_shop_id;
  exception
    when unique_violation then
      raise exception 'You already have a shop.' using detail = 'SHOP_ALREADY_EXISTS';
  end;

  insert into public.shop_slugs (slug, shop_id, is_current, created_at)
    values (v_slug, v_shop_id, true, v_created_at);

  return query
    select v_shop_id, v_slug, v_created_at;
end;
$$;

revoke all on function public.create_shop(text, text, integer, integer, integer, text, text) from public;
revoke all on function public.create_shop(text, text, integer, integer, integer, text, text) from anon;
grant execute on function public.create_shop(text, text, integer, integer, integer, text, text) to authenticated;

-- ============================================================
-- update_shop
-- ============================================================
create or replace function public.update_shop(
  p_name text,
  p_description text default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_messenger_link text default null,
  p_logo_storage_path text default null,
  p_status public.shop_status_enum default 'active'
)
returns table (
  shop_id uuid,
  slug text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_shop_id uuid;
  v_current_slug text;
  v_name text;
  v_description text;
  v_messenger_link text;
  v_logo_storage_path text;
  v_new_base text;
  v_current_base text;
  v_slug text;
  v_now timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock caller's own shop row (universal serialization point) =====================
  select s.id, s.slug into v_shop_id, v_current_slug
    from public.shops s
    where s.owner_id = v_caller
    for update;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== name (required) =====================
  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'Shop name is required.' using detail = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Shop name is too long.' using detail = 'NAME_TOO_LONG';
  end if;

  -- ===================== description (optional) =====================
  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Shop description is too long.' using detail = 'DESCRIPTION_TOO_LONG';
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

  -- ===================== messenger link (optional; minimal sanity check, no domain allowlist) =====================
  v_messenger_link := nullif(btrim(p_messenger_link), '');
  if v_messenger_link is not null then
    if char_length(v_messenger_link) > 2048 then
      raise exception 'Messenger link is too long.' using detail = 'MESSENGER_LINK_TOO_LONG';
    end if;
    if v_messenger_link !~* '^https?://\S+$' then
      raise exception 'Messenger link must be a valid web address.' using detail = 'INVALID_MESSENGER_LINK';
    end if;
  end if;

  -- ===================== logo path (optional; must be the caller's own storage path) =====================
  v_logo_storage_path := nullif(btrim(p_logo_storage_path), '');
  if v_logo_storage_path is not null and v_logo_storage_path !~ ('^shop-images/' || v_caller::text || '/') then
    raise exception 'Invalid logo image.' using detail = 'INVALID_LOGO_PATH';
  end if;

  -- ===================== slug regeneration only if the name's normalized base actually changed =====================
  v_new_base := lower(regexp_replace(btrim(v_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_new_base := btrim(v_new_base, '-');
  v_current_base := regexp_replace(v_current_slug, '-[0-9]+$', '');

  if v_new_base <> '' and v_new_base is not null and v_new_base <> v_current_base then
    v_slug := public.generate_unique_shop_slug(v_name);
  else
    v_slug := v_current_slug;
  end if;

  v_now := now();

  if v_slug <> v_current_slug then
    update public.shop_slugs as ss set is_current = false where ss.shop_id = v_shop_id and ss.is_current;
    insert into public.shop_slugs (slug, shop_id, is_current, created_at)
      values (v_slug, v_shop_id, true, v_now);
  end if;

  update public.shops as s
    set name = v_name,
        slug = v_slug,
        description = v_description,
        logo_storage_path = v_logo_storage_path,
        province_id = p_province_id,
        city_id = p_city_id,
        barangay_id = p_barangay_id,
        messenger_link = v_messenger_link,
        status = p_status
    where s.id = v_shop_id;

  return query
    select v_shop_id, v_slug, v_now;
end;
$$;

revoke all on function public.update_shop(text, text, integer, integer, integer, text, text, public.shop_status_enum) from public;
revoke all on function public.update_shop(text, text, integer, integer, integer, text, text, public.shop_status_enum) from anon;
grant execute on function public.update_shop(text, text, integer, integer, integer, text, text, public.shop_status_enum) to authenticated;
