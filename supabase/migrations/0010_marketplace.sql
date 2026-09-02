-- Marketplace convenience/derived data for the approved Preshopps schema
-- design: favorites, recently_viewed, listing_metrics. Structural only —
-- no counter-maintenance triggers, no listing insert trigger, no RPCs,
-- no application RLS policies, no carts/orders/messaging/reviews/etc.

-- =============================================================================
-- favorites
-- =============================================================================
--
-- Signed-in-only convenience data (guests never favorite anything, per
-- PRD). UNIQUE(user_id, listing_id) enforces "one favorite per
-- user/listing" directly.
--
-- Delete behavior: CASCADE on both FKs, deliberately different from the
-- RESTRICT used throughout the identity/shop/listing domain tables. A
-- favorite is not a historical or contractual record — it carries no
-- audit, moderation, or transactional meaning on its own, and losing it
-- when either side disappears is the correct, expected outcome, not a
-- data-loss concern. This is convenience data, not "must survive"
-- history like orders/reviews/messages.

create table favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  listing_id uuid not null,
  created_at timestamptz not null default now(),
  constraint favorites_user_id_fkey
    foreign key (user_id) references profiles (id)
    on delete cascade,
  constraint favorites_listing_id_fkey
    foreign key (listing_id) references listings (id)
    on delete cascade,
  constraint favorites_user_id_listing_id_key
    unique (user_id, listing_id)
);

-- UNIQUE(user_id, listing_id) already indexes "rows for this user" as a
-- leading prefix, but its second column is listing_id, not created_at —
-- rows are physically ordered by listing_id within a user, not by when
-- they were favorited. "My Favorites, newest first" would otherwise
-- require sorting every row for that user on each read. A dedicated
-- (user_id, created_at desc) index gives that ordering directly, the
-- same reasoning already applied to every "newest first" marketplace
-- index in 0008. No listing_id-only index is added: nothing in this
-- migration reads/deletes by listing_id alone (favorite_count
-- maintenance, when it exists, will be handled by trusted business
-- logic later, not a query pattern here yet).
create index favorites_user_created_idx
  on favorites (user_id, created_at desc);

-- =============================================================================
-- recently_viewed
-- =============================================================================
--
-- Signed-in recently-viewed history only. Guest recently-viewed stays
-- entirely client-local (browser storage) and must never appear here,
-- per PRD/architecture. UNIQUE(user_id, listing_id) is the UPSERT
-- identity: re-viewing a listing updates the existing row's viewed_at
-- rather than creating a duplicate row.
--
-- No created_at: viewed_at is the one meaningful timestamp (when this
-- user most recently viewed this listing) — a separate "first viewed"
-- timestamp isn't a requirement and would just be another column to
-- keep in sync with every UPSERT for no product benefit. No updated_at
-- either, per instruction.
--
-- Delete behavior: CASCADE on both FKs, same reasoning as favorites —
-- this is pure convenience/personalization data with no historical or
-- contractual value.

create table recently_viewed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  listing_id uuid not null,
  viewed_at timestamptz not null default now(),
  constraint recently_viewed_user_id_fkey
    foreign key (user_id) references profiles (id)
    on delete cascade,
  constraint recently_viewed_listing_id_fkey
    foreign key (listing_id) references listings (id)
    on delete cascade,
  constraint recently_viewed_user_id_listing_id_key
    unique (user_id, listing_id)
);

-- Same reasoning as favorites_user_created_idx: the UNIQUE constraint's
-- second column is listing_id, not viewed_at, so it cannot serve
-- "most recently viewed first" without an extra sort. This index makes
-- that ordering direct. No listing_id-only index added — no query in
-- this migration needs it, and adding one now would be speculative.
create index recently_viewed_user_viewed_idx
  on recently_viewed (user_id, viewed_at desc);

-- =============================================================================
-- listing_metrics
-- =============================================================================
--
-- Private, seller-facing counters (PRD 28.1: no public view counts).
-- listing_id is the primary key — a true 1:1 extension of listings, not
-- a separate surrogate-keyed table.
--
-- Row-creation strategy: rows are created LAZILY by trusted business
-- logic the first time a counter actually needs to be recorded, not
-- eagerly for every listing at creation time. No listing insert trigger
-- is added here. Reasoning:
--   - Nothing in the schema yet writes to this table at all (the
--     view/favorite/inquiry/order-request increment logic is explicitly
--     deferred, per instruction) — eagerly creating rows now would be
--     speculative infrastructure with zero current consumer.
--   - Mandatory 1:1 creation would require either a listing insert
--     trigger (extra always-on machinery for a table nothing touches
--     yet) or coupling every future listing-creation code path to also
--     insert a metrics row by hand (fragile, easy to drift out of sync
--     across call sites).
--   - Absence of a row is a perfectly safe, unambiguous signal: it
--     means every counter is effectively zero. Reads join against this
--     table with COALESCE/LEFT JOIN defaults; the future write path
--     UPSERTs a row on first increment. This avoids a class of bugs
--     entirely (a row existing with stale/inconsistent values) rather
--     than needing to prevent it.
-- If a concrete future need for guaranteed 1:1 rows emerges (e.g. an
-- aggregate query that must not special-case a missing row), that is a
-- decision for the trusted RPC layer to make deliberately, not a
-- migration-time trigger added speculatively now.

create table listing_metrics (
  listing_id uuid primary key,
  view_count bigint not null default 0,
  favorite_count bigint not null default 0,
  inquiry_count bigint not null default 0,
  order_request_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint listing_metrics_listing_id_fkey
    foreign key (listing_id) references listings (id)
    on delete cascade,
  constraint listing_metrics_view_count_check
    check (view_count >= 0),
  constraint listing_metrics_favorite_count_check
    check (favorite_count >= 0),
  constraint listing_metrics_inquiry_count_check
    check (inquiry_count >= 0),
  constraint listing_metrics_order_request_count_check
    check (order_request_count >= 0)
);

-- updated_at maintenance via the already-installed moddatetime
-- extension, same pattern as every other mutable table in this schema.
create trigger set_updated_at
before update on listing_metrics
for each row
execute function extensions.moddatetime(updated_at);

-- No index beyond the primary key: listing_id is already the PK, and
-- seller statistics are reached through a specific listing_id after the
-- seller's own listings are loaded (via listings' existing indexes) —
-- no public ranking/trending system depends on these counters yet, so
-- no additional index is justified.
--
-- Security note (not implemented here): once RLS policies exist, they
-- must prevent any client from directly writing view_count,
-- favorite_count, inquiry_count, or order_request_count — only a future
-- trusted RPC may. RLS default-deny during this structural phase (no
-- policies exist yet) is sufficient for now.
