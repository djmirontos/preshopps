-- Identity schema for the approved Preshopps schema design: profiles,
-- user_roles, user_restrictions, and the auth.users -> public.profiles
-- signup trigger. Structural schema only: shops, listings, carts, orders,
-- messaging, reviews, notifications, moderation, disputes, support,
-- storage buckets, business RPCs, and application RLS policies are all
-- created in later migrations (see the approved migration strategy).

-- =============================================================================
-- profiles
-- =============================================================================
--
-- 1:1 extension of auth.users. Deliberately does NOT duplicate email —
-- auth.users.email stays the single source of truth.
--
-- FK delete behavior:
--   id -> auth.users(id) ON DELETE CASCADE
--     This is the standard Supabase 1:1 extension pattern. It is safe here
--     specifically because the approved account model puts the actual
--     "never destroy history" guarantee on the *other side* of the graph:
--     every later domain table that references profiles(id) with real
--     marketplace history (orders, reviews, messages, disputes, support
--     tickets, audit logs, ...) uses ON DELETE RESTRICT against profiles.
--     That means a hard delete of an auth.users row can only ever succeed,
--     and cascade away this profiles row, for an account that has no
--     history anywhere in the system yet. The moment any history exists,
--     the RESTRICT chain on those future tables blocks the whole delete
--     transaction — "delete my account" is handled by an anonymization
--     routine (added later), never a raw delete, for any account that has
--     actually done anything. This migration does not create those other
--     tables yet, so today CASCADE is inert in practice; it becomes the
--     safety-relevant choice once later migrations add the RESTRICT side.
--   province_id / city_id / barangay_id -> locations ON DELETE SET NULL
--     These are optional, display-only profile fields (PRD 5.2). Location
--     reference rows are effectively immutable, but if one were ever
--     corrected/removed, a profile should gracefully lose that optional
--     detail rather than block the location-data change or cascade
--     anything. This is intentionally different from how a *required*
--     location field elsewhere in the schema would be handled.
--
-- Indexes beyond the PK: none added. province_id/city_id/barangay_id are
-- foreign keys (not auto-indexed by Postgres) but there is no MVP query
-- that filters profiles by their own location — marketplace search
-- filters listings' location, not a user's profile location — so a
-- dedicated index here would be speculative.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_storage_path text,
  province_id integer references provinces (id) on delete set null,
  city_id integer references cities_municipalities (id) on delete set null,
  barangay_id integer references barangays (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(display_name)) > 0)
);

-- updated_at maintenance via the already-installed moddatetime extension.
-- profiles is the only table in this migration that needs it: user_roles
-- and user_restrictions are grant/history records, not editable rows.
create trigger set_updated_at
before update on profiles
for each row
execute function extensions.moddatetime(updated_at);

