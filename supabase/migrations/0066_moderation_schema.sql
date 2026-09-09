-- Moderation / Reports / Admin: structural foundation only. Creates four
-- new enums (report_target_type_enum, report_reason_enum,
-- report_status_enum, moderation_action_type_enum) and two new tables
-- (reports, moderation_actions). No RPC, no RLS policy DDL (RLS is
-- expected to auto-enable on these two new tables via this project's
-- existing rls_auto_enable event trigger, exactly like 0030's own
-- identical forward note for user_blocks/conversations/messages/
-- conversation_user_states -- confirmed, not assumed, immediately after
-- this migration is applied). No existing table/enum/function is touched.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0065_trusted_seller_recalculation (confirmed
-- live via list_migrations, no drift). user_role_enum ('admin',
-- 'super_admin'), restriction_type_enum ('seller_suspended',
-- 'buyer_restricted', 'account_suspended'), user_roles (user_id unique,
-- role, granted_by, created_at), and user_restrictions (user_id,
-- restriction_type, reason not null, issued_by not null, lifted_at,
-- lifted_by, created_at) all confirmed unchanged since 0004 -- neither
-- table has ever been read or written by any function (confirmed by a
-- full-text search of every migration), making this the first migration
-- to actually use either. user_restrictions' own header (0004) already
-- anticipated this exact table by name: "the admin who issued the
-- restriction is an accountability record... mirrors reviews.reviewer_id,
-- disputes.opened_by, moderation_actions.admin_id in the approved
-- design" -- moderation_actions.admin_id below is that anticipated
-- column, not a new invention. listings.shop_id/title, shops.owner_id/
-- name, reviews.buyer_id/shop_id/rating/body, and conversations.
-- initiator_id/shop_id all confirmed unchanged since their own migrations
-- (0008, 0007, 0033, 0030). No reports, moderation_actions, or similarly-
-- named table/enum exists anywhere -- clean namespace.
--
-- Canonical report targets (PRD 31) -- exactly these four, nothing added
-- -----------------------------------------------------------------------
-- "Users may report: Listing, Seller/shop, Review, Message/conversation."
-- report_target_type_enum has exactly these four values. A standalone
-- "report a user" target is deliberately NOT added: canon's own list names
-- Seller/shop (not "user") as the identity-level target, and separately
-- provides Blocking (PRD 30) as the mechanism for buyer-buyer/interpersonal
-- conduct that isn't shop/listing/review/conversation-shaped -- adding a
-- fifth "user" target would be inventing a target canon does not list.
--
-- Canonical report reasons (PRD 31) -- exactly these seven, verbatim
-- -----------------------------------------------------------------------
-- "Report reasons include: Scam/Fraud, Prohibited Item, Misleading,
-- Harassment, Spam, Duplicate/Spam, Other." report_reason_enum has exactly
-- these seven values (Spam and Duplicate/Spam are both listed in canon as
-- distinct reasons, despite the textual overlap -- reproduced verbatim as
-- two separate enum values, not collapsed).
--
-- reports: one row per submission, immutable except its own resolution
-- -----------------------------------------------------------------------
-- reporter_id/listing_id/shop_id/review_id/conversation_id/reason/
-- description/created_at are never updated by any RPC written against this
-- schema (0067) -- the original report is permanent evidence. Only status/
-- resolved_by/resolved_at/resolution_note ever change, exactly once, when
-- an admin resolves or dismisses the case ("Admin may: ... Resolve
-- moderation cases," PRD 31) -- this is the report's own append-only
-- resolution, not a rewrite of what was reported. Exactly one of
-- listing_id/shop_id/review_id/conversation_id is populated, matching
-- target_type -- the same polymorphic-target-via-nullable-FK-columns shape
-- already established by public.notifications (order_id/conversation_id/
-- review_id). All four target FKs use ON DELETE RESTRICT, matching this
-- schema's dominant "moderation/history rows must survive" pattern
-- (shops.owner_id, listings.shop_id, reviews.order_id, etc. all RESTRICT)
-- -- in practice none of these four referenced tables is ever hard-deleted
-- anywhere in this codebase, so RESTRICT never actually blocks anything;
-- it only guarantees a report can never silently lose its own target
-- identity if that ever changed. reporter_id also RESTRICT, mirroring
-- reviews.reviewer_id/disputes.opened_by's identical "accountability
-- record, must survive" reasoning. resolved_by RESTRICT for the same
-- reason once populated; nullable because a pending report has not yet
-- been resolved by anyone. description/resolution_note both capped at
-- 1000 chars, matching this schema's own established review-body/report-
-- description length convention (reviews.body, create_review's own
-- REVIEW_BODY_TOO_LONG check). reports_resolution_state_check keeps
-- status/resolved_by/resolved_at consistent with each other at the
-- database level, not only inside the RPC that writes them.
--
-- moderation_actions: the dedicated, append-only audit trail (PRD 41)
-- -----------------------------------------------------------------------
-- Deliberately separate from user_restrictions, per this task's own
-- instruction ("do not rely only on mutable user_restrictions rows if
-- that would lose history"): user_restrictions remains the live "is this
-- user currently restricted" source every existing RPC already queries
-- (lifted_at is null), while moderation_actions is the dedicated,
-- purpose-built, never-updated audit log PRD 41 actually asks for --
-- admin identity (admin_id), action performed (action_type: exactly
-- 'restriction_applied' or 'restriction_lifted' -- this migration/task's
-- scope is restriction actions only; PRD 41's other example actions
-- (listing removal, review removal, admin role change) have no RPC to
-- write them yet and are out of this task's scope, so no action_type
-- value is invented for them), target resource/user (target_user_id),
-- reason (nullable -- required only for an apply, per the CHECK below;
-- optional for a lift, since canon never states a reason is required to
-- restore privileges), and timestamp (created_at). "Previous state"/"new
-- state" columns are not added: action_type already unambiguously encodes
-- the transition (applied = inactive -> active, lifted = active ->
-- inactive), so a separate pair of columns would only duplicate that.
-- restriction_id links each audit row to the exact user_restrictions row
-- it concerns (ON DELETE RESTRICT -- that row is never deleted either).
-- No report_id column: a restriction action is not required to originate
-- from a formal report (proactive moderation is a real, unremarkable
-- case), and coupling the two tightly would invent a requirement canon
-- does not state -- the admin UI can present both a report and the
-- generic restriction control together contextually without a hard
-- database link between them.
--
-- Security: no RLS policy is added to either new table (matching every
-- other write-guarded table in this schema) -- 0067's SECURITY DEFINER
-- RPCs are the sole trusted path to read or write reports/moderation_
-- actions, exactly like publish_listing/update_listing_status/
-- recalculate_trusted_seller already are for their own tables.

create type public.report_target_type_enum as enum (
  'listing',
  'shop',
  'review',
  'conversation'
);

create type public.report_reason_enum as enum (
  'scam_fraud',
  'prohibited_item',
  'misleading',
  'harassment',
  'spam',
  'duplicate_spam',
  'other'
);

create type public.report_status_enum as enum (
  'pending',
  'resolved',
  'dismissed'
);

create type public.moderation_action_type_enum as enum (
  'restriction_applied',
  'restriction_lifted'
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  target_type public.report_target_type_enum not null,
  listing_id uuid references public.listings(id) on delete restrict,
  shop_id uuid references public.shops(id) on delete restrict,
  review_id uuid references public.reviews(id) on delete restrict,
  conversation_id uuid references public.conversations(id) on delete restrict,
  reason public.report_reason_enum not null,
  description text,
  status public.report_status_enum not null default 'pending',
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  constraint reports_description_length_check
    check (description is null or char_length(description) <= 1000),
  constraint reports_resolution_note_length_check
    check (resolution_note is null or char_length(resolution_note) <= 1000),
  constraint reports_exactly_one_target_check
    check (
      (target_type = 'listing' and listing_id is not null and shop_id is null and review_id is null and conversation_id is null)
      or (target_type = 'shop' and shop_id is not null and listing_id is null and review_id is null and conversation_id is null)
      or (target_type = 'review' and review_id is not null and listing_id is null and shop_id is null and conversation_id is null)
      or (target_type = 'conversation' and conversation_id is not null and listing_id is null and shop_id is null and review_id is null)
    ),
  constraint reports_resolution_state_check
    check (
      (status = 'pending' and resolved_by is null and resolved_at is null)
      or (status <> 'pending' and resolved_by is not null and resolved_at is not null)
    )
);

create index reports_status_created_at_id_idx
  on public.reports (status, created_at desc, id desc);

create index reports_reporter_id_idx
  on public.reports (reporter_id);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete restrict,
  action_type public.moderation_action_type_enum not null,
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  restriction_type public.restriction_type_enum not null,
  restriction_id uuid not null references public.user_restrictions(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  constraint moderation_actions_reason_required_for_apply_check
    check (action_type <> 'restriction_applied' or (reason is not null and length(btrim(reason)) > 0))
);

create index moderation_actions_target_user_created_at_idx
  on public.moderation_actions (target_user_id, created_at desc, id desc);
