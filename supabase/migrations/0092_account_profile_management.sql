-- ============================================================================
-- 0092_account_profile_management.sql
--
-- P1: Account/Profile Management -- BACKEND FOUNDATION ONLY.
--
-- Locked product model (per the two prior read-only audits):
--   PUBLIC identity fields:  display_name, avatar_storage_path, bio
--   PRIVATE account fields:  first_name, last_name, mobile_number,
--                            province_id, city_id, barangay_id
-- Email stays in Supabase Auth only -- never duplicated onto profiles.
-- No username, no display_name uniqueness, no street address, no GPS,
-- no Auth phone/OTP. Profile location stays PRIVATE for MVP. No new
-- public_profiles view -- the existing purpose-specific RPC projections
-- (get_shop_reviews, get_conversation_context, get_my_notifications,
-- etc.) remain the only public exposure surface for display_name/
-- avatar_storage_path; none of them are touched by this migration.
-- ============================================================================

-- ===================== 1. profile columns =====================
-- province_id/city_id/barangay_id already exist (0004_identity.sql) and
-- are reused as-is -- no duplicate location columns.

alter table public.profiles
  add column first_name text,
  add column last_name text,
  add column bio text,
  add column mobile_number text;

-- ===================== 2. defense-in-depth CHECK constraints =====================
-- The existing profiles_display_name_check (non-empty) is preserved
-- untouched; this adds the length cap alongside it as its own
-- constraint, matching this repo's additive-constraint convention.

alter table public.profiles
  add constraint profiles_display_name_length_check check (char_length(btrim(display_name)) <= 50),
  add constraint profiles_first_name_length_check check (first_name is null or char_length(first_name) <= 50),
  add constraint profiles_last_name_length_check check (last_name is null or char_length(last_name) <= 50),
  add constraint profiles_bio_length_check check (bio is null or char_length(bio) <= 300),
  add constraint profiles_mobile_number_length_check check (mobile_number is null or char_length(mobile_number) <= 16);

-- ===================== 3A. handle_new_user(): remove the email-local-part fallback =====================
-- Live audit finding: every existing account's display_name derives from
-- its own email local-part today, leaking part of a private email
-- address through every public display_name projection
-- (get_shop_reviews.buyer_display_name, get_conversation_context.
-- other_party_display_name, get_my_notifications.actor_display_name).
-- New fallback: signup-supplied metadata display_name if non-blank AND
-- within the new 50-char cap, otherwise literal 'Member' -- never the
-- email local-part again, and never a metadata value that could itself
-- violate profiles_display_name_length_check.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_policies_accepted boolean;
  v_now timestamptz;
begin
  v_display_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  if v_display_name = '' or char_length(v_display_name) > 50 then
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

-- ===================== 3B. existing-profile privacy backfill =====================
-- Narrowly scoped: only active (non-deleted) profiles whose CURRENT
-- display_name exactly equals the local-part of that SAME auth user's
-- own email are renamed to 'Member'. Any profile whose display_name
-- already differs from its own email local-part is left untouched (it
-- may already be a deliberately chosen name), and anonymized profiles
-- are never touched (their display_name is already 'Deleted user').
-- No row-level value is selected/printed by this statement -- it is a
-- plain UPDATE with no RETURNING clause.

update public.profiles as p
set display_name = 'Member'
from auth.users as u
where u.id = p.id
  and p.deleted_at is null
  and u.email is not null
  and position('@' in u.email) > 1
  and lower(btrim(p.display_name)) = lower(split_part(u.email, '@', 1));

-- ===================== 4. get_my_profile(): owner-only private profile read =====================

