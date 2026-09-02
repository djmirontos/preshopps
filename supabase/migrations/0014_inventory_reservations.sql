-- Inventory reservation ledger for the approved Preshopps design:
-- inventory_reservation_status_enum and inventory_reservations only,
-- plus the one helper composite UNIQUE constraint on order_items that
-- the ledger's ownership-integrity FK requires. No acceptance/
-- cancellation/completion RPCs, no stock/order/order_item mutation, no
-- triggers, no RLS policies, no cron, no storage are created here. This
-- is the structural foundation the future trusted acceptance/
-- cancellation/completion RPCs will write to atomically alongside
-- listings.reserved_quantity/stock_quantity and orders/order_items
-- status changes.
--
-- Canonical-doc findings: no canonical doc (PRD/ARCHITECTURE/
-- ARCHITECTURE_ESSENTIALS/AGENTS/CLAUDE.md) names a reservation ledger
-- table explicitly — PRD 21.6/29.2 and AGENTS.md's Stock/Reservation
-- Rules describe the required BEHAVIOR (reserve at acceptance, never
-- oversell, transaction-safe, release on cancellation, convert to a
-- stock decrement at completion) without prescribing a specific table
-- shape. This table is the approved engineering design that satisfies
-- that behavior with a real audit trail, per the prior design-analysis
-- task's recommendation and your explicit approval.

-- =============================================================================
-- inventory_reservation_status_enum
-- =============================================================================
--
-- active: this reservation's quantity is currently included in the
-- owning listing's reserved_quantity.
-- released: the reservation ended without consuming inventory (normally
-- an accepted order being cancelled) — reserved_quantity was decremented,
-- stock_quantity was not touched.
-- consumed: the reservation ended via order completion — both
-- reserved_quantity and stock_quantity were decremented by the same
-- quantity in the same transaction.
--
-- No `expired` value: PRD 21.7 is explicit that accepted orders do not
-- auto-expire, so a reservation (which only ever exists once an item is
-- accepted) can never reach an expiry outcome.
-- No `cancelled` value: cancellation is an order-lifecycle concept
-- already fully represented by orders.status/order_cancellation_requests
-- (0013); the reservation's own outcome when that happens is `released`,
-- not a duplicate "cancelled" label for the same event.

create type inventory_reservation_status_enum as enum (
  'active',
  'released',
  'consumed'
);

-- =============================================================================
-- order_items helper UNIQUE — required for the ledger's ownership FK
-- =============================================================================
--
-- Same compound-restatement pattern already used throughout this schema
-- (listings_id_shop_id_key in 0009, orders_id_shop_id_key in 0012): a
-- UNIQUE target that lets a child table's composite FK prove an exact
-- multi-column match against order_items, rather than trusting the
-- insertion path alone. order_items.id is already globally unique via
-- its own primary key, so this costs one small index and no redundant
-- data — it just also exposes the (id, order_id, shop_id, listing_id)
-- tuple as a composite UNIQUE target for inventory_reservations below.

alter table order_items
  add constraint order_items_id_order_id_shop_id_listing_id_key
    unique (id, order_id, shop_id, listing_id);

