-- Order workflow structural schema for the approved Preshopps design:
-- order_status_history and order_cancellation_requests only. No order
-- submission/acceptance/stock-reservation/cancellation-execution/state-
-- transition RPCs, no notifications, messaging, reviews, disputes,
-- moderation, support, storage, application RLS policies, cron/expiry
-- jobs, or triggers of any kind are created here. Both tables were
-- explicitly deferred from 0012 pending core orders/order_items existing
-- to reference — see 0012's header comment.

-- =============================================================================
-- order_status_history
-- =============================================================================
--
-- Canonical-doc findings: PRD 22/23, ARCHITECTURE.md 16, and
-- ARCHITECTURE_ESSENTIALS.md 15 all describe the order status flow and
-- state that "cancellation history is tracked internally" and may inform
-- risk/moderation — but none of them specify the history table's exact
-- shape. This table is the append-oriented structural record of order
-- status changes; the docs do not define a transition graph at the
-- database level, so none is built here (see below).
--
-- Purely append-oriented: no updated_at. A history row records a fact
-- that happened; it is never edited after the fact.
--
-- No row is required to exist for every order — there is no mandatory
-- "NULL -> pending" row inserted automatically here, and no trigger
-- creates one. This migration only defines where such rows would live if
-- and when a future trusted transition RPC decides to write one.
--
-- from_status is nullable: it must be able to represent the order's
-- initial creation event (NULL -> pending) once future trusted logic
-- chooses to record it, alongside every real transition thereafter
-- (pending -> accepted, accepted -> ready, etc.). to_status is always
-- NOT NULL: every history row records arriving at some real state.
--
-- order_id -> orders(id) ON DELETE RESTRICT: this table is
-- contractual/audit-oriented order history, not disposable metadata.
-- RESTRICT makes accidental hard-delete of an order even harder than the
-- protection order_items already provides (0012) — one more independent
-- safeguard over the same "orders are never hard-deleted in the normal
-- product flow" invariant.
--
-- changed_by -> profiles(id) ON DELETE SET NULL: no canonical doc names
-- this column (e.g. as "actor_id"), so the task's own recommended name is
-- kept. The actor who caused a transition (buyer, seller, admin, or a
-- system process) is useful context, but a history row is exactly the
-- kind of historical record the approved anonymization-first account
-- model (0004) must never destroy just because the actor's account is
-- later anonymized. NOT NULL + RESTRICT would be wrong here (it would
-- make an actor's account permanently undeletable/un-anonymizable simply
-- for having once changed an order's status, an unreasonably strong
-- bond); CASCADE would wrongly delete audit history along with the
-- account. Nullable + SET NULL preserves the history row and its
-- to_status/note/timestamp while only clearing the specific actor
-- reference once that profile is anonymized — the same pattern already
-- used for user_restrictions in spirit, adapted for this table.
--
-- note: nullable, CHECK non-blank when present — free-text context for a
-- transition (e.g. a decline/cancellation reason chosen elsewhere), not a
-- required field for every row.
--
-- No transition-graph CHECK: the brief is explicit that this table
-- records what happened, it does not enforce what is allowed to happen.
-- Encoding "pending -> accepted is valid but pending -> completed is not"
-- as a CHECK would hard-code business rules into the audit table itself,
-- duplicating logic that belongs in a future trusted transition RPC and
-- making that table brittle to change. The one constraint that IS
-- structural rather than business-logic is addressed next.
--
-- from_status <> to_status CHECK: a history entry should represent an
-- actual transition — from_status equal to to_status (e.g. accepted ->
-- accepted) would not be a transition at all, just a no-op entry, which
-- is never useful and always indicates a bug in whatever wrote the row.
-- No canonical doc describes a need for metadata-only "status re-affirmed"
-- events with no actual change, so this is safe to reject structurally.
-- The CHECK only compares when from_status is non-null (the initial
-- NULL -> to_status creation event is exempt by construction, since NULL
-- can never equal a non-null to_status anyway, but the explicit
-- `from_status IS NULL OR ...` form makes that intent unambiguous to a
-- future reader rather than relying on NULL comparison semantics).

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  from_status order_status_enum,
  to_status order_status_enum not null,
  changed_by uuid,
  note text,
  created_at timestamptz not null default now(),
  constraint order_status_history_order_id_fkey
    foreign key (order_id) references orders (id)
    on delete restrict,
  constraint order_status_history_changed_by_fkey
    foreign key (changed_by) references profiles (id)
    on delete set null,
  constraint order_status_history_note_not_blank_check
    check (note is null or length(btrim(note)) > 0),
  constraint order_status_history_from_status_ne_to_status_check
    check (from_status is null or from_status <> to_status)
);

