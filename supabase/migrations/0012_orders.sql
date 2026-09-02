-- Order domain structural schema for the approved Preshopps design: orders
-- and order_items only. This establishes the immutable order-record
-- foundation. No stock reservation RPCs, order submission RPCs,
-- acceptance/decline/cancellation RPCs, state-transition logic,
-- order_status_history, order_cancellation_requests, messaging, reviews,
-- notifications, disputes, moderation, support, storage, or application
-- RLS policies are created here.
--
-- order_status_history and order_cancellation_requests are both listed as
-- part of the "Orders" domain in ARCHITECTURE.md/ARCHITECTURE_ESSENTIALS.md,
-- but that is a domain-grouping list for planning, not an instruction to
-- create every domain table in one migration — every prior domain in this
-- schema was built incrementally (e.g. shops in 0007 before
-- featured_listing_id existed, listings in 0008 before listing_images in
-- 0009). Both are explicitly deferred to a later migration once core
-- orders/order_items exist to reference.

-- =============================================================================
-- orders
-- =============================================================================
--
-- One order per seller/shop per cart submission (a multi-seller cart is
-- split into one order per shop by future trusted submission logic — not
-- enforced here, this table just holds the resulting rows).
--
-- public_code: a user-facing identifier distinct from the UUID primary
-- key, mirroring the exact pattern already established for
-- listings.public_code (0008): UNIQUE + non-blank CHECK, no format/
-- generation logic specified here. A future trusted order-submission path
-- generates the value; no default/RPC is added in this structural
-- migration.
--
-- buyer_id -> profiles(id) ON DELETE RESTRICT: an order is historical
-- contractual data the instant it exists. The approved anonymization-first
-- account model (established since 0004) means a profile that has ever
-- placed an order can never be hard-deleted, only anonymized — matching
-- every other "must survive" FK in this schema (shops.owner_id, etc.).
-- CASCADE would silently destroy transaction history; that is unacceptable
-- for orders specifically.
--
-- shop_id -> shops(id) ON DELETE RESTRICT: same reasoning — orders must
-- survive shop deactivation/suspension (which uses shops.status, never
-- deletion) and must remain in seller-side history permanently. No
-- separate seller_id column: seller identity is always derivable through
-- shop_id -> shops.owner_id, so storing it again here would be pure
-- redundant duplication with no integrity/query benefit.
--
-- requested_at vs created_at: the task brief asked whether these are
-- redundant. In this MVP, an orders row is created by exactly one code
-- path — cart submission — and nothing today creates a "draft" order
-- earlier than that moment. requested_at and created_at would therefore
-- always hold an identical value with zero current distinguishing
-- meaning: a guaranteed duplicate column, not two independent facts.
-- DECISION: requested_at is omitted. created_at alone serves as both the
-- technical row-creation time and the business "order was requested at"
-- moment. If a future draft-order concept is introduced, requested_at can
-- be added then with genuine independent meaning — it is not being
-- foreclosed, just not speculatively created now.
--
-- Per-state timestamp columns (accepted_at, ready_at, ...): deliberately
-- plain nullable columns with NO default, NO auto-population trigger, and
-- NO CHECK tying them to `status`. Populating them and enforcing
-- status/timestamp consistency is trusted state-transition business logic
-- that does not exist yet (explicitly deferred, per instruction) — a
-- migration-time CHECK spanning ten nullable columns and one enum would be
-- exactly the kind of premature transition-invariant logic the brief says
-- not to build here.
--
-- Order total: NOT stored. order_items carries immutable quantity +
-- price_cents_snapshot per line; the order total is always derivable as
-- SUM(quantity * price_cents_snapshot) grouped by order_id. No canonical
-- doc (PRD/ARCHITECTURE/ARCHITECTURE_ESSENTIALS/AGENTS/CLAUDE.md) calls for
-- a stored total snapshot — ARCHITECTURE.md 39 explicitly defers all
-- payment-adjacent state to future dedicated tables (payments,
-- payment_attempts, payouts) rather than embedding it in orders now. Per
-- instruction, do not add total_cents speculatively; a future trusted
-- order-submission design can add it deliberately if a concrete need
-- (e.g. an immutable payment-reference total) emerges.
--
-- Shipping/delivery fee: NOT stored. PRD 24 / ARCHITECTURE_ESSENTIALS 15
-- are explicit that Preshopps does not calculate or process shipping/
-- delivery fees in MVP — buyer and seller agree on any such fee
-- themselves, outside the platform, via messaging. There is no approved
-- fixed amount captured at submission to justify a column.

