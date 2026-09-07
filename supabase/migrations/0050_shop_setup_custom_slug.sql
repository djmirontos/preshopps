-- Seller Shop Setup, correction: seller-customizable slug during setup
-- (PRD 6.3). Touches create_shop ONLY -- update_shop and
-- generate_unique_shop_slug (both from 0049_shop_create_update_rpcs.sql)
-- are completely untouched. No new table, no new enum, no RLS policy
-- change.
--
-- Why this migration exists as its own file (found during inspection, not
-- assumed)
-- -----------------------------------------------------------------------
-- 0049_shop_create_update_rpcs.sql was already applied live before this
-- correction was requested. Editing an already-applied migration file in
-- place is exactly the mistake this migration corrects: the original
-- 0049 file has been restored verbatim to the version that was actually
-- applied (7-argument create_shop, no p_slug, no DROP FUNCTION statement,
-- "Slug generation" header framed as deferred) -- this migration is the
-- properly-versioned home for the slug-customization delta instead.
--
-- Adding p_slug changes create_shop's own signature (Postgres identifies a
-- function by name + parameter type list) -- CREATE OR REPLACE alone would
-- therefore create a second, additional 7-vs-8-argument overload rather
-- than replacing the original, so the old signature is dropped first.
--
-- Slug generation -- seller-customizable during setup only
-- -----------------------------------------------------------------------
-- create_shop now accepts an optional p_slug: when omitted (null/blank),
-- behavior is byte-for-byte unchanged from 0049 -- the slug is
-- server-derived from p_name via generate_unique_shop_slug (0049,
-- untouched), which normalizes the name and appends a numeric suffix on
-- collision against shop_slugs' global namespace. When a non-blank p_slug
-- is supplied, it is validated against the identical format rule as
-- shops.slug's own CHECK constraint (`^[a-z0-9]+(-[a-z0-9]+)*$`) and
-- checked for availability against shop_slugs directly (SLUG_UNAVAILABLE
-- if already taken, current OR historical -- shop_slugs is one flat,
-- append-only, global namespace with no is_current filter on this check,
-- so a request for a previously-used-then-abandoned slug is rejected
-- exactly like a slug some other shop is actively using right now).
-- update_shop intentionally gets no equivalent parameter -- PRD 6.3's "may
-- edit during setup" is a creation-time behavior only; ongoing seller slug
-- editing after creation is a separate, not-yet-approved surface.
-- shop_slugs' history model is not weakened in any way: no DELETE is
-- introduced, the rename-preserves-history behavior in update_shop is
-- completely untouched, and a renamed-away-from slug remains permanently
-- reserved exactly as before.
--
-- Race safety: a same-instant collision on either shops.slug's own UNIQUE
-- constraint or shop_slugs' PRIMARY KEY is caught via unique_violation +
-- GET STACKED DIAGNOSTICS (constraint_name), distinguishing it from the
-- pre-existing shops_owner_id_key collision (SHOP_ALREADY_EXISTS) so both
-- race outcomes still map to the correct, distinct, safe error code.
--
-- Security: unchanged posture from 0049 -- SECURITY DEFINER,
-- SET search_path = '', caller identity exclusively from auth.uid().
-- REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only,
-- reapplied for the new 8-argument signature (the old 7-argument grants
-- are moot once that signature no longer exists).

-- Adding p_slug changes the function's own signature -- CREATE OR REPLACE
-- alone would create a second, additional 7-vs-8-argument overload rather
-- than replacing the original, so the old signature is dropped first.
drop function if exists public.create_shop(text, text, integer, integer, integer, text, text);

create or replace function public.create_shop(
  p_name text,
  p_description text default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_messenger_link text default null,
  p_logo_storage_path text default null,
  p_slug text default null
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
  v_requested_slug text;
  v_slug text;
  v_shop_id uuid;
  v_created_at timestamptz;
  v_constraint_name text;
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

  -- ===================== slug: seller-supplied (PRD 6.3, optional) or server-derived from name =====================
  v_requested_slug := nullif(btrim(p_slug), '');

  if v_requested_slug is not null then
    if v_requested_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'Shop URL must be lowercase letters, numbers, and hyphens only.' using detail = 'SLUG_INVALID';
    end if;

    -- Pre-check against shop_slugs directly (current AND historical --
    -- no is_current filter); the final guard against a same-instant race
    -- is the exception handler below, which covers both shops.slug's own
    -- UNIQUE constraint and shop_slugs' PRIMARY KEY.
    if exists (select 1 from public.shop_slugs ss where ss.slug = v_requested_slug) then
      raise exception 'That shop URL is already taken.' using detail = 'SLUG_UNAVAILABLE';
    end if;

    v_slug := v_requested_slug;
  else
    v_slug := public.generate_unique_shop_slug(v_name);
  end if;

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

    insert into public.shop_slugs (slug, shop_id, is_current, created_at)
      values (v_slug, v_shop_id, true, v_created_at);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'shops_owner_id_key' then
        raise exception 'You already have a shop.' using detail = 'SHOP_ALREADY_EXISTS';
      else
        -- shops_slug_key or shop_slugs_pkey -- either way, a same-instant
        -- race claimed this exact slug first.
        raise exception 'That shop URL is already taken.' using detail = 'SLUG_UNAVAILABLE';
      end if;
  end;

  return query
    select v_shop_id, v_slug, v_created_at;
end;
$$;

revoke all on function public.create_shop(text, text, integer, integer, integer, text, text, text) from public;
revoke all on function public.create_shop(text, text, integer, integer, integer, text, text, text) from anon;
grant execute on function public.create_shop(text, text, integer, integer, integer, text, text, text) to authenticated;