-- The one real read pattern: load an order's timeline. Ascending
-- created_at is the natural order for a timeline (oldest event first);
-- callers wanting newest-first can reverse in the application layer or
-- add ORDER BY ... DESC against the same index, which Postgres can scan
-- backward efficiently. order_id leads so the index also serves as the
-- FK-check support index (not automatically created for the referencing
-- side of a plain FK, same reasoning as order_items_order_id_idx in
-- 0012).
create index order_status_history_order_created_idx
  on order_status_history (order_id, created_at);

-- =============================================================================
-- order_cancellation_requests
-- =============================================================================
--
-- Canonical-doc findings: PRD 23.1 — while Pending, buyer cancels
-- directly (no request record needed, orders.status simply becomes
-- cancelled by future trusted logic); after Accepted, buyer submits a
-- cancellation REQUEST that the seller must confirm. PRD 23.2 separately
-- describes seller-initiated cancellation of an accepted order with a
-- mandatory reason — this table's generic requested_by/status/reviewed_by
-- shape can represent either flow without hard-coding which party plays
-- which role (per instruction, no buyer-only/seller-only/admin-only
-- encoding here); which flow(s) actually populate this table is a future
-- trusted-workflow decision, not a structural one. PRD 23.3 / AGENTS.md
-- confirm "cancellation history is tracked internally" — supporting a
-- durable, non-deleted table rather than an ephemeral one.
--
-- Docs are SILENT on: whether multiple pending requests may coexist per
-- order, and on any fixed reason-code list (PRD 23.2's seller reasons —
-- Item unavailable / Buyer requested cancellation / Unable to fulfill /
-- Other — are UI-level suggested options for the seller-cancellation
-- flow, not a documented enum requirement for this table). Per
-- instruction, this is flagged rather than silently decided: see #11/#6
-- in the report for the resulting choices (one-pending-per-order
-- structurally enforced per the task's stated preference; reason stored
-- as free text, no enum invented).
--
-- status uses the existing cancellation_request_status_enum (pending,
-- confirmed, rejected) — no replacement enum created.
--
-- order_id -> orders(id) ON DELETE RESTRICT: same reasoning as
-- order_status_history above — this is workflow/audit history tied to a
-- specific order, not disposable data.
--
-- requested_by -> profiles(id): the actor who asked for cancellation.
-- NOT NULL + RESTRICT would be the strongest guarantee that a requester
-- is always known, but it would also make that profile permanently
-- un-anonymizable/undeletable purely for having once requested a
-- cancellation, exactly the kind of bond the anonymization-first account
-- model (0004) is designed to avoid. NOT NULL + SET NULL is impossible
-- (SET NULL requires the column to be nullable). So: requested_by is
-- NULLABLE with ON DELETE SET NULL. Application/RPC logic guarantees an
-- actor is present at request-creation time (a cancellation request
-- cannot meaningfully be created without a requester); the column only
-- ever becomes NULL later, if that profile is anonymized, while the
-- request record itself (reason, status, timestamps) survives. This
-- follows the task's preferred historical direction; no canonical doc
-- demands a stronger persistent-identity guarantee than this, so no
-- conflict to report here.
--
-- reviewed_by -> profiles(id) ON DELETE SET NULL: nullable (a request
-- starts unreviewed), same anonymization-safe reasoning as requested_by.
--
-- reason: NOT NULL, non-blank CHECK. PRD 23.2 confirms a reason is
-- expected for (at least seller-initiated) cancellation; storing it as
-- plain text rather than a fixed enum avoids inventing a closed set of
-- values the canonical docs do not formally define as a database-level
-- enum (they read as UI-suggested options, not an exhaustive controlled
-- vocabulary) — the same "do not invent enums beyond what is specified"
-- discipline already applied throughout this schema.
--
-- review_note: nullable, non-blank CHECK when present — optional context
-- from whoever resolves the request (e.g. why it was rejected).
--
-- requested_at: NOT NULL default now(). reviewed_at: nullable, no
-- default — set only once a resolution occurs. No updated_at: per
-- instruction, and consistent with order_items (0012) and shop_slugs
-- (0007) — these are workflow/history-shaped rows, not mutable
-- profile-like entities with a generic last-modified concept.
--
-- No status/timestamp consistency CHECK (e.g. "pending implies
-- reviewed_at IS NULL", "confirmed/rejected implies reviewed_at IS NOT
-- NULL"): no canonical doc requires this at the structural level, and
-- enforcing it now risks blocking a future admin repair/import/backfill
-- path before the real review workflow is designed. Left to a future
-- trusted review/cancellation RPC, per instruction.
--
-- No buyer/shop/listing/order-total snapshot columns: this table
-- references the contractual order record (order_id) rather than
-- duplicating any of its data.

create table order_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  requested_by uuid,
  status cancellation_request_status_enum not null default 'pending',
  reason text not null,
  reviewed_by uuid,
  review_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint order_cancellation_requests_order_id_fkey
    foreign key (order_id) references orders (id)
    on delete restrict,
  constraint order_cancellation_requests_requested_by_fkey
    foreign key (requested_by) references profiles (id)
    on delete set null,
  constraint order_cancellation_requests_reviewed_by_fkey
    foreign key (reviewed_by) references profiles (id)
    on delete set null,
  constraint order_cancellation_requests_reason_not_blank_check
    check (length(btrim(reason)) > 0),
  constraint order_cancellation_requests_review_note_not_blank_check
    check (review_note is null or length(btrim(review_note)) > 0)
);

