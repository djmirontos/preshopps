-- Listing domain structural schema for the approved Preshopps design.
-- Creates ONLY listings, listing_fulfillment_methods,
-- listing_vehicle_details, listing_rental_details, their required
-- constraints/indexes, and updated_at triggers for the mutable tables.
--
-- Deliberately deferred to a later migration (the same "resolve the
-- circular FK by ALTER TABLE afterward" approach used throughout this
-- schema): listing_images does not exist yet, so listings.cover_image_id
-- is omitted here; shops.featured_listing_id is likewise omitted until
-- listings exists. No carts, orders, messaging, reviews, notifications,
-- moderation, disputes, support, storage buckets, business RPCs, or
-- application RLS policies are created here.

-- =============================================================================
-- listings
-- =============================================================================
--
-- Ownership/category: shop_id -> shops(id) and category_id ->
-- categories(id), both ON DELETE RESTRICT. Shops are not normally
-- hard-deleted (0007) and categories are static admin-managed reference
-- data (0005) — RESTRICT keeps either from being silently removable
-- while listings still reference them, consistent with every other
-- "must survive" FK already established in this schema.
--
-- Location: province_id/city_id NOT NULL, barangay_id nullable, using
-- the exact composite-FK hierarchy model approved in 0006 and already
-- applied to shops in 0007. Both mandatory columns being NOT NULL means
-- the composite FKs always fire — no additional "requires parent" CHECK
-- is needed (same reasoning as shops).
--
-- Inventory: stock_quantity is the seller's current total sellable
-- stock; reserved_quantity is units held by accepted-but-not-completed
-- orders; available_quantity is a native GENERATED column deriving the
-- two, so it can never itself drift out of sync. The two CHECKs below
-- (stock_quantity >= 1, reserved_quantity between 0 and stock_quantity)
-- are the structural backstop — the real atomicity guarantee (no
-- oversell under concurrent acceptance) is a future RPC's job, not
-- built here.
--
-- Status: defaults to 'draft'. No status-transition trigger and no
-- publish RPC exist yet — the future publish_listing RPC is the
-- intended trusted path into 'available' once image/publish
-- requirements are checked; this migration only stores the column.
--
-- Deliberately NOT included, per the approved MVP scope: cover_image_id
-- (deferred), video, SKU, variants, seller-defined category, country_code,
-- exact address/GPS, listing expiry, scheduled-publish fields.

create table listings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  category_id integer not null,
  title text not null,
  slug text not null,
  public_code text not null unique,
  listing_type listing_type_enum not null,
  condition listing_condition_enum not null,
  known_flaws text,
  description text not null,
  brand text,
  price_cents bigint not null,
  is_negotiable boolean not null default false,
  original_price_cents bigint,
  stock_quantity integer not null default 1,
  reserved_quantity integer not null default 0,
  available_quantity integer generated always as (stock_quantity - reserved_quantity) stored,
  province_id integer not null,
  city_id integer not null,
  barangay_id integer,
  meetup_note text,
  status listing_status_enum not null default 'draft',
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listings_shop_id_fkey
    foreign key (shop_id) references shops (id)
    on delete restrict,
  constraint listings_category_id_fkey
    foreign key (category_id) references categories (id)
    on delete restrict,
  constraint listings_province_id_fkey
    foreign key (province_id) references provinces (id)
    on delete restrict,
  constraint listings_city_province_fkey
    foreign key (city_id, province_id) references cities_municipalities (id, province_id)
    on delete restrict,
  constraint listings_barangay_city_fkey
    foreign key (barangay_id, city_id) references barangays (id, city_id)
    on delete restrict,
  constraint listings_type_condition_check
    check (
      (listing_type = 'brand_new' and condition = 'brand_new')
      or
      (listing_type = 'preloved' and condition <> 'brand_new')
    ),
  constraint listings_fair_requires_known_flaws_check
    check (
      condition <> 'fair'
      or (known_flaws is not null and btrim(known_flaws) <> '')
    ),
  constraint listings_title_not_blank_check
    check (length(btrim(title)) > 0),
  constraint listings_slug_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint listings_public_code_not_blank_check
    check (length(btrim(public_code)) > 0),
  constraint listings_description_not_blank_check
    check (length(btrim(description)) > 0),
  constraint listings_price_cents_check
    check (price_cents >= 0),
  constraint listings_original_price_check
    check (original_price_cents is null or original_price_cents >= price_cents),
  constraint listings_stock_quantity_check
    check (stock_quantity >= 1),
  constraint listings_reserved_quantity_check
    check (reserved_quantity >= 0 and reserved_quantity <= stock_quantity)
);

