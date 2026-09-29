-- list_public_shops -- repository-local database slice only.
-- Repository-local until reviewed/applied. Not deployed by this migration
-- file's mere presence in the repo.
--
-- Why this migration is needed (found during a read-only sitemap
-- feasibility check, not assumed)
-- -----------------------------------------------------------------------
-- A public-shop sitemap needs to enumerate every currently public shop.
-- No existing RPC can do that: get_shop_detail (0036) only resolves one
-- requested slug at a time. Deriving the shop set from browse_listings'
-- own shop_id/shop_slug columns was considered and rejected -- it would
-- only surface shops that currently have at least one available,
-- non-admin-hidden listing, silently excluding any public shop with zero
-- such listings. This is not a hypothetical gap: a live, read-only count
-- against the project immediately before writing this migration found 6
-- of 6 currently-eligible (non-suspended) shops, but only 3 of those 6
-- have any available listing at all -- half of the real, currently
-- public shop set would be missing from a listings-derived enumeration.
-- This migration adds the smallest independent mechanism: one new,
-- narrow, paginated read-only RPC. No existing table, column, enum,
-- index, RLS policy, or function is touched.
--
-- Visibility rule: matches get_shop_detail's own gate exactly (0036) --
-- not exists (a seller_suspended/account_suspended, not-yet-lifted
-- restriction on the shop's owner). shop_status_enum ('active'/'away')
-- is never gated, matching get_shop_detail -- an "away" shop is still a
-- real, currently public shop page there, and stays one here. There is
-- no requirement that the shop have any listing, hidden or not -- a shop
-- with zero listings is still a legitimate public shop page today (this
-- is the exact case get_shop_detail already serves and browse_listings
-- cannot substitute for).
--
-- Slug: returns shops.slug directly -- the CURRENT-slug cache column,
-- the same column every other public RPC (browse_listings,
-- get_listing_detail) already treats as a shop's real address. Never
-- shop_slugs history: a shop has exactly one current slug at a time, and
-- this function only ever needs to emit that one value per shop, so
-- get_shop_detail's separate historical-slug-resolution logic (needed
-- there because a caller might request an OLD slug) does not apply to an
-- enumeration that only ever walks shops.slug itself.
--
-- Cursor: keyset on (created_at, id) DESC -- the same pattern
-- browse_listings' own "newest" branch and get_my_favorites already use.
-- Deliberately NOT updated_at. created_at is immutable (no trigger ever
-- touches it; only updated_at has the moddatetime trigger from 0007), so
-- a shop's position in a paginated walk ordered by created_at can never
-- move out from under an in-progress enumeration even if that shop is
-- edited between two page fetches. updated_at is still returned as a
-- plain output column (a truthful lastmod, maintained by the existing
-- moddatetime trigger on every UPDATE) but is never part of the keyset,
-- so a concurrent edit's timestamp change can never cause a shop to be
-- skipped or repeated across pages. id (uuid) is the deterministic
-- tie-break for any two shops sharing the same created_at instant --
-- required in principle (two shops can be created in the same
-- microsecond), even though it cannot be produced from application code
-- today (shop creation is one-per-request, not batch-inserted).
--
-- Fields returned: shop_id, slug, created_at (needed by the caller to
-- build the next page's cursor -- not merely decorative), updated_at
-- (lastmod). No owner_id, name, description, logo_storage_path,
-- messenger_link, or status -- a sitemap needs only a URL and an
-- optional lastmod, and nothing else is exposed.
--
-- No auth check: matches browse_listings/get_shop_detail's own
-- convention exactly -- this is a public marketplace read RPC, not an
-- admin one (unlike 0106's admin_hide_listing/admin_unhide_listing,
-- which do require authentication and the admin role). Every column
-- reference is alias-qualified (s.id, s.slug, s.created_at, s.updated_at,
-- s.owner_id, ur.user_id, ur.lifted_at, ur.restriction_type), including
-- every one that collides with this function's own output-column names
-- (slug, created_at, updated_at), per the established 0021/0022
-- ambiguity-bug precedent.

-- ============================================================
-- list_public_shops
-- ============================================================
create or replace function public.list_public_shops(
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  shop_id uuid,
  slug text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ===================== limit validation =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  -- ===================== cursor validation =====================
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    select
      s.id as shop_id,
      s.slug,
      s.created_at,
      s.updated_at
    from public.shops s
    where
      not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      )
      and (
        p_before_created_at is null
        or (s.created_at, s.id) < (p_before_created_at, p_before_id)
      )
    order by s.created_at desc, s.id desc
    limit p_limit;
end;
$$;

-- Public marketplace read RPC -- anon and authenticated, matching
-- browse_listings/get_listing_detail/get_shop_detail's own grant
-- convention exactly. No service-role/private access of any kind.
revoke all on function public.list_public_shops(integer, timestamptz, uuid) from public;
grant execute on function public.list_public_shops(integer, timestamptz, uuid) to anon;
grant execute on function public.list_public_shops(integer, timestamptz, uuid) to authenticated;