-- One-pending-request-per-order: canonical docs are silent on whether
-- multiple simultaneous pending cancellation requests are allowed for one
-- order (unlike disputes, which this schema will separately constrain to
-- one unresolved dispute per order when that migration is built). Per the
-- task's stated MVP preference, and because it mirrors the same
-- "duplicate active workflow state is nonsensical" reasoning already
-- structurally enforced elsewhere (shop_slugs_one_current_per_shop in
-- 0007), a partial UNIQUE index enforces at most one PENDING request per
-- order while leaving historical confirmed/rejected requests fully
-- retained and unrestricted in number. This also directly serves the
-- "find the unresolved request for this order" read.
create unique index order_cancellation_requests_one_pending_per_order
  on order_cancellation_requests (order_id)
  where status = 'pending';

-- Resolved-history view: "all cancellation requests for this order,
-- newest first" (buyer/seller/admin inspecting an order's cancellation
-- history). order_id leads so this also covers the FK-check support role
-- (same reasoning as order_status_history_order_created_idx above).
create index order_cancellation_requests_order_requested_idx
  on order_cancellation_requests (order_id, requested_at desc);

-- No requested_by, reviewed_by, or status-wide indexes are added: no
-- canonical UI/query in this migration reads by actor alone or scans all
-- requests globally by status; the partial unique index above already
-- serves the one concrete "pending lookup by order" query. Adding more
-- now would be speculative index maintenance cost with no proven need,
-- matching the same restraint already applied to order_items/cart_items
-- (0011/0012).
