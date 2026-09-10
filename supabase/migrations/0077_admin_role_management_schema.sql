-- Admin Bootstrap / Admin Role Management foundation, schema layer (PRD
-- 4.4/4.5, ARCHITECTURE S8/S10, PRD 41): one new enum
-- (admin_audit_action_enum), one new table (admin_audit_logs -- already
-- named and anticipated by both ARCHITECTURE.md's own Moderation domain
-- list and 0004_identity.sql's own user_roles header comment: "the durable
-- audit record of 'who granted this role and when' belongs to
-- admin_audit_logs (added later)"), and one service_role-only bootstrap
-- function. No role-management RPC lives here (0078). No RLS policy DDL.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0076_harden_dispute_image_paths (confirmed
-- live, no drift). public.user_role_enum ('admin', 'super_admin') and
-- public.user_roles (id, user_id UNIQUE, role, granted_by, created_at)
-- both confirmed unchanged since 0004 -- one row max per user (UNIQUE),
-- no RLS policy (deny-all via rls_auto_enable), and confirmed by a
-- full-text search of every migration to have never been read or written
-- by any RPC anywhere in this schema -- this is the first migration to
-- actually use it. Every existing admin-authorization check in this
-- schema (0067/0070/0075) is role-agnostic --
-- `exists (select 1 from public.user_roles where user_id = auth.uid())`
-- -- none has ever distinguished 'admin' from 'super_admin'; this is the
-- first migration to introduce a super_admin-specific check, and it does
-- so additively (new functions only) without touching any existing
-- admin-agnostic RPC's authorization logic. No admin_audit_logs table or
-- admin_audit_action_enum exists anywhere yet -- clean namespace.
--
-- Canonical findings
-- -----------------------------------------------------------------------
-- PRD 4.5: "Super Admin can perform all Admin actions plus: Manage
-- admins, Manage critical platform settings, Perform elevated
-- administrative actions." ARCHITECTURE S8: "Super Admin alone can manage
-- admin role assignments." Neither restricts *which* roles a super_admin
-- may assign -- so a super_admin may grant either 'admin' or
-- 'super_admin' (0078); ordinary admin may never call any role-management
-- RPC. PRD 41 (Audit Log) explicitly lists "Admin role change" as a
-- required auditable action, capturing: admin identity, action performed,
-- target resource/user, previous state, new state, timestamp, reason when
-- applicable -- admin_audit_logs' columns below are exactly that list.
--
-- Why NOT moderation_actions (0066) -- inspected and rejected
-- -----------------------------------------------------------------------
-- moderation_actions.restriction_id is NOT NULL, references
-- user_restrictions(id), and moderation_action_type_enum has exactly
-- 'restriction_applied'/'restriction_lifted' -- 0066's own header already
-- flagged this precisely: "admin role change [has] no RPC to write [it]
-- yet and [is] out of this task's scope, so no action_type value is
-- invented for [it]." A role change has no user_restrictions row to link
-- to at all; weakening restriction_id to nullable and overloading its
-- action_type enum with an unrelated event class would make
-- moderation_actions' own semantics misleading (a table literally named
-- and shaped around *restriction* actions no longer meaning that). This
-- confirms the task's own suspicion and ARCHITECTURE.md's own separate
-- naming of admin_audit_logs alongside (not instead of) moderation_actions
-- in its Moderation domain list (S10) -- they are two different tables
-- for two different classes of admin action, not one overloaded table.
--
-- admin_audit_logs: dedicated, minimal, scoped to role-management for now
-- -----------------------------------------------------------------------
-- This migration writes exactly the columns PRD 41 asks for and nothing
-- broader: actor_id (nullable -- see bootstrap below), target_user_id
-- (not null), action (admin_role_granted/changed/revoked), previous_role/
-- new_role (nullable user_role_enum, encoding the actual transition),
-- reason (nullable text), created_at. It does not attempt to
-- become a general-purpose action log for every existing admin RPC
-- (reports/disputes/support/moderation already have their own
-- purpose-built history: reports.resolved_*, moderation_actions,
-- dispute_status_history/dispute_admin_notes) -- retrofitting those to
-- also write here would be unrelated admin CRUD/broader-scope work this
-- task explicitly excludes. admin_audit_action_enum can gain more values
-- later (ALTER TYPE ... ADD VALUE, exactly like notification_type_enum
-- did for disputes) if/when a future task expands admin_audit_logs'
-- scope; nothing here forecloses that.
--
-- actor_id is nullable specifically for the bootstrap case: there is no
-- authenticated caller at all for a one-time service_role-only bootstrap
-- (no auth.uid()), so fabricating an actor would be incorrect rather than
-- merely incomplete -- exactly complete_order's own existing precedent
-- (0029/0075) for its own system-originated notifications ("actor is
-- NULL: this function has no auth.uid() of its own... fabricating an
-- actor would be incorrect"). Once populated (every 0078 RPC always
-- supplies v_caller), it is ON DELETE RESTRICT, matching every other
-- admin-identity FK in this schema (moderation_actions.admin_id,
-- reports.resolved_by, disputes.resolved_by) -- "accountability record,
-- must survive" -- profiles are never hard-deleted in this schema
-- (anonymization-first model), so RESTRICT never actually blocks
-- anything in practice; it only guarantees this durable audit trail can
-- never silently lose an actor via cascade. target_user_id is likewise
-- NOT NULL, ON DELETE RESTRICT, for the identical reason.
--
-- No RLS policy on admin_audit_logs (matching every other admin-only
-- table in this schema -- reports/moderation_actions/support_tickets/
-- disputes/dispute_admin_notes): rls_auto_enable enables RLS with zero
-- policies (deny-all) automatically; all access is exclusively through
-- 0078's SECURITY DEFINER RPCs.
--
-- Bootstrap design: service_role-only, single-use, id-addressed
-- -----------------------------------------------------------------------
-- No public "become admin" RPC is created, per this task's explicit
-- instruction -- there is no authenticated/anon/public grant on this
-- function at all; it is invoked only via trusted backend/Supabase
-- tooling (the Supabase SQL editor, which runs as the postgres superuser
-- and bypasses grants entirely, or a service-role-authenticated call),
-- never from the shipped app. bootstrap_first_super_admin(p_user_id uuid):
--
--   - Takes an existing user's id (uuid), not an email. An operator using
--     trusted SQL/Supabase tooling can trivially resolve either field
--     (Authentication > Users in the dashboard, or a plain
--     `select id from auth.users where email = '...'` in the SQL editor)
--     -- taking uuid keeps this security-critical function's own body
--     simple (no email normalization/case-folding/uniqueness logic
--     inside a one-time bootstrap path) and matches this entire schema's
--     universal convention that every target-user parameter anywhere is
--     always a uuid, never an email string. This is the safer choice
--     precisely because it is the smaller, more auditable surface.
--   - Only works when public.user_roles is completely empty
--     (`not exists (select 1 from public.user_roles)`) -- the literal
--     "only works when user_roles is empty" instruction, not merely "no
--     super_admin exists yet" (which would still allow bootstrapping a
--     second super_admin alongside an existing lone admin row, a case
--     this task's design does not ask for and the plain admin-role-
--     management RPCs in 0078 already handle once ANY role row exists).
--   - Validates the target exists and is not a deleted/anonymized
--     account (public.profiles, deleted_at is null) before inserting.
--   - Inserts exactly one super_admin row (never 'admin' -- the whole
--     point of bootstrap is to create the first role-manager, and only
--     super_admin can manage roles at all, per ARCHITECTURE S8).
--   - Becomes structurally unusable the instant this insert succeeds:
--     any subsequent call raises BOOTSTRAP_ALREADY_USED because
--     user_roles is no longer empty -- no separate "used" flag/table is
--     needed; the precondition check against user_roles itself is the
--     single source of truth for "has bootstrap already happened."
--   - Writes one admin_audit_logs row (actor_id = null, action =
--     'admin_role_granted', previous_role = null, new_role =
--     'super_admin') so the very first role grant is not invisible to
--     the same audit trail every later 0078 grant/revoke writes to.
--   - Grants: revoked from public/anon/authenticated entirely, granted
--     only to service_role -- identical grant shape to complete_order
--     (0029/0075), this schema's own existing precedent for a function
--     meant to be invoked only from a trusted, non-app-facing path.