create table orders (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  buyer_id uuid not null,
  shop_id uuid not null,
  status order_status_enum not null default 'pending',
  fulfillment_method fulfillment_method_enum not null,
  buyer_note text,
  seller_note text,
  accepted_at timestamptz,
  ready_at timestamptz,
  handed_over_or_shipped_at timestamptz,
  received_confirmed_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  disputed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_buyer_id_fkey
    foreign key (buyer_id) references profiles (id)
    on delete restrict,
  constraint orders_shop_id_fkey
    foreign key (shop_id) references shops (id)
    on delete restrict,
  constraint orders_public_code_not_blank_check
    check (length(btrim(public_code)) > 0)
);

-- Compound restatement of the primary key alongside shop_id, the same
-- pattern already used for listings_id_shop_id_key (0009). This is what
-- makes order_items' same-shop composite FK possible below — it costs one
-- small index and no redundant data on this table (shop_id already exists
-- here as a real column, this just also exposes it as a composite unique
-- target).
alter table orders
  add constraint orders_id_shop_id_key
    unique (id, shop_id);

-- updated_at maintenance via the already-installed moddatetime extension,
-- same pattern as every other mutable table in this schema.
create trigger set_updated_at
before update on orders
for each row
execute function extensions.moddatetime(updated_at);

-- Likely queries: "my orders, newest first" (buyer account) and "orders
-- for my shop, newest first" (seller dashboard) — both the exact same
-- shape as favorites_user_created_idx (0010) and listings_shop_newest_idx
-- (0008). A status filter can run as a residual filter over either index
-- to start; per-status composite indexes are not added speculatively.
create index orders_buyer_created_idx
  on orders (buyer_id, created_at desc);

create index orders_shop_created_idx
  on orders (shop_id, created_at desc);

