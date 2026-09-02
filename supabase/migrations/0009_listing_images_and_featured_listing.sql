-- Listing images and the two deferred circular references (listings ->
-- cover image, shops -> featured listing) for the approved Preshopps
-- schema design. Structural metadata only: no storage buckets, no
-- storage/object policies, no upload RPCs, no publish_listing RPC, and
-- no application RLS policies are created here.

-- =============================================================================
-- listing_images
-- =============================================================================
--
-- Pure metadata for images already resized/uploaded elsewhere (storage
-- bucket work is a later task). ON DELETE CASCADE for listing_id is
-- deliberate: image metadata is fully dependent on its listing and has
-- no independent historical value if a listing is ever truly
-- hard-deleted (listings are normally archived, not deleted, per 0008).
--
-- Deliberately NOT enforced here (per instruction, these are cross-row
-- aggregate/business rules that belong to the future trusted
-- publish/image-management path, not a plain CHECK):
--   - maximum 8 images per listing
--   - "at least one actual-item (non-reference) image" requirement
-- Also deliberately omitted: width/height/filesize/mime metadata (not
-- required by canonical docs), and updated_at (image rows are
-- effectively immutable except for ordering/classification, which will
-- be controlled writes through trusted logic later, not a general
-- last-modified timestamp).

create table listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  storage_path text not null,
  position smallint not null,
  is_reference_image boolean not null default false,
  created_at timestamptz not null default now(),
  constraint listing_images_listing_id_fkey
    foreign key (listing_id) references listings (id)
    on delete cascade,
  constraint listing_images_storage_path_not_blank_check
    check (length(btrim(storage_path)) > 0),
  constraint listing_images_position_check
    check (position >= 0),
  constraint listing_images_listing_id_position_key
    unique (listing_id, position),
  constraint listing_images_id_listing_id_key
    unique (id, listing_id)
);

-- listing_images_listing_id_position_key already indexes "load all
-- images for a listing ordered by position" (listing_id leads).
-- listing_images_id_listing_id_key exists purely to be the required
-- composite-FK target for listings.cover_image_id below (see that
-- section) and incidentally also indexes listing ownership lookups by
-- image id. No further index is added — both real query patterns are
-- already covered, and a third index here would be redundant.

-- =============================================================================
-- listings.cover_image_id — same-listing integrity design
-- =============================================================================
--
-- A plain `cover_image_id uuid references listing_images(id)` would
-- only prove the image exists somewhere — not that it belongs to THIS
-- listing. That gap is unacceptable (an image from a different listing
-- could be set as another listing's cover). The fix is the same
-- declarative composite-FK pattern already used throughout this schema
-- for parent/child integrity (0006, 0007, 0008):
--
--   FOREIGN KEY (cover_image_id, id) REFERENCES listing_images (id, listing_id)
--
-- listing_images_id_listing_id_key (added above) is what makes this
-- target valid. A match can only exist when the referenced image's own
-- listing_id equals this listing's own id — same-listing membership is
-- structurally guaranteed, not merely assumed.
--
-- Nullability under MATCH SIMPLE (Postgres default): a multi-column FK
-- is skipped entirely if any referencing column is NULL. Here the
-- second column of the pair is `id` — this table's own primary key,
-- which can never be NULL. So the constraint's enforcement is governed
-- purely by cover_image_id: NULL means "no cover selected yet" (always
-- valid, FK skipped); non-NULL means both columns are non-null, so the
-- FK fires and fully validates same-listing membership. No extra CHECK
-- is needed to force this (unlike profiles' three-independently-
-- nullable-column case in 0006 — here only one column of the pair is
-- truly independent).
--
-- Delete behavior — the genuinely tricky part: a composite FK's plain
-- ON DELETE SET NULL nulls EVERY column in the referencing tuple. Doing
-- that naively here would try to null listings.id itself — a NOT NULL
-- primary key — which is not just wrong but would fail outright. The
-- safe, still fully declarative answer is PostgreSQL 15+'s per-column
-- referential action syntax (confirmed available: this project runs
-- PostgreSQL 17.6): `ON DELETE SET NULL (cover_image_id)` restricts the
-- SET NULL action to only that one column, leaving `id` completely
-- untouched. This gives same-listing integrity AND automatic clearing
-- when the cover image is deleted, without a trigger and without
-- falling back to RESTRICT — a listing survives losing its cover image
-- and simply has no cover until another is chosen.

alter table listings
  add column cover_image_id uuid,
  add constraint listings_cover_image_id_fkey
    foreign key (cover_image_id, id)
    references listing_images (id, listing_id)
    on delete set null (cover_image_id);

-- =============================================================================
-- shops.featured_listing_id — same-shop integrity design
-- =============================================================================
--
-- Identical reasoning and pattern as cover_image_id above, one level up
-- the ownership chain: a plain FK would only prove the listing exists,
-- not that it belongs to THIS shop. listings_id_shop_id_key (added
-- below) is the compound-restatement UNIQUE target that makes the
-- composite FK possible; listings.id is already globally unique via its
-- own primary key, so pairing it with shop_id costs nothing extra
-- beyond the one small index this UNIQUE constraint creates.
--
--   FOREIGN KEY (featured_listing_id, id) REFERENCES listings (id, shop_id)
--
-- Same MATCH SIMPLE nullability analysis as above applies: the second
-- column (shops' own id, its PK) can never be NULL, so enforcement is
-- governed purely by featured_listing_id — NULL is always valid (no
-- featured listing chosen), non-NULL always fully validates same-shop
-- membership.
--
-- Same delete-behavior reasoning applies too: `ON DELETE SET NULL
-- (featured_listing_id)` (PostgreSQL 15+ per-column syntax, available
-- on this project's PostgreSQL 17.6) clears only featured_listing_id
-- when the referenced listing is deleted, never touching shops.id. A
-- shop survives its featured listing being removed and simply has no
-- featured listing selected until the seller picks another — no
-- trigger needed, no RESTRICT fallback needed; the declarative
-- per-column action gives both required guarantees (same-shop
-- integrity and automatic clearing on delete) cleanly.

alter table listings
  add constraint listings_id_shop_id_key
    unique (id, shop_id);

alter table shops
  add column featured_listing_id uuid,
  add constraint shops_featured_listing_id_fkey
    foreign key (featured_listing_id, id)
    references listings (id, shop_id)
    on delete set null (featured_listing_id);