create or replace function public.get_my_profile()
returns table (
  id uuid,
  display_name text,
  avatar_storage_path text,
  first_name text,
  last_name text,
  bio text,
  mobile_number text,
  province_id integer,
  city_id integer,
  barangay_id integer,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  return query
    select
      p.id,
      p.display_name,
      p.avatar_storage_path,
      p.first_name,
      p.last_name,
      p.bio,
      p.mobile_number,
      p.province_id,
      p.city_id,
      p.barangay_id,
      p.deleted_at,
      p.created_at,
      p.updated_at
    from public.profiles p
    where p.id = v_caller;
end;
$$;

revoke all on function public.get_my_profile() from public;
revoke all on function public.get_my_profile() from anon;
grant execute on function public.get_my_profile() to authenticated;

-- ===================== 5. update_my_profile(...): owner-only private profile write =====================
-- No target-user-id parameter anywhere -- the caller is always
-- auth.uid(). Validation/error-code style mirrors update_shop
-- (0043_shop_management_rpcs.sql) exactly: nullif(btrim(...), '') blank
-- normalization, char_length caps, EXISTS-based location-hierarchy
-- checks, and a path-prefix check for the avatar analogous to
-- update_shop's own v_logo_storage_path guard.

create or replace function public.update_my_profile(
  p_display_name text,
  p_avatar_storage_path text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_bio text default null,
  p_mobile_number text default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null
)
returns table (updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
  v_current_display_name text;
  v_current_avatar_storage_path text;
  v_current_bio text;
  v_display_name text;
  v_first_name text;
  v_last_name text;
  v_bio text;
  v_mobile_number text;
  v_avatar_storage_path text;
  v_public_restricted boolean;
  v_now timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock the caller's own profile row; deleted/anonymized: reject all mutation =====================
  select p.deleted_at, p.display_name, p.avatar_storage_path, p.bio
    into v_deleted_at, v_current_display_name, v_current_avatar_storage_path, v_current_bio
    from public.profiles p
    where p.id = v_caller
    for update;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== display_name: required, non-blank, capped =====================
  v_display_name := nullif(btrim(p_display_name), '');
  if v_display_name is null then
    raise exception 'Display name is required.' using detail = 'DISPLAY_NAME_REQUIRED';
  end if;
  if char_length(v_display_name) > 50 then
    raise exception 'Display name is too long.' using detail = 'DISPLAY_NAME_TOO_LONG';
  end if;

  -- ===================== first_name / last_name: optional, blank -> null, capped =====================
  v_first_name := nullif(btrim(p_first_name), '');
  if v_first_name is not null and char_length(v_first_name) > 50 then
    raise exception 'First name is too long.' using detail = 'FIRST_NAME_TOO_LONG';
  end if;

  v_last_name := nullif(btrim(p_last_name), '');
  if v_last_name is not null and char_length(v_last_name) > 50 then
    raise exception 'Last name is too long.' using detail = 'LAST_NAME_TOO_LONG';
  end if;

  -- ===================== bio: optional, blank -> null, capped =====================
  v_bio := nullif(btrim(p_bio), '');
  if v_bio is not null and char_length(v_bio) > 300 then
    raise exception 'Bio is too long.' using detail = 'BIO_TOO_LONG';
  end if;

  -- ===================== mobile_number: optional, normalized, never Auth phone =====================
  -- PH local format (09XXXXXXXXX) is normalized to +639XXXXXXXXX; an
  -- already-E.164-shaped value is preserved as-is once validated. No
  -- external phone-parsing library and no country-specific parsing
  -- beyond this one PH shortcut, per instruction. Final stored value
  -- (in either case) must satisfy ^\+[1-9][0-9]{7,14}$ -- E.164 is at
  -- most 15 digits including the country code, plus a leading '+'.
  v_mobile_number := nullif(btrim(p_mobile_number), '');
  if v_mobile_number is not null then
    if v_mobile_number ~ '^09[0-9]{9}$' then
      v_mobile_number := '+63' || substring(v_mobile_number from 2);
    end if;

    if v_mobile_number !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'Please enter a valid mobile number.' using detail = 'MOBILE_NUMBER_INVALID';
    end if;
  end if;

  -- ===================== avatar path: null, or must belong to the caller =====================
  -- Storage RLS also enforces this at the object level, but this check
  -- is still required here -- a caller could otherwise claim an
  -- already-public path belonging to someone else's avatar object as
  -- their own profiles row, even though storage RLS would separately
  -- block them from ever writing to that path themselves.
  v_avatar_storage_path := nullif(btrim(p_avatar_storage_path), '');
  if v_avatar_storage_path is not null and v_avatar_storage_path !~ ('^avatar-images/' || v_caller::text || '/') then
    raise exception 'Invalid profile photo.' using detail = 'INVALID_AVATAR_PATH';
  end if;

  -- ===================== location hierarchy: province -> city -> optional barangay =====================
  -- Same proven pattern as update_shop (0043) / create_listing --
  -- province may be null; city requires province; barangay requires
  -- city; each child must actually belong to its stated parent.
  if p_city_id is not null and p_province_id is null then
    raise exception 'Province is required when a city is selected.' using detail = 'PROVINCE_REQUIRED';
  end if;

  if p_barangay_id is not null and p_city_id is null then
    raise exception 'City/municipality is required when a barangay is selected.' using detail = 'CITY_REQUIRED';
  end if;

  if p_city_id is not null and not exists (
    select 1 from public.cities_municipalities c
    where c.id = p_city_id and c.province_id = p_province_id
  ) then
    raise exception 'Selected city does not belong to the selected province.' using detail = 'INVALID_CITY_FOR_PROVINCE';
  end if;

  if p_barangay_id is not null and not exists (
    select 1 from public.barangays b
    where b.id = p_barangay_id and b.city_id = p_city_id
  ) then
    raise exception 'Selected barangay does not belong to the selected city.' using detail = 'INVALID_BARANGAY_FOR_CITY';
  end if;

  -- ===================== suspension gate: public identity fields locked only while ACTUALLY changing =====================
  -- buyer_restricted alone never blocks profile editing. A
  -- seller_suspended/account_suspended caller may still edit every
  -- PRIVATE field freely; only an actual attempted CHANGE to
  -- display_name/avatar_storage_path/bio is rejected -- resubmitting
  -- the same current values (e.g. a form that always sends every field)
  -- must not be treated as an edit attempt.
  select exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) into v_public_restricted;

  if v_public_restricted and (
    v_display_name is distinct from v_current_display_name
    or v_avatar_storage_path is distinct from v_current_avatar_storage_path
    or v_bio is distinct from v_current_bio
  ) then
    raise exception 'Your public profile can''t be changed while your account is under review.' using detail = 'PUBLIC_PROFILE_LOCKED';
  end if;

  v_now := now();

  -- updated_at is not set explicitly -- the existing set_updated_at
  -- (moddatetime) trigger on profiles already stamps it on every UPDATE,
  -- exactly like update_shop relies on the same trigger for shops.
  update public.profiles
    set display_name = v_display_name,
        avatar_storage_path = v_avatar_storage_path,
        first_name = v_first_name,
        last_name = v_last_name,
        bio = v_bio,
        mobile_number = v_mobile_number,
        province_id = p_province_id,
        city_id = p_city_id,
        barangay_id = p_barangay_id
    where id = v_caller;

  return query select v_now;
end;
$$;

revoke all on function public.update_my_profile(text, text, text, text, text, text, integer, integer, integer) from public;
revoke all on function public.update_my_profile(text, text, text, text, text, text, integer, integer, integer) from anon;
grant execute on function public.update_my_profile(text, text, text, text, text, text, integer, integer, integer) to authenticated;

-- ===================== 6. anonymize_user_account: extend to null the new fields =====================
-- Everything else (deleted_at/restriction/messenger_link/role/audit
-- behavior, admin authorization, last-super-admin protection) is
-- byte-for-byte unchanged from the live definition -- only the profile
-- UPDATE's SET list gains the four new columns.

create or replace function public.anonymize_user_account(p_user_id uuid, p_reason text)
returns table(user_id uuid, was_already_anonymized boolean, anonymized_at timestamp with time zone)
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

  -- ===================== anonymize public identity AND the newly-added private/public profile fields =====================
  update public.profiles
    set display_name = 'Deleted user',
        avatar_storage_path = null,
        first_name = null,
        last_name = null,
        bio = null,
        mobile_number = null,
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

-- ===================== 7. avatar-images storage bucket + policies =====================
-- New dedicated bucket -- never reuses listing-images/shop-images.
-- Public (avatars are shown in reviews/messaging exactly like today,
-- just user-controlled going forward), 3MB cap, same MIME allowlist as
-- the other public media buckets. Path convention:
-- avatar-images/{userId}/avatar/{randomUUID}.jpg -- ownership is the
-- first folder segment, exactly like listing-images/shop-images/
-- review-images already enforce.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatar-images', 'avatar-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy avatar_images_select_public
  on storage.objects for select
  using (bucket_id = 'avatar-images');

create policy avatar_images_insert_own
  on storage.objects for insert
  with check (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatar_images_update_own
  on storage.objects for update
  using (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatar_images_delete_own
  on storage.objects for delete
  using (
    bucket_id = 'avatar-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
