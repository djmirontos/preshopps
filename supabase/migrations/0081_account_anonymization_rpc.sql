-- Account deletion/anonymization MVP (PRD 5.4, 33, 34.6, 41, 43): the
-- smallest canonical fulfillment path for a user-requested account
-- deletion, per this task's own GOAL list. One new admin RPC
-- (anonymize_user_account), one widened admin_audit_logs CHECK constraint
-- (to accept the account_anonymized action added in 0080, now safely
-- usable since 0080 already committed), and one widened read RPC
-- (get_admin_support_ticket_detail, adding the target's deletion state so
-- the admin UI can decide whether to show the action). No other function,
-- table, or enum is touched.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0080_account_anonymization_enum (confirmed
-- live, no drift). admin_audit_action_enum now has 'account_anonymized' as
-- its fourth value (confirmed live). public.profiles (0004) confirmed
-- unchanged: id, display_name (not null, non-blank check), avatar_
-- storage_path, province_id/city_id/barangay_id (all nullable, ON DELETE
-- SET NULL), deleted_at, created_at, updated_at (moddatetime trigger --
-- never set manually by any RPC). public.shops (0007) confirmed
-- unchanged: owner_id UNIQUE NOT NULL REFERENCES profiles ON DELETE
-- RESTRICT, messenger_link nullable. public.user_roles/apply_user_
-- restriction/restriction_type_enum/admin_audit_logs all confirmed
-- exactly as their own migrations (0004/0067/0002/0077) left them. Every
-- history-bearing table this task's own PRESERVE list names (order_items,
-- orders, reviews, messages, disputes/dispute_images/dispute_status_
-- history/dispute_admin_notes, moderation_actions, admin_audit_logs,
-- order_status_history) references profiles(id) with ON DELETE RESTRICT,
-- confirmed across their own migrations -- exactly the invariant 0004's
-- own header already predicted ("the RESTRICT chain on those future
-- tables blocks the whole delete transaction -- 'delete my account' is
-- handled by an anonymization routine (added later)"). This migration IS
-- that anonymization routine.
--
-- Canonical findings (PRD 5.4/33/34.6/41/43)
-- -----------------------------------------------------------------------
-- PRD 5.4: "Users may request account deletion. The system must preserve
-- data necessary for: Completed orders, Reviews, Disputes, Moderation,
-- Fraud prevention, Audit/history requirements. Public profile
-- information may be anonymized after deletion." PRD 43.1 lists "Account
-- issue" as an explicit support-ticket category (support_ticket_
-- category_enum already has 'account_issue', 0069) -- this task's own
-- instruction to fulfill deletion through the existing Support -> Account
-- issue path, rather than a new self-service button, is the only reading
-- consistent with PRD 5.4 itself: canon never describes an in-app "Delete
-- Account" control anywhere, only that users "may request" deletion, and
-- PRD 43 is the one canonical request-intake mechanism that already
-- exists for account-scoped issues. PRD 34.6 ("Resolved disputes remain
-- attached to order history for Buyer, Seller, Admin") and PRD 33
-- (suspension preserves orders/messages/reviews/disputes/moderation
-- records) both reinforce the identical preserve-history obligation PRD
-- 5.4 states directly. PRD 41's own audit-log example list includes "User
-- suspension" and "Admin role change" as the same class of broad,
-- user-targeting administrative action this migration's own audit entry
-- belongs alongside.
--
-- Auth-account strategy: (C) preserve auth.users, anonymize profiles --
-- not (A) hard delete, not (B) auth-layer ban
-- -----------------------------------------------------------------------
-- (A) is structurally impossible for any account with real marketplace
-- history: profiles.id -> auth.users(id) ON DELETE CASCADE (0004), but
-- every history table referencing profiles(id) uses ON DELETE RESTRICT --
-- deleting auth.users would cascade to profiles and then immediately fail
-- against the first RESTRICT-referencing history row for any account that
-- has ever placed an order, sent a message, left a review, opened a
-- dispute, filed a report, or held an admin role -- exactly the failure
-- mode 0004's own header already named and pre-empted. (B) (auth.users.
-- banned_until or an Auth Admin API ban) is not implemented: no migration
-- in this schema has ever mutated auth.users (only ever SELECT, for email/
-- verification -- 0065's own established precedent), canon never states
-- sign-in itself must be blocked (only that the account must stop
-- "function[ing] as a normal marketplace account" -- a mutation-layer
-- concern, not a session-layer one), and every marketplace-mutating RPC
-- in this schema already independently re-validates the caller's own
-- profiles.deleted_at server-side on every call (confirmed by a full-text
-- audit: this exact `select p.deleted_at into ... if v_deleted_at is not
-- null then raise ... INTERACTION_BLOCKED` pattern already appears in
-- every marketplace-mutation RPC audited -- create_dispute,
-- submit_support_ticket, submit_cart_order, create_review, start_
-- conversation, send_message, and more) -- so a still-valid JWT from
-- before anonymization already cannot bypass this check regardless of
-- whether the Auth-layer session itself is separately revoked. (C) is
-- therefore both the only structurally safe choice and the one this
-- schema's own foundational migration already named as the intended
-- design.
--
-- Authorization: admin-agnostic for an ordinary target, super_admin-only
-- when the target holds a role
-- -----------------------------------------------------------------------
-- PRD 4.4 lists "Users" among plain Admin's own managed resources (not
-- reserved to Super Admin) and this schema's own established convention
-- treats every moderation-adjacent admin RPC as role-agnostic (0067's own
-- header: "Every RPC below therefore treats 'admin' and 'super_admin'
-- identically... canon never lists a single moderation/report action that
-- Super Admin can do and Admin cannot") -- so anonymizing an ordinary
-- (role-less) account is available to any admin. But when the target
-- itself holds an admin/super_admin role, anonymizing them necessarily
-- also removes that role (this task's own explicit "remove role safely as
-- part of the same transaction" instruction) -- and ARCHITECTURE S8 is
-- unambiguous that "Super Admin alone can manage admin role assignments."
-- Letting an ordinary admin anonymize an admin/super_admin-holding account
-- would be exactly that forbidden capability reached through a side door.
-- This RPC therefore requires the caller to specifically be a super_admin
-- whenever the target currently holds any role at all (SUPER_ADMIN_
-- REQUIRED_FOR_ADMIN_TARGET otherwise) -- the smallest rule that closes
-- this gap without inventing a blanket super_admin-only requirement for
-- ordinary users, and without a separate self-target carve-out (stripping
-- your own admin-level role is not treated differently from stripping
-- someone else's).
--
-- Last-super-admin protection: the identical invariant 0078 already
-- established, reused verbatim
-- -----------------------------------------------------------------------
-- When the target is specifically 'super_admin', every current super_admin
-- row is locked (`for update`) before counting how many OTHER super_admin
-- rows exist; if zero, the whole anonymization is rejected with
-- LAST_SUPER_ADMIN before any mutation happens -- exactly grant_admin_
-- role's/revoke_admin_role's own established shape (0078/0079), reused
-- rather than reinvented, and race-safe for the identical reason those two
-- functions already document. Anonymizing/demoting the last remaining
-- plain 'admin' is never restricted, matching 0078's own reasoning: only
-- super_admin is structurally load-bearing for role management itself.
--
-- Idempotency: an already-anonymized account is a safe no-op, not an error
-- -----------------------------------------------------------------------
-- Matches this schema's universal convention for repeatable admin actions
-- (apply_user_restriction/lift_user_restriction/update_dispute_status/
-- grant_admin_role all treat "already in the target state" as success,
-- never an error) -- was_already_anonymized=true is returned immediately
-- after locking and checking the target's current profiles.deleted_at,
-- before any further validation (role checks, restriction application)
-- runs again. This is also exactly what "no repeated active action if
-- already anonymized" (this task's own Support Integration section) needs
-- the admin UI to be able to render correctly from a single RPC response.
--
-- Profile anonymization: display_name/avatar/location nulled, "Deleted
-- user" reused verbatim from the existing convention
-- -----------------------------------------------------------------------
-- 0034/0053 (reviews) already established the exact convention this task
-- asks for: `case when p.deleted_at is null then p.display_name else
-- 'Deleted user' end`. That CASE WHEN fallback exists only in the reviews
-- read paths (and a null-only variant in notifications' actor display,
-- 0040) -- messaging, disputes, order buyer/seller display, and admin
-- views all just select public.profiles.display_name directly with no
-- fallback of their own. Physically overwriting profiles.display_name to
-- the literal 'Deleted user' (same casing, not invented) is therefore the
-- one change that correctly anonymizes every one of those read paths at
-- once, including the ones with no CASE WHEN of their own -- consistent
-- with this schema's universal "resolve identity via a live join to
-- profiles, never a denormalized snapshot" convention (order items snapshot
-- listing facts, never buyer/seller identity). avatar_storage_path is
-- nulled (the underlying storage object itself is not deleted -- a pure
-- SQL migration has no path to the Storage API, and canon does not
-- require it; the reference being gone is what matters for "public
-- identity," and this is reported as a known, accepted limitation, not
-- silently glossed over). province_id/city_id/barangay_id (0004's own
-- "optional, display-only profile fields") are also nulled as the
-- conservative choice for "other direct identifying public profile data"
-- -- a judgment call, documented here, not a canon-explicit requirement.
-- Order item snapshots (title/price/quantity/cover image/condition/shop
-- context) are never touched -- they were never about buyer/seller
-- identity in the first place (CLAUDE.md's own snapshot list), and
-- nothing in this migration writes to order_items at all.
--
-- Shop/listing suppression: reuse apply_user_restriction's
-- account_suspended path, the exact mechanism already checked in 20+
-- existing RPCs -- rather than inventing a new one
-- -----------------------------------------------------------------------
-- A full audit of every RPC checking `restriction_type in
-- ('seller_suspended', 'account_suspended')` found this exact check
-- already gates public shop/listing visibility (browse_listings, get_
-- shop_detail), messaging eligibility (start_conversation and others),
-- favorites/cart eligibility, order submission, listing management, and
-- Trusted Seller recalculation -- 20+ call sites across this schema. This
-- is not merely defense-in-depth: create_listing (0054) has NO
-- profiles.deleted_at check of its own at all -- it relies entirely on
-- this restriction check -- so setting deleted_at alone would leave a
-- deleted seller still able to create new listings; calling apply_user_
-- restriction is what actually closes that gap. Rather than widening
-- every one of those 20+ call sites individually (real "scatter," and
-- this task's own instruction is explicit: "Do not scatter dozens of
-- unrelated changes if current deleted_at checks already cover most
-- flows"), this migration calls the existing, unmodified
-- apply_user_restriction(p_user_id, 'account_suspended', v_reason) once,
-- inside the same transaction --
-- activating every one of those existing checks for free, with zero other
-- RPC touched. apply_user_restriction is itself already idempotent (a
-- pre-existing active account_suspended restriction, e.g. from an earlier
-- manual suspension, is a safe no-op) and already writes its own
-- moderation_actions row and Trusted-Seller-recalculation hook -- none of
-- that is duplicated here. This is a deliberate, documented trade-off:
-- restriction_type_enum has no dedicated "deleted" value, so this reuses
-- 'account_suspended' rather than adding a new enum value that would
-- require widening every one of those 20+ IN-list check sites to also
-- accept it -- the minor semantic looseness (an admin could technically
-- still call lift_user_restriction against this row) has no functional
-- effect, since profiles.deleted_at is never cleared by any RPC in this
-- schema and every marketplace-mutating RPC re-checks it independently;
-- lifting the restriction would only re-expose the shop/listing publicly
-- under the "Deleted user" display name, a low-severity, fully recoverable
-- edge case, not a security gap. shops.messenger_link (the one field this
-- task explicitly names outside of profiles -- "Messenger/external
-- contact") is nulled directly; shops.name/description/logo_storage_path
-- are deliberately left untouched -- buyers with a real historical order
-- from this shop still need a coherent shop name/context on their own
-- order-history pages (PRD 5.4's own "preserve data necessary for
-- completed orders" requirement), and the shop is already fully
-- suppressed from every public discovery surface regardless of its own
-- name value.
--
-- Admin-role removal: same audit shape revoke_admin_role already writes,
-- performed directly (not by calling revoke_admin_role itself)
-- -----------------------------------------------------------------------
-- revoke_admin_role (0078/0079) requires its OWN caller to be super_admin
-- -- correct for its own direct entry point, but this RPC's caller is only
-- required to be super_admin when the TARGET holds a role (see above); for
-- an admin-agnostic call against a role-less target, calling revoke_admin_
-- role would be redundant anyway (nothing to revoke). Rather than
-- reusing revoke_admin_role's own authorization-coupled RPC, the identical
-- delete-and-audit shape is performed directly here once already inside
-- the role-holder branch (where super_admin has already been confirmed).
-- The admin_audit_logs row uses the exact same action/column shape
-- revoke_admin_role itself writes (action = 'admin_role_revoked',
-- previous_role = the role just removed, new_role = null) -- no new
-- action value is invented for this sub-step.
--
-- Preserved, untouched by this migration
-- -----------------------------------------------------------------------
-- order_items, orders, order_status_history, reviews, review_images,
-- review_replies, messages, conversations, disputes, dispute_images,
-- dispute_status_history, dispute_admin_notes, reports, moderation_
-- actions, support_tickets -- none of these tables is written to by
-- anonymize_user_account. Nothing is deleted; only public.profiles
-- (identity fields), public.shops (messenger_link only), public.
-- user_roles (the target's own row, only when present and permitted), and
-- public.user_restrictions/moderation_actions/admin_audit_logs (via the
-- existing apply_user_restriction call and this migration's own two
-- audit inserts) are ever written.

-- ============================================================
-- admin_audit_logs: widen the role-transition CHECK to also accept
-- account_anonymized (previous_role/new_role both null -- this is not a
-- role transition)
-- ============================================================
alter table public.admin_audit_logs
  drop constraint admin_audit_logs_role_transition_check;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_role_transition_check
  check (
    (action = 'admin_role_granted' and previous_role is null and new_role is not null)
    or (action = 'admin_role_changed' and previous_role is not null and new_role is not null and previous_role <> new_role)
    or (action = 'admin_role_revoked' and previous_role is not null and new_role is null)
    or (action = 'account_anonymized' and previous_role is null and new_role is null)
  );

-- ============================================================
-- anonymize_user_account
-- ============================================================
create or replace function public.anonymize_user_account(
  p_user_id uuid,
  p_reason text
)
returns table (
  user_id uuid,
  was_already_anonymized boolean,
  anonymized_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_role public.user_role_enum;
  v_reason text;
  v_deleted_at timestamptz;
  v_target_role public.user_role_enum;
  v_other_super_admin_count integer;
  v_now timestamptz;
begin
  -- ===================== authentication + admin authorization (any admin, refined below for a role-holding target) =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select ur.role into v_caller_role
    from public.user_roles ur
    where ur.user_id = v_caller;

  if v_caller_role is null then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  -- ===================== reason validation (required, per this task's own instruction) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A reason is required.' using detail = 'REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'Please shorten the reason.' using detail = 'REASON_TOO_LONG';
  end if;

  -- ===================== lock the target profile row (universal serialization point) =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = p_user_id
    for update;

  if not found then
    raise exception 'User not found.' using detail = 'USER_NOT_FOUND';
  end if;

  -- ===================== idempotent: already anonymized is a safe no-op =====================
  if v_deleted_at is not null then
    return query select p_user_id, true, v_deleted_at;
    return;
  end if;

  -- ===================== role-holder safety: anonymizing an admin/super_admin requires a super_admin caller =====================
  select ur.role into v_target_role
    from public.user_roles ur
    where ur.user_id = p_user_id;

  if v_target_role is not null then
    if v_caller_role is distinct from 'super_admin' then
      raise exception 'Only a super admin can anonymize an account that holds an admin role.' using detail = 'SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET';
    end if;

    -- ===================== last-super-admin protection: never let the super_admin count reach zero =====================
    if v_target_role = 'super_admin' then
      perform 1 from public.user_roles ur where ur.role = 'super_admin' for update;

      select count(*) into v_other_super_admin_count
        from public.user_roles ur
        where ur.role = 'super_admin' and ur.user_id <> p_user_id;

      if v_other_super_admin_count = 0 then
        raise exception 'Cannot anonymize the last remaining super admin.' using detail = 'LAST_SUPER_ADMIN';
      end if;
    end if;
  end if;

  v_now := now();

  -- ===================== anonymize public identity on the profile =====================
  update public.profiles
    set display_name = 'Deleted user',
        avatar_storage_path = null,
        province_id = null,
        city_id = null,
        barangay_id = null,
        deleted_at = v_now
    where id = p_user_id;

  -- ===================== remove the admin role safely, same transaction, with the same audit shape revoke_admin_role writes =====================
  if v_target_role is not null then
    delete from public.user_roles as ur where ur.user_id = p_user_id;

    insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
      values (v_caller, p_user_id, 'admin_role_revoked', v_target_role, null, v_reason);
  end if;

  -- ===================== remove the one external-contact field this task names outside of profiles =====================
  update public.shops
    set messenger_link = null
    where owner_id = p_user_id;

  -- ===================== suppress shop/listings via the existing, already-comprehensive account_suspended path =====================
  perform public.apply_user_restriction(p_user_id, 'account_suspended', v_reason);

  -- ===================== the anonymization's own audit record =====================
  insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
    values (v_caller, p_user_id, 'account_anonymized', null, null, v_reason);

  return query select p_user_id, false, v_now;
end;
$$;

revoke all on function public.anonymize_user_account(uuid, text) from public;
revoke all on function public.anonymize_user_account(uuid, text) from anon;
grant execute on function public.anonymize_user_account(uuid, text) to authenticated;

-- ============================================================
-- get_admin_support_ticket_detail: widen to surface the target's
-- anonymization state (admin readability -- decide whether to show the
-- action, without exposing anything not already admin-visible).
-- PostgreSQL cannot CREATE OR REPLACE a function whose RETURNS TABLE
-- column list changes (its OUT-parameter row type would differ) -- an
-- explicit DROP FUNCTION first is required, then a fresh CREATE FUNCTION
-- under the identical name/parameter signature.
-- ============================================================
drop function public.get_admin_support_ticket_detail(uuid);

create function public.get_admin_support_ticket_detail(
  p_ticket_id uuid
)
returns table (
  ticket_id uuid,
  category public.support_ticket_category_enum,
  message text,
  user_id uuid,
  user_display_name text,
  user_deleted_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  if not exists (select 1 from public.support_tickets st where st.id = p_ticket_id) then
    raise exception 'Support ticket not found.' using detail = 'TICKET_NOT_FOUND';
  end if;

  return query
    select
      st.id as ticket_id,
      st.category,
      st.message,
      st.user_id,
      p.display_name as user_display_name,
      p.deleted_at as user_deleted_at,
      st.created_at
    from public.support_tickets st
    join public.profiles p on p.id = st.user_id
    where st.id = p_ticket_id;
end;
$$;

revoke all on function public.get_admin_support_ticket_detail(uuid) from public;
revoke all on function public.get_admin_support_ticket_detail(uuid) from anon;
grant execute on function public.get_admin_support_ticket_detail(uuid) to authenticated;
