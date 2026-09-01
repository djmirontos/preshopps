-- Location hierarchy integrity for the approved Preshopps schema design.
-- Closes a gap in 0003/0004: independent province_id/city_id/barangay_id
-- foreign keys each prove their own target exists, but prove nothing
-- about whether the three values actually form a real parent/child
-- chain (e.g. a city belonging to a different province than the one
-- stored alongside it). This migration replaces that with declarative
-- composite foreign keys, per the approved design review.
--
-- Scope: only the already-existing reference tables and profiles.
-- Shops/listings do not exist yet and will adopt this same composite-FK
-- pattern natively in their own migrations — no retrofit needed there.
-- No functions, triggers, RLS policies, or seed data are touched.
--
-- All four affected tables currently contain zero rows, so this
-- migration requires no data cleanup or backfill.

-- =============================================================================
-- 1. Strengthen reference tables
-- =============================================================================
--
-- These compound UNIQUE constraints are the required targets for the
-- composite foreign keys added below. Each is a "compound restatement"
-- of an already-unique primary key plus its parent column — it doesn't
-- weaken anything, it exists purely so a child table can pin both
-- values (id and parent) at once.

alter table cities_municipalities
  add constraint cities_municipalities_id_province_id_key unique (id, province_id);

alter table barangays
  add constraint barangays_id_city_id_key unique (id, city_id);

-- =============================================================================
-- 2. Reshape profiles location foreign keys
-- =============================================================================
--
-- Drop the three existing single-column location FKs. province_id's is
-- being replaced (SET NULL -> RESTRICT, same name, see below); city_id's
-- and barangay_id's become redundant once the composite FKs exist below
-- (a composite FK to (id, parent_id) already implies id exists) and are
-- replaced by differently-named composite constraints, not reinstated.

alter table profiles drop constraint profiles_province_id_fkey;
alter table profiles drop constraint profiles_city_id_fkey;
alter table profiles drop constraint profiles_barangay_id_fkey;

-- Province: unchanged shape, delete rule tightened from SET NULL to
-- RESTRICT. Location reference rows are effectively immutable; a
-- deliberate deletion should require a human to reassign affected
-- profiles rather than silently clearing the field.
alter table profiles
  add constraint profiles_province_id_fkey
    foreign key (province_id) references provinces (id)
    on delete restrict;

-- City, pinned to its stated province. ON DELETE RESTRICT here (rather
-- than SET NULL) is a deliberate choice: with a composite FK, SET NULL
-- would clear *both* city_id and province_id at once on a city
-- deletion, which is a more surprising/destructive side effect than the
-- original per-column SET NULL intent.
alter table profiles
  add constraint profiles_city_province_fkey
    foreign key (city_id, province_id)
    references cities_municipalities (id, province_id)
    on delete restrict;

-- Barangay, pinned to its stated city. Same ON DELETE RESTRICT
-- reasoning as the city/province constraint above.
alter table profiles
  add constraint profiles_barangay_city_fkey
    foreign key (barangay_id, city_id)
    references barangays (id, city_id)
    on delete restrict;

-- =============================================================================
-- 3. Profile hierarchy CHECK constraints
-- =============================================================================
--
-- Postgres foreign keys use MATCH SIMPLE by default: a multi-column FK
-- is not checked at all if any of its referencing columns is NULL. That
-- means the composite FKs above only actually validate consistency when
-- the shallower column is guaranteed present. These two CHECKs close
-- that gap: they force "set the shallower level before the deeper one,"
-- which guarantees province_id is always populated whenever city_id is
-- (so the city/province composite FK always fires), and city_id is
-- always populated whenever barangay_id is (so the barangay/city
-- composite FK always fires).

alter table profiles
  add constraint profiles_city_requires_province_check
    check (city_id is null or province_id is not null);

alter table profiles
  add constraint profiles_barangay_requires_city_check
    check (barangay_id is null or city_id is not null);
