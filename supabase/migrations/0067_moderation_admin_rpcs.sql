-- Moderation / Reports / Admin: seven new SECURITY DEFINER RPCs against the
-- schema 0066 just created. No table/enum/column/index/RLS-policy change.
-- No existing function is touched except that this migration is what
-- finally *calls* recalculate_trusted_seller(shop_id) from a restriction
-- event -- recalculate_trusted_seller itself (0065) is not modified, only
-- invoked, exactly like complete_order/create_review/update_review already
-- invoke it internally today.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0066_moderation_schema (confirmed live via
-- list_migrations, no drift). reports/moderation_actions confirmed exactly
-- as 0066 left them, RLS confirmed enabled with zero policies on both
-- (queried live immediately before writing this file). recalculate_
-- trusted_seller(uuid) confirmed live and unchanged since 0065 (REVOKE ALL
-- FROM public/anon/authenticated, GRANT EXECUTE TO service_role only) --
-- this migration's two restriction RPCs can still call it internally for
-- the identical reason 0065's own header documents: both are SECURITY
-- DEFINER functions owned by the same role, so the call runs as that
-- shared owner regardless of the callee's own grants.
--
-- Admin authorization model -- defined exactly, nothing invented
-- -----------------------------------------------------------------------
-- PRD 4.4/4.5: Admin can manage Reports and Moderation actions (among
-- other things out of this task's scope); Super Admin can do everything
-- Admin can, plus manage admins, manage critical platform settings, and
-- "perform elevated administrative actions" -- canon never lists a single
-- moderation/report action that Super Admin can do and Admin cannot.
-- Every RPC below therefore treats 'admin' and 'super_admin' identically:
-- the check is "does a public.user_roles row exist for this caller at
-- all," never a role-specific branch. No super-admin-only behavior is
-- invented here. Admin role ASSIGNMENT ("manage admins," the one concrete
-- Super-Admin-specific power canon does name) is deliberately NOT
-- implemented in this migration -- it is a distinct capability from
-- report/restriction moderation, this task's own scope list never asks
-- for an admin-role-management RPC or UI, and bootstrapping the very
-- first admin account is an operational/ops action (a direct, deliberate
-- database write by whoever operates this project), not a client-facing
-- feature. Reported as a real, deliberate scope boundary, not an
-- oversight.
--
-- Reports: exactly the four canonical targets (0066's own header), one
-- submission RPC, three admin read/write RPCs
-- -----------------------------------------------------------------------
-- submit_report(p_target_type, p_target_id, p_reason, p_description):
-- authenticated only (PRD 31 implies reporting is a signed-in action, the
-- same as every other interpersonal-trust RPC in this schema -- reviews,
-- messages, favorites all require auth.uid()). Resolves p_target_id
-- against the correct table for p_target_type, raising a *_NOT_FOUND
-- code specific to that target when it does not exist, and rejects the
-- three self-report cases this task calls out explicitly: reporting your
-- own listing, your own shop, or your own review (SELF_REPORT_NOT_ALLOWED
-- in all three cases -- comparing the target's owning/authoring user id
-- against auth.uid(), never trusting a client-supplied "is this mine"
-- flag). A conversation report additionally requires the caller to
-- actually be one of that conversation's two participants
-- (NOT_CONVERSATION_PARTICIPANT otherwise) -- without this check, any
-- authenticated user could submit a report referencing a conversation id
-- they have no relationship to, which would both leak "this conversation
-- exists" and let a stranger fabricate reports the two real participants
-- never intended. Description is optional, capped at 1000 chars
-- (REPORT_DESCRIPTION_TOO_LONG), matching create_review's own established
-- body-length convention. No duplicate/rate-limit check is implemented:
-- canon (PRD 31) never defines one, so none is invented -- multiple
-- reports against the same target from different reporters are legitimate
-- triage signal for admin, not spam to be silently collapsed. The report
-- itself never mutates listing/shop/review/conversation state and never
-- applies a restriction -- "not itself automatically suspend someone
-- unless canon explicitly says so," and canon never says a report alone
-- triggers any restriction.
--
-- get_admin_reports / get_admin_report_detail: admin-only reads. The list
-- RPC returns a compact queue row per report (reporter display name --
-- never an email or raw id exposed as the primary label -- target type, a
-- single resolved display label, reason, status, created_at), cursor-
-- paginated on (created_at, id) DESC exactly like every other admin/seller
-- list RPC in this schema (get_my_shop_orders, get_my_shop_listings). The
-- detail RPC returns one wide row resolving whichever target type applies
-- (the other target-specific columns come back null) -- the same "wide
-- projection, nulls where not applicable" shape get_my_listing (0063)
-- already established for its own vehicle/rental columns -- including
-- each target's owning/authoring user id and display name, so the admin
-- UI can immediately offer a restriction control against the right person
-- without a second round trip. Both raise NOT_ADMIN for a non-admin
-- caller before touching any report row, so an ordinary user gets zero
-- report data back under any circumstance, not merely a filtered result.
--
-- resolve_admin_report(p_report_id, p_status, p_resolution_note): admin-
-- only write, moving a report from 'pending' to 'resolved' or 'dismissed'
-- ("Admin may: ... Resolve moderation cases," PRD 31). 'pending' is
-- rejected as a target status (TARGET_STATUS_NOT_ALLOWED) -- a report can
-- never be reopened through this RPC, matching this schema's own
-- established "structurally invalid target rejected before any lock"
-- pattern (update_listing_status's identical TARGET_STATUS_NOT_ALLOWED for
-- 'draft'/'reserved'). Idempotent: requesting the report's current status
-- again is a safe no-op. This RPC never itself applies or lifts a
-- restriction -- resolving a report and acting on its target are two
-- independent admin decisions, made through two independent RPCs, exactly
-- like this task's own instruction that a report must not itself
-- automatically suspend anyone.
--
-- Restrictions: safe admin-controlled apply/lift of the three existing
-- restriction_type_enum values, with the Trusted Seller hook this task
-- exists to close
-- -----------------------------------------------------------------------
-- apply_user_restriction(p_user_id, p_restriction_type, p_reason):
-- admin-only write. Locks the target profile row FOR UPDATE first (the
-- universal serialization point for every restriction change against this
-- user, so two concurrent apply/lift calls for the same user cannot
-- race), then checks for an already-active row of the exact same
-- restriction_type -- if one exists, returns success with
-- was_already_active = true and writes nothing else (idempotent, matching
-- update_listing_status's/accept_seller_policies' own established
-- convention). Otherwise inserts a new user_restrictions row (issued_by =
-- caller; the table's own existing NOT NULL + non-blank CHECK on `reason`,
-- 0004, already makes a reason structurally mandatory here -- this RPC
-- re-validates it explicitly first for a friendlier REASON_REQUIRED code,
-- the same "explicit check as a friendly backstop to the real constraint"
-- convention used everywhere else in this schema) and exactly one
-- moderation_actions row (action_type = 'restriction_applied'). Trusted
-- Seller hook: only when p_restriction_type is 'seller_suspended' or
-- 'account_suspended' (never 'buyer_restricted' -- Trusted Seller's own
-- criteria, PRD 27.2 as implemented by 0065, has nothing to do with a
-- user's buyer-side standing) does this RPC look up the target user's
-- shop (shops.owner_id = p_user_id) and, if one exists, call
-- recalculate_trusted_seller(shop_id) -- closing exactly the coverage gap
-- 0065's own header reported ("no RPC anywhere writes user_restrictions...
-- when a future admin-restriction RPC... is built, invoking
-- recalculate_trusted_seller(shop_id) from it is the correct extension
-- point").
--
-- lift_user_restriction(p_restriction_id, p_note): admin-only write.
-- Locks the specific user_restrictions row FOR UPDATE by its own id (the
-- natural, precise serialization point for a lift, since it targets one
-- exact historical row rather than "whichever is currently active").
-- Idempotent: a row whose lifted_at is already set returns success with
-- was_already_lifted = true and writes nothing else. Otherwise sets
-- lifted_at/lifted_by on that exact row (the row itself is never deleted
-- or otherwise mutated -- reason/issued_by/created_at stay exactly as
-- they were, preserving the original record) and inserts one moderation_
-- actions row (action_type = 'restriction_lifted'). p_note is optional --
-- canon never states a reason is required to restore privileges (PRD
-- 33.4: "Admin may: Restore privileges, Keep suspension," with no mention
-- of justification for either), unlike applying a restriction, where the
-- reason is canon-and-schema-mandatory. Same Trusted Seller hook as
-- apply_user_restriction, gated on the exact restriction_type that was
-- just lifted (read from the locked row itself, never re-derived from
-- client input).
--
-- get_admin_user_restrictions(p_user_id): admin-only read of one user's
-- complete restriction history (current and historical, newest first) --
-- what the admin UI needs to decide whether to apply a new restriction or
-- lift an existing one, and to show "why was this person restricted" with
-- both the issuing and lifting admin's display name.
--
-- Security: every function here is SECURITY DEFINER, SET search_path =
-- '', every table reference fully schema-qualified, every column alias-
-- qualified. Every admin-only RPC raises NOT_AUTHENTICATED then NOT_ADMIN
-- before touching a single row of application data -- the admin check is
-- always `exists (select 1 from public.user_roles where user_id =
-- auth.uid())`, read from the trusted user_roles table itself, never a
-- client-supplied role claim of any kind (no p_role/p_is_admin parameter
-- exists anywhere in this file). Every RPC in this file, including the
-- six admin-only ones, is GRANT EXECUTE TO authenticated (the same
-- posture create_review/update_review/publish_listing already use) --
-- reachability alone never implies authorization; each admin RPC's own
-- role check inside its body is what actually gates it, never SECURITY
-- INVOKER and never a table-level RLS policy standing in for that check
-- -- doing the authorization in application code, against trusted
-- server-side state, exactly as this task requires ("Never trust client-
-- supplied admin role"). No RPC in this file ever returns a reporter's
-- email or any other private contact information -- only display_name
-- (already this schema's universal safe-to-show identity field) is ever
-- projected for
-- a reporter, a target's owner, or an admin actor.

-- ============================================================
-- submit_report
-- ============================================================
create or replace function public.submit_report(
  p_target_type public.report_target_type_enum,
  p_target_id uuid,
  p_reason public.report_reason_enum,
  p_description text default null
)
returns table (
  report_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_description text;
  v_listing_id uuid;
  v_shop_id uuid;
  v_review_id uuid;
  v_conversation_id uuid;
  v_lookup_shop_id uuid;
  v_owner_id uuid;
  v_buyer_id uuid;
  v_report_id uuid;
  v_created_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot submit reports.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if p_target_id is null then
    raise exception 'A report target is required.' using detail = 'TARGET_TYPE_INVALID';
  end if;

  -- ===================== description normalization/length (identical to create_review's own convention) =====================
  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Description is too long.' using detail = 'REPORT_DESCRIPTION_TOO_LONG';
  end if;

  -- ===================== resolve target, validate existence, reject self-report / non-participant cases =====================
  if p_target_type = 'listing' then
    select l.shop_id into v_lookup_shop_id
      from public.listings l
      where l.id = p_target_id;

    if not found then
      raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
    end if;

    select s.owner_id into v_owner_id from public.shops s where s.id = v_lookup_shop_id;

    if v_owner_id = v_caller then
      raise exception 'You cannot report your own listing.' using detail = 'SELF_REPORT_NOT_ALLOWED';
    end if;

    v_listing_id := p_target_id;

  elsif p_target_type = 'shop' then
    select s.owner_id into v_owner_id
      from public.shops s
      where s.id = p_target_id;

    if not found then
      raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
    end if;

    if v_owner_id = v_caller then
      raise exception 'You cannot report your own shop.' using detail = 'SELF_REPORT_NOT_ALLOWED';
    end if;

    v_shop_id := p_target_id;

  elsif p_target_type = 'review' then
    select r.buyer_id into v_buyer_id
      from public.reviews r
      where r.id = p_target_id;

    if not found then
      raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
    end if;

    if v_buyer_id = v_caller then
      raise exception 'You cannot report your own review.' using detail = 'SELF_REPORT_NOT_ALLOWED';
    end if;

    v_review_id := p_target_id;

  elsif p_target_type = 'conversation' then
    select c.initiator_id, c.shop_id into v_buyer_id, v_lookup_shop_id
      from public.conversations c
      where c.id = p_target_id;

    if not found then
      raise exception 'Conversation not found.' using detail = 'CONVERSATION_NOT_FOUND';
    end if;

    select s.owner_id into v_owner_id from public.shops s where s.id = v_lookup_shop_id;

    if v_caller <> v_buyer_id and v_caller <> v_owner_id then
      raise exception 'You are not a participant in this conversation.' using detail = 'NOT_CONVERSATION_PARTICIPANT';
    end if;

    v_conversation_id := p_target_id;

  else
    raise exception 'Unsupported report target.' using detail = 'TARGET_TYPE_INVALID';
  end if;

  -- ===================== insert the immutable report record =====================
  insert into public.reports (reporter_id, target_type, listing_id, shop_id, review_id, conversation_id, reason, description)
    values (v_caller, p_target_type, v_listing_id, v_shop_id, v_review_id, v_conversation_id, p_reason, v_description)
    returning id, created_at into v_report_id, v_created_at;

  return query
    select v_report_id, v_created_at;
end;
$$;

revoke all on function public.submit_report(public.report_target_type_enum, uuid, public.report_reason_enum, text) from public;
revoke all on function public.submit_report(public.report_target_type_enum, uuid, public.report_reason_enum, text) from anon;
grant execute on function public.submit_report(public.report_target_type_enum, uuid, public.report_reason_enum, text) to authenticated;

-- ============================================================
-- get_admin_reports
-- ============================================================
create or replace function public.get_admin_reports(
  p_status public.report_status_enum default null,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  report_id uuid,
  target_type public.report_target_type_enum,
  target_label text,
  reason public.report_reason_enum,
  status public.report_status_enum,
  reporter_display_name text,
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

  -- ===================== pagination validation =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    select
      r.id as report_id,
      r.target_type,
      coalesce(l.title, s.name, rev_s.name, conv_s.name) as target_label,
      r.reason,
      r.status,
      rp.display_name as reporter_display_name,
      r.created_at
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_id
    left join public.listings l on l.id = r.listing_id
    left join public.shops s on s.id = r.shop_id
    left join public.reviews rev on rev.id = r.review_id
    left join public.shops rev_s on rev_s.id = rev.shop_id
    left join public.conversations conv on conv.id = r.conversation_id
    left join public.shops conv_s on conv_s.id = conv.shop_id
    where (p_status is null or r.status = p_status)
      and (
        p_before_created_at is null
        or (r.created_at, r.id) < (p_before_created_at, p_before_id)
      )
    order by r.created_at desc, r.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_admin_reports(public.report_status_enum, integer, timestamptz, uuid) from public;
revoke all on function public.get_admin_reports(public.report_status_enum, integer, timestamptz, uuid) from anon;
grant execute on function public.get_admin_reports(public.report_status_enum, integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_admin_report_detail
-- ============================================================
create or replace function public.get_admin_report_detail(
  p_report_id uuid
)
returns table (
  report_id uuid,
  target_type public.report_target_type_enum,
  reason public.report_reason_enum,
  description text,
  status public.report_status_enum,
  created_at timestamptz,
  reporter_id uuid,
  reporter_display_name text,
  resolved_by uuid,
  resolved_by_display_name text,
  resolved_at timestamptz,
  resolution_note text,
  listing_id uuid,
  listing_title text,
  listing_shop_id uuid,
  listing_shop_owner_id uuid,
  listing_shop_owner_display_name text,
  shop_id uuid,
  shop_name text,
  shop_owner_id uuid,
  shop_owner_display_name text,
  review_id uuid,
  review_rating smallint,
  review_body text,
  review_author_id uuid,
  review_author_display_name text,
  conversation_id uuid,
  conversation_buyer_id uuid,
  conversation_buyer_display_name text,
  conversation_shop_id uuid,
  conversation_shop_owner_id uuid,
  conversation_shop_owner_display_name text,
  conversation_shop_name text
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

  if not exists (select 1 from public.reports r where r.id = p_report_id) then
    raise exception 'Report not found.' using detail = 'REPORT_NOT_FOUND';
  end if;

  return query
    select
      r.id as report_id,
      r.target_type,
      r.reason,
      r.description,
      r.status,
      r.created_at,
      r.reporter_id,
      rp.display_name as reporter_display_name,
      r.resolved_by,
      resp.display_name as resolved_by_display_name,
      r.resolved_at,
      r.resolution_note,
      r.listing_id,
      l.title as listing_title,
      l.shop_id as listing_shop_id,
      ls.owner_id as listing_shop_owner_id,
      lso.display_name as listing_shop_owner_display_name,
      r.shop_id,
      s.name as shop_name,
      s.owner_id as shop_owner_id,
      so.display_name as shop_owner_display_name,
      r.review_id,
      rev.rating as review_rating,
      rev.body as review_body,
      rev.buyer_id as review_author_id,
      revp.display_name as review_author_display_name,
      r.conversation_id,
      conv.initiator_id as conversation_buyer_id,
      convp.display_name as conversation_buyer_display_name,
      conv.shop_id as conversation_shop_id,
      cs.owner_id as conversation_shop_owner_id,
      cso.display_name as conversation_shop_owner_display_name,
      cs.name as conversation_shop_name
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles resp on resp.id = r.resolved_by
    left join public.listings l on l.id = r.listing_id
    left join public.shops ls on ls.id = l.shop_id
    left join public.profiles lso on lso.id = ls.owner_id
    left join public.shops s on s.id = r.shop_id
    left join public.profiles so on so.id = s.owner_id
    left join public.reviews rev on rev.id = r.review_id
    left join public.profiles revp on revp.id = rev.buyer_id
    left join public.conversations conv on conv.id = r.conversation_id
    left join public.profiles convp on convp.id = conv.initiator_id
    left join public.shops cs on cs.id = conv.shop_id
    left join public.profiles cso on cso.id = cs.owner_id
    where r.id = p_report_id;
end;
$$;

revoke all on function public.get_admin_report_detail(uuid) from public;
revoke all on function public.get_admin_report_detail(uuid) from anon;
grant execute on function public.get_admin_report_detail(uuid) to authenticated;

-- ============================================================
-- resolve_admin_report
-- ============================================================
create or replace function public.resolve_admin_report(
  p_report_id uuid,
  p_status public.report_status_enum,
  p_resolution_note text default null
)
returns table (
  report_id uuid,
  status public.report_status_enum,
  was_already_in_status boolean,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_current_status public.report_status_enum;
  v_current_resolved_at timestamptz;
  v_note text;
  v_resolved_at timestamptz;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  -- ===================== structural input validation: a report can never be reopened through this RPC =====================
  if p_status is null or p_status = 'pending' then
    raise exception 'That status cannot be set directly.' using detail = 'TARGET_STATUS_NOT_ALLOWED';
  end if;

  -- ===================== lock the report row (universal serialization point) =====================
  select r.status, r.resolved_at into v_current_status, v_current_resolved_at
    from public.reports r
    where r.id = p_report_id
    for update;

  if not found then
    raise exception 'Report not found.' using detail = 'REPORT_NOT_FOUND';
  end if;

  -- ===================== idempotent: requesting the current status is a safe no-op =====================
  if v_current_status = p_status then
    return query
      select p_report_id, v_current_status, true, v_current_resolved_at;
    return;
  end if;

  v_note := nullif(btrim(p_resolution_note), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Resolution note is too long.' using detail = 'RESOLUTION_NOTE_TOO_LONG';
  end if;

  v_resolved_at := now();

  update public.reports as r
    set status = p_status,
        resolved_by = v_caller,
        resolved_at = v_resolved_at,
        resolution_note = v_note
    where r.id = p_report_id;

  return query
    select p_report_id, p_status, false, v_resolved_at;
end;
$$;

revoke all on function public.resolve_admin_report(uuid, public.report_status_enum, text) from public;
revoke all on function public.resolve_admin_report(uuid, public.report_status_enum, text) from anon;
grant execute on function public.resolve_admin_report(uuid, public.report_status_enum, text) to authenticated;

-- ============================================================
-- apply_user_restriction
-- ============================================================
create or replace function public.apply_user_restriction(
  p_user_id uuid,
  p_restriction_type public.restriction_type_enum,
  p_reason text
)
returns table (
  restriction_id uuid,
  user_id uuid,
  restriction_type public.restriction_type_enum,
  was_already_active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_reason text;
  v_existing_id uuid;
  v_existing_created_at timestamptz;
  v_new_id uuid;
  v_new_created_at timestamptz;
  v_shop_id uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  if p_restriction_type is null then
    raise exception 'A restriction type is required.' using detail = 'RESTRICTION_TYPE_REQUIRED';
  end if;

  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A reason is required.' using detail = 'REASON_REQUIRED';
  end if;

  -- ===================== lock the target profile row (universal serialization point for this user's restriction state) =====================
  perform 1 from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using detail = 'USER_NOT_FOUND';
  end if;

  -- ===================== idempotent: an already-active restriction of this exact type is a safe no-op =====================
  select ur.id, ur.created_at into v_existing_id, v_existing_created_at
    from public.user_restrictions ur
    where ur.user_id = p_user_id
      and ur.restriction_type = p_restriction_type
      and ur.lifted_at is null
    order by ur.created_at desc
    limit 1;

  if found then
    return query
      select v_existing_id, p_user_id, p_restriction_type, true, v_existing_created_at;
    return;
  end if;

  -- ===================== insert the new restriction row (issued_by = caller, never client-supplied) =====================
  insert into public.user_restrictions (user_id, restriction_type, reason, issued_by)
    values (p_user_id, p_restriction_type, v_reason, v_caller)
    returning id, created_at into v_new_id, v_new_created_at;

  -- ===================== dedicated audit trail row (see 0066's own header for why this is separate from user_restrictions) =====================
  insert into public.moderation_actions (admin_id, action_type, target_user_id, restriction_type, restriction_id, reason)
    values (v_caller, 'restriction_applied', p_user_id, p_restriction_type, v_new_id, v_reason);

  -- ===================== Trusted Seller hook: only seller_suspended/account_suspended can ever affect trust =====================
  if p_restriction_type in ('seller_suspended', 'account_suspended') then
    select s.id into v_shop_id from public.shops s where s.owner_id = p_user_id;
    if found then
      perform public.recalculate_trusted_seller(v_shop_id);
    end if;
  end if;

  return query
    select v_new_id, p_user_id, p_restriction_type, false, v_new_created_at;
end;
$$;

revoke all on function public.apply_user_restriction(uuid, public.restriction_type_enum, text) from public;
revoke all on function public.apply_user_restriction(uuid, public.restriction_type_enum, text) from anon;
grant execute on function public.apply_user_restriction(uuid, public.restriction_type_enum, text) to authenticated;

-- ============================================================
-- lift_user_restriction
-- ============================================================
create or replace function public.lift_user_restriction(
  p_restriction_id uuid,
  p_note text default null
)
returns table (
  restriction_id uuid,
  user_id uuid,
  restriction_type public.restriction_type_enum,
  was_already_lifted boolean,
  lifted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_user_id uuid;
  v_restriction_type public.restriction_type_enum;
  v_existing_lifted_at timestamptz;
  v_note text;
  v_lifted_at timestamptz;
  v_shop_id uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  -- ===================== lock the specific restriction row (universal serialization point) =====================
  select ur.user_id, ur.restriction_type, ur.lifted_at
    into v_user_id, v_restriction_type, v_existing_lifted_at
    from public.user_restrictions ur
    where ur.id = p_restriction_id
    for update;

  if not found then
    raise exception 'Restriction not found.' using detail = 'RESTRICTION_NOT_FOUND';
  end if;

  -- ===================== idempotent: an already-lifted row is a safe no-op =====================
  if v_existing_lifted_at is not null then
    return query
      select p_restriction_id, v_user_id, v_restriction_type, true, v_existing_lifted_at;
    return;
  end if;

  v_note := nullif(btrim(p_note), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Note is too long.' using detail = 'RESOLUTION_NOTE_TOO_LONG';
  end if;

  v_lifted_at := now();

  -- ===================== lift: only lifted_at/lifted_by are ever written; the original record is preserved verbatim =====================
  update public.user_restrictions as ur
    set lifted_at = v_lifted_at,
        lifted_by = v_caller
    where ur.id = p_restriction_id;

  insert into public.moderation_actions (admin_id, action_type, target_user_id, restriction_type, restriction_id, reason)
    values (v_caller, 'restriction_lifted', v_user_id, v_restriction_type, p_restriction_id, v_note);

  -- ===================== Trusted Seller hook: only seller_suspended/account_suspended can ever affect trust =====================
  if v_restriction_type in ('seller_suspended', 'account_suspended') then
    select s.id into v_shop_id from public.shops s where s.owner_id = v_user_id;
    if found then
      perform public.recalculate_trusted_seller(v_shop_id);
    end if;
  end if;

  return query
    select p_restriction_id, v_user_id, v_restriction_type, false, v_lifted_at;
end;
$$;

revoke all on function public.lift_user_restriction(uuid, text) from public;
revoke all on function public.lift_user_restriction(uuid, text) from anon;
grant execute on function public.lift_user_restriction(uuid, text) to authenticated;

-- ============================================================
-- get_admin_user_restrictions
-- ============================================================
create or replace function public.get_admin_user_restrictions(
  p_user_id uuid
)
returns table (
  restriction_id uuid,
  restriction_type public.restriction_type_enum,
  reason text,
  issued_by uuid,
  issued_by_display_name text,
  created_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  lifted_by_display_name text
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

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'User not found.' using detail = 'USER_NOT_FOUND';
  end if;

  return query
    select
      ur.id as restriction_id,
      ur.restriction_type,
      ur.reason,
      ur.issued_by,
      ip.display_name as issued_by_display_name,
      ur.created_at,
      ur.lifted_at,
      ur.lifted_by,
      lp.display_name as lifted_by_display_name
    from public.user_restrictions ur
    join public.profiles ip on ip.id = ur.issued_by
    left join public.profiles lp on lp.id = ur.lifted_by
    where ur.user_id = p_user_id
    order by ur.created_at desc;
end;
$$;

revoke all on function public.get_admin_user_restrictions(uuid) from public;
revoke all on function public.get_admin_user_restrictions(uuid) from anon;
grant execute on function public.get_admin_user_restrictions(uuid) to authenticated;