-- =============================================================================
-- user_roles
-- =============================================================================
--
-- Absence of a row = ordinary user. UNIQUE(user_id) enforces at most one
-- elevated role row per user (super_admin already implies admin, so a user
-- never needs two rows). No client write policies and no grant/revoke RPC
-- exist yet — those come later; only structural safety is established here.
--
-- FK delete behavior:
--   user_id -> profiles(id) ON DELETE CASCADE
--     A role grant with no user behind it is meaningless leftover data,
--     not history that needs preserving on its own — the durable audit
--     record of "who granted this role and when" belongs to
--     admin_audit_logs (added later), not to this row surviving.
--   granted_by -> profiles(id) ON DELETE SET NULL
--     Attribution convenience, not the record of accountability (that is
--     also admin_audit_logs' job). Losing "who granted this" on an old row
--     is acceptable; it should never block deleting either profile.
--
-- Indexes beyond the PK/UNIQUE: none. UNIQUE(user_id) already indexes the
-- one real lookup ("does this user have a role, and which"). granted_by is
-- a foreign key without an auto-index, but "all roles granted by admin X"
-- is not a named MVP query, and this table will only ever hold a handful
-- of rows (privileged users are rare) — a dedicated index would be
-- speculative.

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles (id) on delete cascade,
  role user_role_enum not null,
  granted_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- user_restrictions
-- =============================================================================
--
-- Multiple historical rows per user are expected and preserved; there is
-- no separate status column — "currently restricted" is exactly
-- `lifted_at is null`.
--
-- FK delete behavior:
--   user_id -> profiles(id) ON DELETE RESTRICT
--     Restriction history is moderation history, not disposable data — it
--     must survive exactly like orders/reviews/disputes do elsewhere in
--     the approved design. This RESTRICT is part of what makes the
--     anonymization-first account model hold: a profile with restriction
--     history can never be hard-deleted, only anonymized.
--   issued_by -> profiles(id) NOT NULL, ON DELETE RESTRICT
--     The admin who issued the restriction is an accountability record,
--     not a convenience field (mirrors reviews.reviewer_id,
--     disputes.opened_by, moderation_actions.admin_id in the approved
--     design). It is NOT NULL, so RESTRICT is also the only option that
--     preserves that invariant without ever silently nulling it out.
--   lifted_by -> profiles(id) ON DELETE RESTRICT
--     Restriction lifting is itself moderation history: who lifted a
--     restriction, and when, is an accountability record like issued_by,
--     not a convenience field — it must survive rather than silently
--     null out. Stays nullable: an active (not-yet-lifted) restriction
--     has no lifter yet, and a future system-originated lift may
--     legitimately have no human actor at all.

create table user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete restrict,
  restriction_type restriction_type_enum not null,
  reason text not null,
  issued_by uuid not null references profiles (id) on delete restrict,
  lifted_at timestamptz,
  lifted_by uuid references profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (length(btrim(reason)) > 0)
);

-- Partial index for the one query this table actually needs to be fast:
-- "is this user currently restricted" (lifted_at is null). A full,
-- non-partial index on user_id was considered and skipped — per-user
-- restriction history is expected to stay small, and only the active-
-- restriction lookup was called for.
create index user_restrictions_active_idx
  on user_restrictions (user_id)
  where lifted_at is null;

-- =============================================================================
-- handle_new_user()
-- =============================================================================
--
-- Minimal Supabase-style signup trigger: creates exactly one profiles row
-- per new auth.users row. Does not copy email, does not populate location,
-- does not assign roles, does not create a shop, and has no other
-- signup-side effect.
--
-- display_name resolution, in order:
--   1. raw_user_meta_data ->> 'display_name', trimmed, if non-blank
--   2. the email local-part (text before '@'), trimmed, if available
--   3. the literal fallback 'Member'
-- The table-level CHECK on profiles.display_name is the structural
-- backstop guaranteeing this can never end up blank regardless of insert
-- path; the logic below is the friendly, primary defense.
--
-- Security: SECURITY DEFINER is required because this trigger must insert
-- into public.profiles as a direct consequence of a signup performed
-- through Supabase Auth, which does not itself hold (and should not need)
-- direct INSERT privileges on public.profiles — the function runs with
-- the privileges of its owner instead of the invoking role specifically
-- to close that gap for this one, narrowly-scoped, system-triggered
-- insert. `search_path` is set to the empty string, the strictest
-- available hardening against search_path hijacking: no schema is
-- searched implicitly at all, so every application object reference must
-- be (and is) schema-qualified — `public.profiles` below. Built-in
-- functions (btrim, coalesce, position, split_part, nullif) still resolve
-- normally because PostgreSQL always implicitly searches pg_catalog
-- regardless of search_path.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_email_local_part text;
begin
  v_display_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  if v_display_name = '' and new.email is not null and position('@' in new.email) > 1 then
    v_email_local_part := btrim(split_part(new.email, '@', 1));
    v_display_name := coalesce(nullif(v_email_local_part, ''), '');
  end if;

  if v_display_name = '' then
    v_display_name := 'Member';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name);

  return new;
end;
$$;

-- Fires once per new signup. Name and trigger name follow the
-- conventional Supabase pattern for this exact use case.
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();
