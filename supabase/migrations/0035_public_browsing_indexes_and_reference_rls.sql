-- Public marketplace browsing, part 1 of 2: indexes + reference-data public
-- read RLS only. No functions, no business-table policies, no schema changes.
-- Part 2 (0036) will add the SECURITY DEFINER browse/detail RPCs that serve
-- listings/shops publicly; those RPCs do not depend on any policy added here.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0034_reviews_security_and_rpcs; this is the next
-- migration, no drift. pg_trgm is installed (extversion 1.6). RLS is enabled
-- on categories, countries, provinces, cities_municipalities, barangays,
-- listings, listing_images, and shops (all relrowsecurity = true,
-- relforcerowsecurity = false). The five reference tables currently carry
-- zero policies. shops carries exactly one policy, shops_select_owner
-- (auth.uid() = owner_id), unchanged since 0031. listings and listing_images
-- carry zero policies. No function whose name matches '%listing%',
-- '%browse%', '%feed%', '%marketplace%', or '%search%' exists anywhere in
-- the public schema -- no public browsing RPC exists yet, confirming this
-- migration is additive groundwork only.
--
-- Existing listings/shops indexes re-confirmed live and unchanged:
-- listings_available_newest_idx, listings_available_category_newest_idx,
-- listings_available_province_newest_idx, listings_available_city_newest_idx,
-- listings_available_barangay_newest_idx (all partial, WHERE status =
-- 'available', already anticipating marketplace browsing from 0008_listings),
-- and listings_shop_newest_idx (shop_id, created_at desc, no status filter --
-- already shaped for shop-scoped browsing, which must include Reserved).
-- Confirmed live that no listings_available_price_idx,
-- listings_title_trgm_idx, or shops_name_trgm_idx (or any equivalent under a
-- different name -- no existing btree leads with price_cents for available
-- listings, no existing GIN/GiST trigram index on listings.title or
-- shops.name) exists anywhere in pg_indexes -- no duplication risk.
--
-- Table-level privilege audit (per explicit instruction not to silently
-- widen scope): information_schema.table_privileges confirms anon and
-- authenticated already hold the full standard set of table-level
-- privileges, including SELECT, on all five reference tables (categories,
-- countries, provinces, cities_municipalities, barangays) -- this is
-- Supabase's ordinary project-wide default grant behavior, identical to
-- every other table in this schema, and is not something this project's
-- migrations have ever needed to grant explicitly. RLS is what is currently
-- blocking all access (enabled with zero policies = deny-all for every
-- role). Therefore no GRANT statement of any kind is included in this
-- migration -- only the five SELECT policies below are needed to make these
-- tables publicly readable; nothing about the underlying grant model needed
-- to change, and nothing does.
--
-- Scope: exactly three indexes (public.listings x2, public.shops x1) and
-- exactly five SELECT-only RLS policies (one per reference table). No
-- tables, columns, enums, triggers, or functions are created or altered.
-- listings, listing_images, listing_fulfillment_methods, shops (beyond the
-- untouched pre-existing shops_select_owner), shop_slugs, profiles,
-- listing_metrics, and favorites receive no new policy of any kind here --
-- public business-object reads arrive in 0036 through SECURITY DEFINER RPCs
-- that bypass RLS entirely (the same pattern already established by
-- start_conversation/send_message and the review RPCs), never through a
-- broadened raw-table policy on any of those tables.

-- ============================================================
-- indexes
-- ============================================================
-- listings_available_price_idx: partial btree on (price_cents, id) scoped to
-- status = 'available' only (never reserved/sold/archived/paused/draft --
-- shop-scoped Reserved browsing relies on the existing, already-small
-- per-shop listings_shop_newest_idx instead, per the locked design). A
-- single ascending index serves both future sort directions: price_low scans
-- it forward (ORDER BY price_cents ASC, id ASC), price_high scans the same
-- btree backward (ORDER BY price_cents DESC, id DESC) -- Postgres supports
-- efficient bidirectional index scans, so no second descending index is
-- needed or created.
create index listings_available_price_idx
  on public.listings (price_cents, id)
  where status = 'available';

-- listings_title_trgm_idx: trigram GIN index supporting future case-insensitive
-- substring search (ILIKE '%literal%') on listing titles. No tsvector, no
-- generated search column, no full-text infrastructure -- matches the locked
-- "keep MVP search simple" decision. Deliberately no equivalent index on
-- description yet (unindexed ILIKE on description remains acceptable at MVP
-- scale, always narrowed by the status='available' predicate and other
-- filters first).
create index listings_title_trgm_idx
  on public.listings using gin (title gin_trgm_ops);

-- shops_name_trgm_idx: trigram GIN index supporting future case-insensitive
-- substring search on shop names, mirroring listings_title_trgm_idx. No other
-- shop browsing index is added -- there is no dedicated "browse all shops"
-- surface in canon; shop discovery happens through the listing feed and
-- direct shop-slug lookups only.
create index shops_name_trgm_idx
  on public.shops using gin (name gin_trgm_ops);

-- ============================================================
-- reference-data public read RLS
-- ============================================================
-- categories, countries, provinces, cities_municipalities, and barangays are
-- pure admin-managed reference/configuration data: no user-owned rows, no
-- private columns (categories exposes only id/name/slug/is_inquiry_only/
-- sort_order/created_at; the four location tables expose only
-- id/parent-id/name/created_at, plus countries' code/name). Public raw
-- SELECT is intentional here specifically to avoid a dedicated RPC just to
-- populate filter dropdowns, and is explicitly NOT extended to any
-- user-owned or business table (listings, listing_images,
-- listing_fulfillment_methods, shops, shop_slugs, profiles, favorites,
-- listing_metrics, orders, reviews all remain behind their existing
-- RLS/RPC boundaries, untouched by this migration). Each policy's USING
-- clause is the literal constant `true` -- no function call, no subquery, no
-- recursion risk of any kind. Explicitly scoped to anon and authenticated
-- (never PUBLIC, which would additionally include unrelated internal
-- Postgres roles such as the table owner's implicit grants).
create policy categories_select_public
  on public.categories
  for select
  to anon, authenticated
  using (true);

create policy countries_select_public
  on public.countries
  for select
  to anon, authenticated
  using (true);

create policy provinces_select_public
  on public.provinces
  for select
  to anon, authenticated
  using (true);

create policy cities_municipalities_select_public
  on public.cities_municipalities
  for select
  to anon, authenticated
  using (true);

create policy barangays_select_public
  on public.barangays
  for select
  to anon, authenticated
  using (true);