-- listings.slug is intentionally NOT unique. The public URL identity is
-- public_code (already UNIQUE via the column constraint above); slug is
-- a cosmetic, title-derived part of the URL only.

create trigger set_updated_at
before update on listings
for each row
execute function extensions.moddatetime(updated_at);

-- Indexes, each tied to a specific approved marketplace query pattern.
-- Foreign keys are not auto-indexed by Postgres, but shop_id and
-- category_id are already covered as leading columns by the indexes
-- below for the queries that actually matter (see each index's
-- comment). Coverage note: the five partial indexes below only include
-- status = 'available' rows, so they do not speed up the FK RESTRICT
-- check Postgres performs if someone ever tries to delete a shop or
-- category that still has only draft/paused/sold/archived listings —
-- that check would fall back to a sequential scan. This is accepted
-- deliberately, not overlooked: shops are not normally deleted at all,
-- and categories are 13 fixed admin rows essentially never deleted: a
-- slow scan on a rare, deliberate admin action is not worth a dedicated
-- always-on index, matching the same reasoning already applied to
-- location reference tables in 0006's design review. Do not add an
-- index solely for that hypothetical hard-delete path.
--
-- Category browsing and location browsing are independent marketplace
-- entry points (PRD: "All Philippines -> Province -> City -> Barangay"
-- works with no category chosen at all, and vice versa), so they get
-- separate indexes rather than one leading-column composite — a
-- category-led index cannot serve an independent province/city/barangay
-- filter efficiently, and a single (province_id, city_id, barangay_id,
-- created_at) index only gives true index-ordered created_at DESC
-- scanning for the single most-specific filter it was given (all three
-- location columns pinned) — a province-only or province+city query
-- against that index would still have to merge/sort across the varying
-- unpinned trailing column(s) before "newest first" is correct. Instead,
-- each location level gets its own narrow (column, created_at desc)
-- partial index. This is valid specifically because city_id/barangay_id
-- are globally unique surrogate keys (not scoped per-province/per-city),
-- and the FK chain already enforced in this migration guarantees a
-- given city_id always belongs to its true province and a given
-- barangay_id always belongs to its true city — so filtering on just
-- city_id (or just barangay_id) alone is already fully correct; any
-- province_id/city_id predicate alongside it is a redundant integrity
-- confirmation, not something the index needs to also encode. No
-- combined category+location index is created here: for MVP, Postgres
-- will pick whichever single index is most selective for a given query
-- and evaluate the rest as a residual filter (or combine two indexes
-- via a bitmap AND) — real EXPLAIN ANALYZE/query telemetry, not
-- speculation, should drive whether a dedicated compound index is ever
-- justified later.

-- All Philippines / newest: every available listing, no other filter.
create index listings_available_newest_idx
  on listings (created_at desc)
  where status = 'available';

-- Category browse (with or without a location filter applied
-- afterward as a non-indexed predicate): available listings in one
-- category, newest first.
create index listings_available_category_newest_idx
  on listings (category_id, created_at desc)
  where status = 'available';

-- Province browse, and the residual predicate for province+city and
-- province+city+barangay queries once the more specific index below
-- has already narrowed to the right rows.
create index listings_available_province_newest_idx
  on listings (province_id, created_at desc)
  where status = 'available';

-- City browse. Serves "province + city" directly: city_id alone is
-- sufficient to filter correctly (it is globally unique and the FK
-- chain guarantees it belongs to the right province), so the
-- accompanying province_id predicate is just an integrity check, not
-- something this index needs to carry.
create index listings_available_city_newest_idx
  on listings (city_id, created_at desc)
  where status = 'available';

-- Barangay browse. Serves "province + city + barangay" directly, for
-- the same reason as the city index above: barangay_id alone is
-- globally unique and already guaranteed by its FK to belong to the
-- right city (and transitively province). Barangay filtering is an
-- explicit MVP marketplace feature (PRD §14.5/§15.2) and is
-- deliberately included, not excluded.
create index listings_available_barangay_newest_idx
  on listings (barangay_id, created_at desc)
  where status = 'available';

-- Seller's own shop listing pages: every listing for a shop, newest
-- first, across every status (draft/paused/etc., not just available) —
-- shop_id equality pins the leading column, created_at DESC is
-- index-ordered directly within it, with no sort step, regardless of
-- whether status is also filtered. status is deliberately NOT part of
-- this index: when a query also filters by status, Postgres scans this
-- already-narrow shop_id-scoped range and applies status as a cheap
-- residual predicate over what is already a small row set — a second
-- shop_id+status index is not added speculatively; only real EXPLAIN
-- ANALYZE/query telemetry should justify one later. Not partial (no
-- WHERE status = ...), since a seller must see all their own listings
-- regardless of public visibility. This also fully covers shop_id for
-- FK-check purposes, unlike the partial indexes above.
create index listings_shop_newest_idx
  on listings (shop_id, created_at desc);