-- =============================================================================
-- order_items
-- =============================================================================
--
-- Same-shop integrity — the critical requirement analyzed below
-- -----------------------------------------------------------------------
-- An order belongs to exactly one shop. Every non-null order_items.
-- listing_id must reference a listing belonging to that SAME shop. A plain
-- `listing_id references listings(id)` FK cannot express this: order_items
-- knows order_id and listing_id, but comparing listings.shop_id against
-- orders.shop_id across two independent foreign keys is not something a
-- plain FK can do — that would require either a trigger, redundant
-- storage, or trusting the insertion path alone.
--
-- Trigger was rejected: this schema has consistently preferred declarative
-- constraints over triggers for structural integrity wherever a clean
-- composite-FK design exists (0006 location hierarchy, 0009 cover_image_id
-- and featured_listing_id) — a trigger duplicates that same intent in
-- procedural code that is easier to accidentally bypass or drift from.
--
-- Trusted-insertion-path-only was also considered (the option this brief's
-- "preferred MVP direction" leans toward): let a future trusted
-- order-creation RPC be the sole path that ever inserts order_items, and
-- trust it to only ever insert same-shop rows. This is not unreasonable —
-- it is exactly how listing_images' "at least one actual photo" rule is
-- deferred to trusted logic. But same-shop membership is different in
-- kind: it is not a soft business rule, it is the structural definition of
-- what an order *is* (one order == one shop's items). This schema has
-- already paid the equivalent cost twice before (0009) for integrity of
-- exactly this shape, so the same declarative approach is applied here for
-- consistency and because the marginal cost is small and known.
--
-- DECISION: add order_items.shop_id (redundant relative to listing_id ->
-- listings.shop_id, but not redundant relative to what a plain listing_id
-- FK alone could prove). This is the exact same compound-restatement
-- pattern already used throughout this schema:
--   1. orders_id_shop_id_key (added above): UNIQUE(id, shop_id) on orders.
--   2. order_items_order_id_shop_id_fkey:
--      FOREIGN KEY (order_id, shop_id) REFERENCES orders (id, shop_id)
--      Both columns are NOT NULL, so this constraint always fires: it
--      structurally forces order_items.shop_id to equal its own order's
--      shop_id. This constraint alone already implies "order_id is valid"
--      — no separate plain order_id FK is added on top of it, that would
--      just be a redundant weaker constraint.
--   3. order_items_listing_id_shop_id_fkey:
--      FOREIGN KEY (listing_id, shop_id) REFERENCES listings (id, shop_id)
--      listings_id_shop_id_key already exists from 0009. Combined with
--      constraint 2 above, this transitively guarantees
--      listings.shop_id = orders.shop_id for every order_item with a
--      non-null listing_id — same-shop membership is structurally
--      impossible to violate, with no trigger.
--
-- Nullability under MATCH SIMPLE (Postgres default): constraint 2's
-- columns (order_id, shop_id) are both NOT NULL, so it is always enforced.
-- Constraint 3 has one nullable column (listing_id, see below); when NULL
-- the constraint is skipped entirely (same reasoning as 0009's
-- cover_image_id/featured_listing_id), and shop_id remains whatever was
-- correctly validated at insert time — it is not reset, since it is this
-- row's own historical fact ("this line item belonged to this shop"), not
-- a value that depends on the listing continuing to exist.
--
-- listing_id nullability and delete behavior
-- -----------------------------------------------------------------------
-- listing_id is nullable. Order history must survive even in the rare
-- case a listing is genuinely hard-deleted (listings are normally
-- archived, never hard-deleted, in the normal product flow — see 0008/
-- 0009) by administrative action. A strict RESTRICT would make that rare
-- admin cleanup permanently impossible once any order ever referenced the
-- listing. The immutable snapshot columns below (title, public code,
-- price, shop name, cover image reference) are sufficient on their own to
-- render historical order details — the live listing row is not required.
-- So: `ON DELETE SET NULL (listing_id)` (PostgreSQL 15+ column-scoped
-- syntax, the same mechanism used in 0009), clearing only listing_id and
-- leaving shop_id and every snapshot column untouched. Not CASCADE:
-- deleting the source listing must never delete order history.
--
-- order_id delete behavior
-- -----------------------------------------------------------------------
-- order_items are contractual child records of an order, analogous to how
-- listing_images are dependent child records of a listing — but unlike
-- listing_images, order_items are irreplaceable historical/contractual
-- data, not disposable media metadata. Normal application code never hard-
-- deletes an order (there is no product flow that does so — cancellation/
-- decline/expiry are all status changes, never row deletion). Given that,
-- RESTRICT (via constraint 2 above) is chosen over CASCADE: it provides a
-- real safety net against ever silently losing order_items to an
-- accidental or unreviewed order deletion, at zero practical cost, since
-- orders are never deleted by any approved normal path anyway. This
-- matches the same "rare action, protect the historical data" reasoning
-- already used for buyer_id/shop_id on orders itself.
--
-- Snapshot fields and historical rationale
-- -----------------------------------------------------------------------
-- listing_title_snapshot, listing_public_code_snapshot,
-- price_cents_snapshot, shop_name_snapshot: immutable facts captured at
-- order submission time, per PRD 21.3 and ARCHITECTURE.md/
-- ARCHITECTURE_ESSENTIALS.md's explicit "Order snapshots" requirements.
-- Order history must never depend on the live listing/shop row, which may
-- later be edited, archived, or (rarely) hard-deleted.
--
-- listing_cover_image_snapshot_path: ARCHITECTURE.md section 16 and
-- CLAUDE.md's Order Rules both explicitly list "cover image reference" as
-- a required snapshot field alongside title/price/quantity/shop context —
-- this is an explicit canonical-doc requirement, not a speculative
-- addition, so it is included despite a plain image snapshot otherwise
-- being avoidable. It stores a reference (the storage path, matching
-- listing_images.storage_path's own type/shape) rather than image bytes —
-- consistent with how listing_images itself stores references only.
-- Nullable: a listing may have no cover_image_id set at order time
-- (cover_image_id on listings is itself nullable, per 0009), so the
-- snapshot must be able to reflect "no cover image existed" rather than
-- being forced to fabricate one.
--
-- No title/shop/price *columns* are duplicated beyond what is listed
-- above, and no currency column is added (MVP is PHP only, per approved
-- scope, matching the same decision already made for cart_items in 0011).
--
-- Quantity / stock semantics
-- -----------------------------------------------------------------------
-- quantity is the requested quantity, CHECK >= 1. Not validated against
-- live stock here — stock is dynamic; future order-submission logic
-- validates initial availability, and future seller-acceptance logic
-- atomically reserves stock. No accepted_quantity or reserved_quantity
-- column is added: PRD 21.4/21.5 describe partial acceptance strictly as
-- "some order_items accepted, others declined" (a per-line-item
-- accept/decline decision), never as accepting part of the quantity
-- within a single line item. Inventing accepted_quantity would be adding
-- a capability the canonical docs do not describe.
--
-- Partial acceptance
-- -----------------------------------------------------------------------
-- order.status describes the overall order; order_items.status
-- (pending/accepted/declined) tracks each line item individually — this
-- is exactly what makes partial acceptance representable. No aggregate
-- trigger/logic is added to derive the parent order's overall status from
-- its items' statuses; a future trusted acceptance RPC owns that decision
-- atomically alongside stock reservation.
--
-- updated_at: deliberately NOT added. order_items.status will change
-- during seller acceptance/decline, but per instruction this is not
-- tracked with a generic last-modified timestamp unless canonical docs
-- require item-level audit timing — they do not. A future acceptance
-- event can be inferred from the parent order's own timestamps, or from a
-- dedicated event/audit table if that need becomes concrete later. No
-- trigger is created on this table.
--
-- Historical immutability (not enforced here)
-- -----------------------------------------------------------------------
-- The snapshot columns (title, public code, price, shop name, cover image
-- reference) and quantity are historical facts fixed at order creation.
-- Future trusted logic must prevent any client from modifying them after
-- insert — RLS/RPC enforcement is explicitly out of scope for this
-- structural migration. RLS default-deny (zero policies exist on this
-- table, same as every table so far) is sufficient protection during this
-- structural phase.

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  shop_id uuid not null,
  listing_id uuid,
  status order_item_status_enum not null default 'pending',
  quantity integer not null,
  listing_title_snapshot text not null,
  listing_public_code_snapshot text not null,
  price_cents_snapshot bigint not null,
  shop_name_snapshot text not null,
  listing_cover_image_snapshot_path text,
  created_at timestamptz not null default now(),
  constraint order_items_order_id_shop_id_fkey
    foreign key (order_id, shop_id) references orders (id, shop_id)
    on delete restrict,
  constraint order_items_listing_id_shop_id_fkey
    foreign key (listing_id, shop_id) references listings (id, shop_id)
    on delete set null (listing_id),
  constraint order_items_quantity_check
    check (quantity >= 1),
  constraint order_items_price_cents_snapshot_check
    check (price_cents_snapshot >= 0),
  constraint order_items_listing_title_snapshot_not_blank_check
    check (length(btrim(listing_title_snapshot)) > 0),
  constraint order_items_listing_public_code_snapshot_not_blank_check
    check (length(btrim(listing_public_code_snapshot)) > 0),
  constraint order_items_shop_name_snapshot_not_blank_check
    check (length(btrim(shop_name_snapshot)) > 0),
  constraint order_items_cover_image_snapshot_path_not_blank_check
    check (
      listing_cover_image_snapshot_path is null
      or length(btrim(listing_cover_image_snapshot_path)) > 0
    )
);

-- "All items in this order" is the primary read pattern (order detail
-- page, acceptance flow) and is also what the order_id/shop_id FK checks
-- above rely on. Neither FK's referencing side is automatically indexed
-- by Postgres (only the referenced/unique side is), so this index is
-- required, not optional. No listing_id index is added: nothing in this
-- migration reads/deletes by listing_id alone, matching the same
-- "no speculative index" reasoning already applied to cart_items (0011)
-- and shop/category FK coverage (0008).
create index order_items_order_id_idx
  on order_items (order_id);