-- =============================================================================
-- inventory_reservations
-- =============================================================================
--
-- Reservation ownership integrity — the critical requirement
-- -----------------------------------------------------------------------
-- A reservation must structurally prove it belongs to the exact
-- order_item it was created for: same order, same shop, same listing.
-- The minimal declarative chain, using the composite FK pattern already
-- proven throughout this schema (0006, 0009, 0012):
--
--   FOREIGN KEY (order_item_id, order_id, shop_id, listing_id)
--   REFERENCES order_items (id, order_id, shop_id, listing_id)
--
-- order_items already transitively proves "listing belongs to shop" via
-- its own order_items_listing_id_shop_id_fkey (0012), which itself
-- targets listings_id_shop_id_key (0009). So this single composite FK,
-- by requiring an exact tuple match against an existing order_items row,
-- transitively guarantees all of: reservation.order_id = order_item's
-- order_id, reservation.shop_id = order_item's shop_id, reservation.
-- listing_id = order_item's listing_id, AND that listing belongs to that
-- shop — without repeating any of those individual facts as separate
-- constraints. All four referencing columns (order_item_id, order_id,
-- shop_id, listing_id) are NOT NULL on this table, so under MATCH SIMPLE
-- this FK is never skipped — every reservation row is always fully
-- validated.
--
-- No separate plain order_id -> orders(id) or shop_id -> shops(id) FKs
-- are added: both are already transitively guaranteed valid (order_id
-- via order_items' own FK to orders, shop_id via listings' own FK to
-- shops), so a direct FK here would only restate a fact already
-- structurally proven, not add a new guarantee — avoided per instruction
-- not to duplicate FKs purely for aesthetics.
--
-- listing_id is NOT NULL on this table (unlike order_items.listing_id,
-- which is nullable to survive a hard-deleted source listing). An active
-- reservation must never lose track of which listing it holds stock
-- against, and — per the decision below — released/consumed rows keep
-- that reference too, permanently.
--
-- Listing hard-delete decision: RESTRICT forever
-- -----------------------------------------------------------------------
-- A second, DIRECT composite FK gives the obvious, explicit protection
-- this ledger exists for:
--
--   FOREIGN KEY (listing_id, shop_id) REFERENCES listings (id, shop_id)
--   ON DELETE RESTRICT
--
-- Two options were weighed (per the prior design-analysis task): (A)
-- RESTRICT forever — once a listing has ever had a reservation, its row
-- can never be hard-deleted, matching this schema's existing archive-
-- not-delete philosophy (listings are normally archived/sold, never hard
-- -deleted, in the normal product flow — see 0008/0009); (B) allow
-- source-listing deletion and let inventory_reservations.listing_id go
-- to NULL like order_items.listing_id does. Option B was rejected: it
-- would remove the one piece of information (which listing this
-- reservation was against) that makes a RELEASED or CONSUMED row
-- meaningful history, and — more importantly — a nullable listing_id
-- cannot be used to structurally guarantee "an ACTIVE reservation always
-- has a real listing," which is exactly the invariant this table exists
-- to make impossible to violate. RESTRICT forever was your explicit
-- approved direction; this is intentionally a STRONGER protection than
-- order_items.listing_id's own SET NULL (0012) for listings that have
-- reached the reservation stage — order_items alone (no reservation
-- ever created, e.g. a declined item) can still have its listing hard-
-- deleted normally, but once any reservation row exists (active,
-- released, or consumed) the listing becomes permanent.
--
-- Note on interaction with order_items' SET NULL FK: attempting to
-- hard-delete a listing that still has a reservation would first be
-- blocked directly by this FK. As a secondary, incidental effect, even
-- without this direct FK, the earlier composite ownership FK above would
-- also block it once order_items.listing_id is SET NULL by the listings-
-- delete cascade (that UPDATE would no longer match this table's
-- existing NOT NULL listing_id, and the default ON UPDATE NO ACTION
-- rejects it) — but this migration does not rely on that indirect
-- mechanism; the direct FK above is the intended, legible protection.
--
-- order_id / order_item_id delete behavior: RESTRICT
-- -----------------------------------------------------------------------
-- The ownership FK above uses ON DELETE RESTRICT. Reservations are
-- contractual inventory history, not disposable metadata — this adds an
-- explicit guard against ever hard-deleting an order_item row while a
-- reservation (of any status) still references it. In practice orders
-- are already fully protected from hard deletion by order_items' own
-- RESTRICT FK to orders (0012) and by order_status_history/
-- order_cancellation_requests' own RESTRICT FKs (0013); this adds one
-- more independent layer at the order_item level specifically, matching
-- the same "several independent safeguards over the same invariant"
-- reasoning already used for orders in 0013.
--
-- shop_id delete behavior: enforced transitively, no direct FK
-- -----------------------------------------------------------------------
-- shop_id's validity (does this shop exist) is already transitively
-- guaranteed by the listing_id/shop_id FK to listings above (listings.
-- shop_id itself has its own RESTRICT FK to shops, from 0008), and shops
-- are additionally already protected from hard deletion by shops.owner_id
-- and orders.shop_id RESTRICT chains. A third direct shop_id -> shops(id)
-- FK here would not add any new guarantee, so it is not added, per
-- instruction not to duplicate FKs purely for aesthetics.
--
-- Quantity
-- -----------------------------------------------------------------------
-- quantity is CHECK >= 1 and represents the FULL accepted order_item.
-- quantity — a future acceptance RPC must copy it directly from
-- order_items.quantity, never a partial amount. There is no partial-
-- quantity reservation within one order_item, per the approved product
-- decision; this migration does not (and structurally cannot) enforce
-- that the value actually equals order_items.quantity, since a CHECK
-- cannot reference another table — that equality is the future trusted
-- acceptance RPC's responsibility, exactly as order_items' own snapshot
-- accuracy already relies on trusted logic rather than a CHECK.
--
-- One reservation per order_item, forever
-- -----------------------------------------------------------------------
-- UNIQUE(order_item_id) — a seller decision can reserve a given
-- order_item at most once, period. This remains correct even after the
-- reservation is released or consumed: the same order_item must never be
-- accepted/reserved a second time (per the approved product model,
-- accepted order_items never revert to pending), so there is no future
-- valid scenario where a second reservation row for the same order_item
-- should ever be created. This is also the structural backstop against
-- an RPC idempotency bug ever double-reserving stock for the same item,
-- regardless of how many times an acceptance call is retried.
--
-- Status / resolved_at consistency
-- -----------------------------------------------------------------------
-- CHECK ((status = 'active' AND resolved_at IS NULL) OR (status IN
-- ('released','consumed') AND resolved_at IS NOT NULL)): a purely local,
-- single-row structural invariant (no cross-table reference needed,
-- unlike the order_item-status relationship deliberately left
-- unenforced below) — an active reservation with a resolved timestamp,
-- or a resolved reservation with no timestamp, is never sensible
-- regardless of what future business logic does. This does not interfere
-- with a future atomic RPC: the RPC simply sets both `status` and
-- `resolved_at` together in the same UPDATE when releasing or consuming
-- a reservation, which this CHECK already requires it to do correctly.
-- No trigger auto-populates resolved_at — the future RPC sets it
-- explicitly as part of its atomic transaction.
--
-- No CHECK/FK against order_items.status = 'accepted'
-- -----------------------------------------------------------------------
-- A CHECK cannot reference another table, and a trigger enforcing this
-- is deliberately out of scope for this structural migration (per
-- instruction and consistent with this schema's established preference
-- for declarative constraints over triggers wherever a clean one isn't
-- available). The future trusted acceptance RPC is responsible for
-- atomically: setting order_items.status = 'accepted', creating this
-- reservation row, and incrementing listings.reserved_quantity, all in
-- one transaction. The ledger's own ownership-integrity FK (above) is
-- sufficient structural protection for this migration's scope; the
-- accepted-status relationship is a business-logic invariant the RPC
-- must uphold, not a database-level one.
--
-- No updated_at: this is a lifecycle/audit record, not a mutable
-- general-purpose entity — its only post-insert change is the one-time
-- active -> released|consumed transition, already covered by `status`
-- and `resolved_at` together.
--
-- No actor fields: order_status_history and order_cancellation_requests
-- (0013) already provide workflow actor context for the surrounding
-- order-level events; duplicating an actor column here would be
-- redundant per instruction.
--
-- Aggregate reconciliation (not built here): listings.reserved_quantity
-- remains the fast cached aggregate every marketplace read already
-- depends on (0008's available_quantity generated column). This ledger
-- is the authoritative source of TRUTH for reservation ownership; the
-- diagnostic invariant listings.reserved_quantity = SUM(quantity) WHERE
-- status = 'active' GROUP BY listing_id is intentionally not enforced by
-- a trigger, generated column, or materialized view in this migration —
-- future trusted RPCs must keep both in sync within the same
-- transaction, and a future admin/reconciliation tool may compare them.

create table inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null,
  shop_id uuid not null,
  quantity integer not null,
  status inventory_reservation_status_enum not null default 'active',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint inventory_reservations_order_item_id_key
    unique (order_item_id),
  constraint inventory_reservations_order_item_ownership_fkey
    foreign key (order_item_id, order_id, shop_id, listing_id)
    references order_items (id, order_id, shop_id, listing_id)
    on delete restrict,
  constraint inventory_reservations_listing_shop_fkey
    foreign key (listing_id, shop_id) references listings (id, shop_id)
    on delete restrict,
  constraint inventory_reservations_quantity_check
    check (quantity >= 1),
  constraint inventory_reservations_status_resolved_at_check
    check (
      (status = 'active' and resolved_at is null)
      or (status in ('released', 'consumed') and resolved_at is not null)
    )
);

-- Future reconciliation/cancellation/completion queries: "active
-- reservations for this order" (cancellation release) and "active
-- reservations for this listing" (reconciliation against listings.
-- reserved_quantity). Both are partial indexes scoped to status='active'
-- since that is the only state these specific lookups care about;
-- historical released/consumed rows are reached via order_item_id
-- (already covered by the UNIQUE constraint's index) or by order_id/
-- listing_id full scans only in rare admin/audit contexts, which do not
-- justify a dedicated broad index. No status-wide index is added.
create index inventory_reservations_order_active_idx
  on inventory_reservations (order_id)
  where status = 'active';

create index inventory_reservations_listing_active_idx
  on inventory_reservations (listing_id)
  where status = 'active';