-- =============================================================================
-- listing_fulfillment_methods
-- =============================================================================
--
-- Pure normalized join table: which fulfillment methods a listing
-- supports. ON DELETE CASCADE for listing_id is deliberate: these rows
-- are dependent configuration with zero independent meaning outside
-- their parent listing, and listings are not normally hard-deleted
-- (archived instead) — so CASCADE here is ordinary cleanup semantics,
-- not a data-loss risk, unlike the RESTRICT used for genuine history
-- elsewhere in this schema.
--
-- No surrogate id column and no created_at: this is a minimal pure
-- join/reference table with no independent identity or audit need
-- beyond its own composite primary key.

create table listing_fulfillment_methods (
  listing_id uuid not null references listings (id) on delete cascade,
  method fulfillment_method_enum not null,
  primary key (listing_id, method)
);

-- No additional index: the composite primary key already leads with
-- listing_id, which is the only lookup this table needs ("which methods
-- does this listing support").

-- =============================================================================
-- listing_vehicle_details
-- =============================================================================
--
-- 1:1 optional extension for Cars/Motorcycles. Every field is optional
-- content, per PRD — the row's mere existence is not required to
-- publish (see the deferred-validation note at the end of this file).
-- No VIN, no plate number, per the approved design.
--
-- year uses a static lower bound only (>= 1900). No upper bound is
-- enforced here: a CHECK referencing the current date would make the
-- constraint's meaning drift over time and is exactly the kind of
-- time-dependent policy a stable structural CHECK should not embed. A
-- sensible upper bound (e.g. "not more than a year or two in the
-- future") belongs in application-layer validation (Zod), where "now"
-- is naturally available per request, not baked into the schema.
--
-- ON DELETE CASCADE for listing_id: this is optional detail data with
-- no independent meaning or history value once its parent listing is
-- gone — same reasoning as listing_fulfillment_methods.
--
-- updated_at trigger included: unlike the join table above, this row's
-- content fields are seller-editable after creation.

create table listing_vehicle_details (
  listing_id uuid primary key references listings (id) on delete cascade,
  brand text,
  model text,
  year smallint,
  mileage_km integer,
  transmission text,
  fuel_type text,
  registration_status vehicle_registration_status_enum,
  documents_available text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_vehicle_details_mileage_km_check
    check (mileage_km is null or mileage_km >= 0),
  constraint listing_vehicle_details_year_check
    check (year is null or year >= 1900)
);

create trigger set_updated_at
before update on listing_vehicle_details
for each row
execute function extensions.moddatetime(updated_at);

-- =============================================================================
-- listing_rental_details
-- =============================================================================
--
-- 1:1 optional extension for For Rent. Every field is optional content;
-- the row's existence is not required to publish a For Rent listing
-- (see the deferred-validation note below). ON DELETE CASCADE and the
-- updated_at trigger follow the same reasoning as listing_vehicle_details.

create table listing_rental_details (
  listing_id uuid primary key references listings (id) on delete cascade,
  rental_price_cents bigint,
  rental_period rental_period_enum,
  security_deposit_cents bigint,
  rental_terms text,
  minimum_rental_period text,
  capacity integer,
  whats_included text,
  rules_restrictions text,
  availability rental_availability_enum not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_rental_details_rental_price_check
    check (rental_price_cents is null or rental_price_cents >= 0),
  constraint listing_rental_details_security_deposit_check
    check (security_deposit_cents is null or security_deposit_cents >= 0),
  constraint listing_rental_details_capacity_check
    check (capacity is null or capacity > 0)
);

create trigger set_updated_at
before update on listing_rental_details
for each row
execute function extensions.moddatetime(updated_at);

-- =============================================================================
-- Deferred: category/detail-table validation
-- =============================================================================
--
-- No trigger has been created to prevent listing_vehicle_details rows on
-- a non-vehicle listing, or listing_rental_details rows on a non-rental
-- listing. That validation intentionally belongs to a later trusted
-- write path (the listing-creation/update RPC or equivalent
-- server-side logic), not to a migration-time trigger — and it must
-- not hardcode specific categories.id values as hidden business
-- constants; it should key off categories.is_inquiry_only / a
-- vehicle-vs-rental distinction resolved at that layer, not a literal
-- ID baked into this schema. Flagged here explicitly so it is not
-- mistaken for an oversight.
