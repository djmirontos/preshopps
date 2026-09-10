-- Signup-time Terms of Use / Privacy Policy acceptance: closes the other
-- half of the PRD 5.5 gap 0058's own header explicitly deferred
-- ("Signup-time Terms of Use / Privacy Policy acceptance (PRD 5.5's other
-- sentence) ... explicitly out of scope"). The real public /terms and
-- /privacy pages now exist (this session's prior Legal/Public Pages
-- batch), so this requirement can finally be enforced for real rather
-- than invented against nonexistent pages.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0070_admin_support_ticket_rpcs (confirmed via
-- a full-text search of every migration file, no drift). profiles columns
-- confirmed exactly as 0004 left them plus 0058's own addition: id,
-- display_name, avatar_storage_path, province_id, city_id, barangay_id,
-- deleted_at, created_at, updated_at, seller_policies_accepted_at -- no
-- terms/privacy acceptance column of any kind. handle_new_user() (0004)
-- has never been redefined by any later migration (confirmed by grepping
-- every migration for "handle_new_user" -- 0015/0016/0030/0033 only
-- mention it in comments); this is the first migration to touch it.
-- Signup itself (components/auth/SignUpForm.tsx) calls
-- supabase.auth.signUp() directly with no options.data at all today --
-- profile creation is entirely the handle_new_user() trigger's job, with
-- no post-signup RPC in the loop, confirming the trigger is the only
-- transaction-safe place this requirement can be enforced without adding
-- a fragile second round trip after signUp() that could leave an
-- auth.users row behind with no matching consent record if it failed.
--
-- Schema change: two nullable columns, not one combined column
-- -----------------------------------------------------------------------
-- Unlike 0058's single seller_policies_accepted_at (justified there by
-- PRD 5.5 naming Marketplace Rules + Prohibited Items Policy as one
-- combined bullet), this task explicitly specifies two separate columns
-- -- terms_accepted_at and privacy_accepted_at -- even though the signup
-- UI still gates both behind a single combined checkbox and this trigger
-- always stamps both together. Both nullable, no default, no CHECK: NULL
-- means "not yet accepted" (every existing account, untouched by this
-- migration -- no backfill, no invented acceptance date), non-null means
-- "accepted, at this timestamp." This lets future admin/audit code tell
-- a legacy account (both null) apart from a newly compliant one (both
-- set) at the column level, and keeps the two policies independently
-- queryable/versionable later without a migration, even though today
-- they are always written in the same transaction with the same value.
--
-- Enforcement: the signup trigger itself rejects a non-consenting signup
-- -----------------------------------------------------------------------
-- handle_new_user() already runs AFTER INSERT on auth.users, in the same
-- transaction Supabase Auth's signUp() opens for the whole signup. Adding
-- the consent check here (rather than a separate post-signup RPC) means
-- a signup that arrives without explicit consent never completes at
-- all -- the RAISE EXCEPTION below rolls back the entire transaction,
-- including the auth.users insert itself, so no account is left in a
-- half-created "auth user exists but never consented" state. This is the
-- transaction-safe pattern the task asked for over a fragile two-step
-- flow. The consent signal is read from
-- new.raw_user_meta_data ->> 'policies_accepted', which SignUpForm.tsx
-- now always sends as the literal `true` once its own checkbox is
-- checked (enforced client-side too, but that is UX only -- this trigger
-- is the actual security boundary). The comparison against the literal
-- text 'true' (never a ::boolean cast) means any missing, malformed, or
-- tampered value simply reads as "not accepted" and raises, rather than
-- risking a cast-error exception on unexpected input.
-- terms_accepted_at/privacy_accepted_at are stamped with this function's
-- own transaction-local now() -- never a client-supplied timestamp of any
-- kind, since signUp()'s metadata payload has no timestamp field for this
-- trigger to even read.
--
-- No re-consent, no versioning, no existing-user changes
-- -----------------------------------------------------------------------
-- This migration touches zero existing rows -- no UPDATE statement of any
-- kind against profiles. Every current account's terms_accepted_at/
-- privacy_accepted_at is NULL after this migration runs, exactly as
-- before it (the columns did not exist before). No policy-version
-- column/identifier is added, matching 0058's own established precedent
-- of not inventing versioning canon does not require. Ordinary
-- authenticated callers have no write path to either new column at all:
-- profiles has RLS enabled with zero client policies (confirmed live),
-- and no update-profile RPC exists anywhere in this schema (confirmed by
-- grepping every migration for "update_profile"/"update_my_profile") --
-- the only writer of these two columns, ever, is this trigger, once, at
-- INSERT time.

alter table public.profiles
  add column terms_accepted_at timestamptz,
  add column privacy_accepted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_email_local_part text;
  v_policies_accepted boolean;
  v_now timestamptz;
begin
  v_display_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  if v_display_name = '' and new.email is not null and position('@' in new.email) > 1 then
    v_email_local_part := btrim(split_part(new.email, '@', 1));
    v_display_name := coalesce(nullif(v_email_local_part, ''), '');
  end if;

  if v_display_name = '' then
    v_display_name := 'Member';
  end if;

  -- ===================== signup-time Terms of Use / Privacy Policy acceptance (PRD 5.5) =====================
  v_policies_accepted := coalesce(new.raw_user_meta_data ->> 'policies_accepted', 'false') = 'true';

  if not v_policies_accepted then
    raise exception 'You must agree to the Terms of Use and Privacy Policy to create an account.' using detail = 'SIGNUP_POLICIES_NOT_ACCEPTED';
  end if;

  v_now := now();

  insert into public.profiles (id, display_name, terms_accepted_at, privacy_accepted_at)
  values (new.id, v_display_name, v_now, v_now);

  return new;
end;
$$;