create type public.admin_audit_action_enum as enum (
  'admin_role_granted',
  'admin_role_changed',
  'admin_role_revoked'
);

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete restrict,
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  action public.admin_audit_action_enum not null,
  previous_role public.user_role_enum,
  new_role public.user_role_enum,
  reason text,
  created_at timestamptz not null default now(),
  constraint admin_audit_logs_reason_length_check
    check (reason is null or char_length(reason) <= 1000),
  constraint admin_audit_logs_role_transition_check
    check (
      (action = 'admin_role_granted' and previous_role is null and new_role is not null)
      or (action = 'admin_role_changed' and previous_role is not null and new_role is not null and previous_role <> new_role)
      or (action = 'admin_role_revoked' and previous_role is not null and new_role is null)
    )
);

create index admin_audit_logs_target_user_created_at_idx
  on public.admin_audit_logs (target_user_id, created_at desc, id desc);

-- ============================================================
-- bootstrap_first_super_admin: service_role-only, single-use
-- ============================================================
create or replace function public.bootstrap_first_super_admin(
  p_user_id uuid
)
returns table (
  user_id uuid,
  role public.user_role_enum,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created_at timestamptz;
begin
  if exists (select 1 from public.user_roles) then
    raise exception 'Bootstrap has already been used.' using detail = 'BOOTSTRAP_ALREADY_USED';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null) then
    raise exception 'Target user not found.' using detail = 'TARGET_USER_NOT_FOUND';
  end if;

  insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, 'super_admin', null)
    returning created_at into v_created_at;

  insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
    values (null, p_user_id, 'admin_role_granted', null, 'super_admin', 'Bootstrap: first super_admin');

  return query
    select p_user_id, 'super_admin'::public.user_role_enum, v_created_at;
end;
$$;

revoke all on function public.bootstrap_first_super_admin(uuid) from public;
revoke all on function public.bootstrap_first_super_admin(uuid) from anon;
revoke all on function public.bootstrap_first_super_admin(uuid) from authenticated;
grant execute on function public.bootstrap_first_super_admin(uuid) to service_role;
