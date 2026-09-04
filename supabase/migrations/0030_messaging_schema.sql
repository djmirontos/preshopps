-- Messaging module, schema only. Creates ONLY:
--   public.user_blocks
--   public.conversations
--   public.messages
--   public.conversation_user_states
-- plus their constraints/indexes, and exactly one trigger (justified below,
-- against explicit expectation, by a live project convention discovered
-- during pre-inspection). No RPCs, no RLS policies, no enum changes, no
-- conversation_participants table, no notification/moderation/search
-- infrastructure. RLS and the trusted RPCs (start_conversation,
-- send_message) are a separate future migration
-- (0031_messaging_rls_and_rpcs.sql), not created here.
--
-- Canonical recheck before writing
-- -----------------------------------------------------------------------
-- PRD 4.1/25/30 + ARCHITECTURE 17 (already read in full this session, and
-- re-derived in the prior design-only report): registered users only;
-- two conversation types (listing inquiry, general shop inquiry); one
-- logical thread per initiator+listing and per initiator+shop (repeated
-- "Message Seller" must reuse the same thread); text-only, immutable
-- messages (no edit/delete/unsend); plain-text URLs permitted with no DB-
-- side stripping/validation; unread/archive/mute/mark-unread as per-user
-- UI state, not per-message status; peer-to-peer blocking (PRD 30) is a
-- marketplace-wide rule distinct from admin-issued moderation
-- (user_restrictions) and has no existing schema support -- this
-- migration adds it now, as explicitly locked for this task, via a
-- reusable public.user_blocks table rather than a messaging-only side
-- table, since PRD 30 blocking also touches order requests and reviews.
--
-- Pre-inspection findings (read-only, immediately before writing this
-- file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0029_complete_order; this is the next
-- migration. None of the four target tables exist. conversation_type_enum
-- (from 0002) is exactly {listing_inquiry, general_shop} -- reused as-is,
-- no enum change. profiles.id is uuid, not null, no default (populated by
-- the handle_new_user trigger on auth.users insert); profiles.deleted_at
-- exists (nullable timestamptz) -- the existing anonymization marker this
-- module's FKs are designed to respect (see "Anonymization" below).
-- shops.id/owner_id and listings.id/shop_id are uuid; shop_status_enum is
-- exactly {active, away}; listing_status_enum is exactly {draft,
-- available, reserved, paused, sold, archived} -- both confirmed
-- unchanged from the design-analysis pass. shops.owner_id already carries
-- a live UNIQUE index (shops_owner_id_key), confirming this schema's
-- existing "one shop per account" invariant at the DB level -- unrelated
-- to this migration but confirms shop-owner identity is a stable,
-- singular fact per account. No table matching user_blocks, conversations,
-- messages, or conversation_user_states exists under any name.
--
-- Trigger deviation, discovered and justified during pre-inspection: the
-- task brief's "strong expectation: none" for triggers does not survive
-- contact with the live schema. Every existing table in this project that
-- has an `updated_at timestamptz not null default now()` column already
-- carries a `set_updated_at` trigger calling the `moddatetime` extension
-- function (confirmed live on profiles, shops, listings,
-- listing_vehicle_details, listing_rental_details, listing_metrics,
-- carts, and orders -- 8 tables, zero exceptions). conversation_user_states
-- has exactly that column shape. Omitting the trigger would leave
-- updated_at frozen at INSERT time forever, silently breaking the
-- column's only purpose (tracking the most recent read/archive/mute/
-- mark-unread change) and diverging from an unbroken, schema-wide
-- convention -- AGENTS.md's "reuse existing abstractions before creating
-- new ones" directly favors applying the existing convention over
-- inventing a deliberately inconsistent exception. This is therefore the
-- one case where "an existing project convention makes one absolutely
-- necessary," per the task's own stated exception clause. No other new
-- table in this migration has an updated_at column, so no other trigger
-- is added. This finding is reported explicitly rather than silently
-- deviating from the brief's stated expectation.
--
-- user_blocks
-- -----------------------------------------------------------------------
-- Reusable, marketplace-wide peer blocking -- distinct from
-- public.user_restrictions (admin/moderation suspension; unrelated table,
-- untouched). A row means blocker_id has blocked blocked_id; storage is
-- directional (one row per blocking action), never auto-duplicated in the
-- reverse direction. Future interaction enforcement (in the 0031 RPCs)
-- must check both directions explicitly: an interaction between A and B
-- is blocked if EITHER (blocker=A, blocked=B) OR (blocker=B, blocked=A)
-- exists -- that OR-of-two-lookups logic belongs in the RPC layer, not in
-- this table's shape. No reason/expires_at/status/updated_at/moderation
-- columns -- this is deliberately the smallest possible user-controlled
-- relationship, not a moderation record. FKs to profiles(id) ON DELETE
-- RESTRICT (never CASCADE) so a block relationship can never silently
-- vanish out from under a hard profile delete -- consistent with every
-- other historically-significant FK in this schema. The self-block CHECK
-- (blocker_id <> blocked_id) prevents a structurally meaningless row.
-- Primary key (blocker_id, blocked_id) already serves any
-- blocker_id-leading lookup ("who has A blocked") for free; the separate
-- index on blocked_id serves the other direction ("who has blocked A"),
-- required by the future OR-of-two-lookups enforcement above.
--
-- conversations
-- -----------------------------------------------------------------------
-- Strictly two-party: initiator_id (the user who started the thread) and
-- an implied seller, deliberately NOT stored as a separate column and
-- NOT modeled via a conversation_participants join table -- the seller is
-- derived at read time from shops.owner_id. No ownership-transfer system
-- exists anywhere in this schema today (no function among the 14 live
-- functions ever mutates shops.owner_id, and shops.owner_id already
-- carries its own UNIQUE constraint reinforcing one-owner-at-a-time); if
-- shop-ownership transfer is ever introduced, that future feature must
-- explicitly decide how to preserve historical conversations' seller
-- identity (e.g. a snapshot column added by its own migration) -- adding
-- such a snapshot now, with no transfer feature to protect against yet,
-- would be exactly the speculative complexity AGENTS.md warns against.
-- initiator_id/shop_id/listing_id all reference their respective tables
-- ON DELETE RESTRICT, matching this schema's unbroken convention for any
-- FK pointing at a historically-significant row (identical in shape to
-- orders.buyer_id/orders.shop_id). listing_id is nullable specifically
-- because general_shop conversations have no listing.
--
-- Type/listing invariant: conversations_type_listing_check structurally
-- forbids a listing_inquiry row without a listing_id and a general_shop
-- row with one -- closing off a malformed-row class at the constraint
-- level rather than trusting the future RPC alone, matching this schema's
-- consistent preference (e.g. listings_type_condition_check,
-- inventory_reservations_status_resolved_at_check).
--
-- Uniqueness: two partial unique indexes prevent duplicate threads from
-- repeated "Message Seller" clicks. conversations_initiator_listing_key
-- covers (initiator_id, listing_id) WHERE listing_id IS NOT NULL --
-- deliberately excluding shop_id from the tuple, since a listing belongs
-- to exactly one shop already (listings.shop_id not null) and the future
-- RPC layer is responsible for validating that a supplied listing
-- actually belongs to the supplied shop, not this index.
-- conversations_initiator_shop_general_key covers (initiator_id, shop_id)
-- WHERE listing_id IS NULL, scoped by the partial predicate specifically
-- so it never collides with listing-inquiry rows for the same shop.
--
-- Inbox indexes: (initiator_id, last_message_at desc, id) and
-- (shop_id, last_message_at desc, id) support the two inbox
-- directions (mine-as-initiator, mine-as-seller) with the id tie-breaker
-- required for stable cursor pagination on (last_message_at, id) -- no
-- OFFSET pagination anywhere, matching this project's marketplace-wide
-- cursor-pagination convention (PRD 15.5 / ARCHITECTURE 13).
--
-- Explicitly NOT added, per locked decisions: seller_id/buyer_id columns,
-- a conversation_participants table, subject, a resolved/status column
-- (PRD 25.7: "No separate Resolved conversation state"),
-- last_message_preview, last_sender_id, last_message_id, updated_at,
-- deleted_at. last_message_at alone is the only denormalization: it is
-- the inbox sort/unread key, and unlike a preview or sender id it cannot
-- drift out of sync with the true latest message in any way that matters
-- (the future send_message RPC is its sole writer, in the same
-- transaction as the message insert it reflects). last_message_at is
-- NOT NULL with no default (unlike created_at) -- a conversation is
-- always created together with its first message by the future
-- start_conversation RPC (see "Retry/non-idempotency" below), so the RPC
-- always supplies a concrete first-message timestamp; there is no valid
-- conversation state with zero messages, so no default is appropriate.
--
-- messages
-- -----------------------------------------------------------------------
-- Immutable marketplace evidence (PRD 25.4: "No editing... No deletion...
-- No unsend"). No edited_at, no deleted_at, no delivery/sent/read status
-- columns (PRD 25.3 explicitly excludes read receipts; a committed row IS
-- "sent" -- there is no intermediate state in this architecture), no
-- attachment/image/voice/reaction/link-preview columns -- all explicitly
-- out of MVP scope per canon. conversation_id/sender_id both ON DELETE
-- RESTRICT, same historically-significant-FK convention as above --
-- sender_id pointing at profiles(id) rather than auth.users(id) directly
-- matches every other user-authored row in this schema (order_status_history
-- .changed_by, orders.buyer_id) and composes correctly with
-- profiles.deleted_at as the anonymization marker (see "Anonymization").
--
-- Body constraints: messages_body_not_blank_check
-- (length(btrim(body)) > 0) matches the exact shape already used for
-- listings.description (listings_description_not_blank_check) and other
-- not-blank text columns throughout this schema.
-- messages_body_max_length_check (char_length(body) <= 4000) bounds
-- worst-case row size and, combined with future application-level rate
-- limiting (deliberately not built here), worst-case spam volume, while
-- remaining generous enough for realistic marketplace coordination text
-- (PRD 21.1 routes payment/meetup/shipping arrangements entirely through
-- messaging). The future send_message RPC will also trim the body before
-- insert (so stored text is never whitespace-padded), matching this
-- schema's established RPC-normalizes-input convention
-- (cancel_accepted_order's v_reason := btrim(p_reason), etc.) -- that
-- trim happens in the RPC, not here, since this migration creates no
-- functions. URLs are never stripped or validated at any layer, per PRD
-- 25.5 -- plain-text external links are explicitly permitted.
--
-- Pagination index: (conversation_id, created_at, id) supports cursor
-- pagination on (created_at, id) within one conversation, with the id
-- tie-breaker for stability when two messages share a created_at. No
-- full-text/GIN index on body -- PRD 25.7's inbox search is explicitly
-- metadata-only (display name, shop name, listing title), never
-- message-body search, so no such index is needed by this module at all.
--
-- conversation_user_states
-- -----------------------------------------------------------------------
-- Per-user UI/read state only -- this table does NOT define conversation
-- membership (membership is fully expressed by conversations.initiator_id
-- plus the derived shops.owner_id) and is deliberately not a
-- conversation_participants table under a different name. Primary key
-- (conversation_id, user_id) is both the natural identity and the
-- membership-adjacent lookup; the separate index on user_id supports "all
-- of my conversation states" scans that the PK's
-- (conversation_id, user_id) column order would not serve efficiently.
--
-- State-row existence (locked, not implemented here): lazy per-first-touch
-- row creation was considered and rejected in the design pass. The future
-- start_conversation RPC must instead create exactly two state rows
-- atomically whenever a NEW conversation is created -- one for
-- initiator_id, one for the shop owner at that moment -- so every
-- conversation deterministically has exactly two viewer-state rows for
-- its entire lifetime, and no read/archive/mute/mark-unread update ever
-- needs to reason about a possibly-missing row. No trigger performs this
-- insert -- it is the future RPC's responsibility, done atomically
-- alongside conversation creation, exactly as documented in the
-- referenced design report.
--
-- Read/unread semantics (documented for the future RPC layer; no
-- behavior implemented by this schema-only migration): a conversation is
-- unread for a user if marked_unread_at IS NOT NULL, OR last_read_at IS
-- NULL, OR conversations.last_message_at > last_read_at. Opening/marking
-- read advances last_read_at to now() and clears marked_unread_at to
-- NULL. Marking unread sets marked_unread_at to now() and must NEVER
-- rewind last_read_at -- last_read_at remains a simple, monotonic
-- high-water mark; marked_unread_at is the independent override signal.
--
-- Archive semantics (documented, not implemented here): archived_at is
-- per-user and never deletes anything or affects the other participant's
-- row. A new message from the OTHER participant must later auto-clear
-- the recipient's archived_at back to NULL (in the future send_message
-- RPC) -- an archived thread that just received new information should
-- not stay silently hidden from the main inbox.
--
-- Mute semantics (documented, not implemented here): muted suppresses
-- ordinary messaging notification delivery only. It does NOT suppress
-- unread accrual, does NOT block messages, does NOT archive, and does
-- NOT affect future critical order/dispute notifications -- mirroring
-- PRD 25.9's existing parallel rule ("Mute suppresses ordinary chat
-- notifications, but critical order/dispute notifications still
-- appear"). No notification infrastructure exists or is created here.
--
-- Blocking enforcement (documented, not implemented here): the future
-- start_conversation and send_message RPCs must reject the action if
-- EITHER (blocker=A, blocked=B) OR (blocker=B, blocked=A) exists in
-- public.user_blocks for the two parties involved. Existing conversation
-- and message history must remain readable regardless of a later block --
-- blocking prevents only new conversations and new messages, per PRD 30.
-- Future order-request and review modules may reuse this same
-- public.user_blocks table rather than inventing their own.
--
-- Listing/shop eligibility (documented, not implemented here -- cross-
-- table business logic belongs in the future RPC, not a table CHECK):
-- new listing-inquiry conversations should be allowed only for listings
-- currently `available` or `reserved`; NOT for `draft`, `paused`, `sold`,
-- or `archived` (matching the design report's PRD-10.3-derived
-- reasoning: paused/draft are non-public entirely, sold/archived keep
-- their direct URL alive as historical/unavailable pages, not as new-
-- inquiry targets). An EXISTING conversation must remain fully usable
-- regardless of the listing's later status changes -- this rule applies
-- only at conversation-creation time. General shop inquiries are allowed
-- for shops in either `active` or `away` status; both are messageable
-- unless blocking (public.user_blocks) or admin restriction
-- (public.user_restrictions, untouched by this migration) prevents the
-- interaction.
--
-- Retry/non-idempotency (locked, documented for the future RPC): if the
-- logical conversation (per the uniqueness indexes above) does not yet
-- exist, start_conversation creates the conversation row, creates both
-- state rows, and sends the supplied first message. If it already
-- exists, start_conversation reuses it and the supplied p_body is
-- inserted as a NEW message in that existing thread -- this is
-- deliberately NOT idempotent with respect to message creation: a
-- repeated RPC submission with the same body can and will create another
-- message. No client-message-id/idempotency-key column is added by this
-- migration or planned for MVP -- double-submit prevention is a frontend
-- concern (disable-while-pending), not a schema concern.
--
-- Anonymization: every FK in this migration pointing at profiles(id) uses
-- ON DELETE RESTRICT, never CASCADE, so messaging history can never be
-- silently destroyed by a hard profile delete. Account deletion remains
-- anonymization-first through the existing profiles.deleted_at marker
-- (confirmed live, unchanged) -- a deleted account's profile row persists
-- (anonymized display_name/avatar), and every message/conversation/block
-- row simply continues pointing at that now-anonymized profile. No new
-- anonymization column is needed anywhere in this migration.
--
-- Realtime/search/notifications: no special infrastructure is created
-- here. Future Realtime subscriptions (messages INSERT, conversations
-- UPDATE) will work against these tables' ordinary row changes with zero
-- additional schema. Future inbox search remains metadata-only (display
-- name, shop name, listing title -- all columns on tables this module
-- only reads, never owns) -- no full-text index is created for message
-- bodies. Future notification dispatch reacts to a fresh send_message
-- commit from outside the DB transaction -- no notifications table exists
-- or is created here.
--
-- RLS forward note: RLS is expected to auto-enable on these four new
-- tables via this project's existing rls_auto_enable event trigger (which
-- fires on every CREATE TABLE in the public schema and already governs
-- every other table in this project) -- this migration does not add any
-- policy DDL of its own, and with RLS enabled but zero policies defined,
-- these tables will default-deny all direct access until
-- 0031_messaging_rls_and_rpcs.sql adds the actual policies. This state
-- will be confirmed, not assumed, when 0030 is applied and verified.

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete restrict,
  blocked_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint user_blocks_pkey primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self_check check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_id_idx
  on public.user_blocks (blocked_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type public.conversation_type_enum not null,
  initiator_id uuid not null references public.profiles(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  listing_id uuid references public.listings(id) on delete restrict,
  last_message_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint conversations_type_listing_check check (
    (conversation_type = 'listing_inquiry' and listing_id is not null)
    or (conversation_type = 'general_shop' and listing_id is null)
  )
);

create unique index conversations_initiator_listing_key
  on public.conversations (initiator_id, listing_id)
  where listing_id is not null;

create unique index conversations_initiator_shop_general_key
  on public.conversations (initiator_id, shop_id)
  where listing_id is null;

create index conversations_initiator_inbox_idx
  on public.conversations (initiator_id, last_message_at desc, id);

create index conversations_shop_inbox_idx
  on public.conversations (shop_id, last_message_at desc, id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_not_blank_check check (length(btrim(body)) > 0),
  constraint messages_body_max_length_check check (char_length(body) <= 4000)
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at, id);

create table public.conversation_user_states (
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  last_read_at timestamptz,
  archived_at timestamptz,
  muted boolean not null default false,
  marked_unread_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint conversation_user_states_pkey primary key (conversation_id, user_id)
);

create index conversation_user_states_user_id_idx
  on public.conversation_user_states (user_id);

-- Applies the same moddatetime convention already used on every other
-- updated_at column in this schema (profiles, shops, listings,
-- listing_vehicle_details, listing_rental_details, listing_metrics,
-- carts, orders) -- see "Trigger deviation" note above for why this is
-- the one necessary exception to "no triggers" in this migration.
create trigger set_updated_at
  before update on public.conversation_user_states
  for each row execute function moddatetime('updated_at');
