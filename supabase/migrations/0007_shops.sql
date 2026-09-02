-- Shop domain structural schema for the approved Preshopps design.
-- Creates ONLY shops and shop_slugs. Listings do not exist yet, so
-- shops.featured_listing_id is deliberately omitted here — it will be
-- added by a later ALTER TABLE once listings exist (the same deferred
-- circular-FK approach already used for listings.cover_image_id).
-- No carts, orders, messaging, reviews, notifications, moderation,
-- disputes, support, storage buckets, business RPCs, or application
-- RLS policies are created here.

-- =============================================================================
-- shops
-- =============================================================================
--
-- Ownership: owner_id -> profiles(id) ON DELETE RESTRICT.
--   UNIQUE(owner_id) enforces "one shop per account" at the database
--   level. RESTRICT (not CASCADE/SET NULL) is deliberate: a shop is
--   marketplace history in its own right the instant it exists, and
--   everything that will hang off it later (listings, orders, reviews)
--   is exactly the kind of data the approved anonymization-first
--   account model must never silently destroy. This RESTRICT extends
--   that model — a profile that owns a shop can never be hard-deleted,
--   only anonymized, matching every other "must survive" FK already
--   established (orders.buyer_id, reviews.reviewer_id, etc. in later
--   migrations). Admin suspension of a seller uses shops.status /
--   user_restrictions, never deletion.
--
-- Location: province_id/city_id NOT NULL, barangay_id nullable, using
-- the composite-FK hierarchy model approved and applied in 0006. Both
-- mandatory columns being NOT NULL means the composite FKs always fire
-- — unlike profiles, no additional "requires parent" CHECK is needed
-- here, since there is no scenario where city_id could be set while
-- province_id is absent (province_id is never absent).
--
-- Slug: shops.slug is a read-optimization CACHE of the shop's CURRENT
-- slug, not the authoritative historical namespace — that authority
-- lives in shop_slugs (below), whose primary key reserves every slug
-- ever assigned, current or historical, globally and permanently. The
-- CHECK below enforces the same lowercase/format rule as shop_slugs so
-- the cache can never itself hold an invalid value. During this
-- structural phase there is no rename RPC yet (see the note at the end
-- of this file) — once RLS policies and the rename RPC exist, they
-- must prevent any direct client UPDATE of shops.slug; only the RPC
-- may write it, in the same transaction it writes the matching
-- shop_slugs row.
--
-- Trusted Seller fields (is_trusted_seller, trusted_seller_calculated_at)
-- are materialized/system-computed only. No eligibility columns and no
-- recalculation RPC exist yet (deferred, as approved). Once RLS/write
-- paths exist, sellers must never be able to write these two columns
-- directly — only a future recalculation RPC may.
--
-- Deliberately NOT included, per the approved MVP scope: banner/cover
-- image, phone, email, social links beyond messenger_link,
-- verification/ID fields, response-time fields, last-seen fields,
-- contact hours.

create table shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references profiles (id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text,
  logo_storage_path text,
  province_id integer not null,
  city_id integer not null,
  barangay_id integer,
  messenger_link text,
  status shop_status_enum not null default 'active',
  is_trusted_seller boolean not null default false,
  trusted_seller_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shops_province_id_fkey
    foreign key (province_id) references provinces (id)
    on delete restrict,
  constraint shops_city_province_fkey
    foreign key (city_id, province_id) references cities_municipalities (id, province_id)
    on delete restrict,
  constraint shops_barangay_city_fkey
    foreign key (barangay_id, city_id) references barangays (id, city_id)
    on delete restrict,
  constraint shops_slug_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint shops_name_not_blank_check
    check (length(btrim(name)) > 0)
);

-- updated_at maintenance via the already-installed moddatetime extension,
-- same pattern as profiles in 0004.
create trigger set_updated_at
before update on shops
for each row
execute function extensions.moddatetime(updated_at);

-- No indexes added beyond what PK/UNIQUE already provide:
--   shops.id (PK), shops.owner_id (UNIQUE, "my shop" lookup),
--   shops.slug (UNIQUE, public shop-page lookup by current slug).
-- No location index on shops: no current MVP query filters shops
-- directly by their own province/city (marketplace search filters
-- listings' location, not a shop's); adding one now would be
-- speculative, matching the same reasoning already applied to
-- profiles' location columns in 0004/0006.

-- =============================================================================
-- shop_slugs
-- =============================================================================
--
-- The global slug registry: every slug any shop has ever held, current
-- or historical, is exactly one row here, and `slug` is the PRIMARY KEY
-- of the whole table — one shared namespace, not scoped per shop. That
-- single fact is what guarantees, structurally: current slugs are
-- globally unique, historical slugs are globally unique, a historical
-- slug can never become a different shop's current slug, and a current
-- slug can never collide with any shop's historical slug. Old URLs
-- always resolve to the correct shop via a single indexed lookup on
-- this primary key, regardless of is_current.
--
-- shop_id -> shops(id) ON DELETE RESTRICT: shops are not normally
-- hard-deleted (see the ownership note above — admin suspension uses
-- status, not deletion). RESTRICT means that if a shop row were ever
-- deleted anyway (an exceptional, deliberate admin action, not a normal
-- product flow), it would be blocked while historical slug rows still
-- reference it, forcing a human decision rather than silently discarding
-- slug/redirect history.

create table shop_slugs (
  slug text primary key,
  shop_id uuid not null references shops (id) on delete restrict,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  constraint shop_slugs_slug_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Exactly one current slug per shop.
create unique index shop_slugs_one_current_per_shop
  on shop_slugs (shop_id)
  where is_current;

-- No updated_at on shop_slugs: rows are effectively historical/append
-- style. The one field that ever changes post-insert (is_current, when
-- a shop is renamed) will be flipped transactionally by the future
-- rename RPC alongside inserting the new current-slug row — not
-- tracked with a generic last-modified timestamp.

-- =============================================================================
-- Structural-phase slug consistency note
-- =============================================================================
--
-- At real shop-creation time, shops.slug and the matching shop_slugs
-- current-slug row must be created atomically in one transaction — that
-- is the job of the future shop-creation/rename RPC, intentionally not
-- built in this migration (business RPCs are deferred, per the approved
-- migration strategy). No synchronization trigger has been added here
-- to bridge this gap: a trigger built solely to paper over the absence
-- of the real RPC would be exactly the kind of fragile, temporary
-- machinery the approved design avoids.
--
-- Until that RPC exists, application code must not be permitted to
-- create shops directly (a raw INSERT into shops with no matching
-- shop_slugs row would leave the slug registry out of sync with the
-- cache). This is acceptable for now because RLS is already enabled on
-- both tables with zero policies defined, so every client write is
-- already default-denied during this structural phase — no additional
-- guard is needed today, only before RLS policies are ever added that
-- would otherwise open direct client writes.
