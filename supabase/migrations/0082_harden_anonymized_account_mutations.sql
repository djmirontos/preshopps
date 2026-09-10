-- Anonymized-account enforcement hardening (launch blocker fix), per the
-- read-only audit accepted immediately before this migration: 17 mutation
-- RPCs were found to enforce caller eligibility via NEITHER
-- profiles.deleted_at (category D) NOR anything at all beyond
-- account_suspended (category B, which reopens the instant that
-- restriction is lifted). This migration adds a direct, permanent
-- profiles.deleted_at guard to all 17, plus a narrow defense-in-depth
-- guard on lift_user_restriction itself.
--
-- Pre-inspection: migration history ends at 0081_account_anonymization_
-- rpc (confirmed live, no drift). All 18 functions touched here were
-- re-fetched via live pg_get_functiondef immediately before writing this
-- migration (not from local files, several of which are stale relative
-- to later widening migrations -- e.g. create_shop's live signature
-- includes p_slug, added by 0050, absent from 0049's own local file) --
-- every diff below is against that confirmed live body, not a guess.
-- Grants for all 18 confirmed live and uniform: anon=false,
-- authenticated=true, public=false.
--
-- The guard, inserted identically in all 17 mutation RPCs
-- -----------------------------------------------------------------------
-- Immediately after each function's existing `if v_caller is null then
-- raise ... NOT_AUTHENTICATED` block (the same position this schema's own
-- established convention already uses everywhere this check exists --
-- "profiles.deleted_at is checked immediately after authentication"),
-- before any other logic:
--
--   select p.deleted_at into v_caller_deleted_at
--     from public.profiles p
--     where p.id = v_caller;
--
--   if not found or v_caller_deleted_at is not null then
--     raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
--   end if;
--
-- INTERACTION_BLOCKED is the exact, already-established error code this
-- entire schema uses for this exact condition (create_dispute,
-- submit_support_ticket, submit_cart_order, create_review, start_
-- conversation, send_message, block_user, cart/favorites RPCs, and more
-- all already raise it identically) -- reused verbatim, not invented.
-- `not found` (no profiles row at all) is included only for the same
-- defensive-parity reason every other instance of this check already
-- includes it, even though it is not reachable in practice (every
-- auth.uid() has a profiles row via handle_new_user, and profiles are
-- never hard-deleted). One new declared variable, v_caller_deleted_at
-- timestamptz, is added to each function's declare block. Nothing else
-- in any of these 17 functions is touched: same signature, same
-- SECURITY DEFINER, same search_path = '', same validation, same status
-- transitions, same notifications, same history writes, same return
-- shape, same grants. 0076's create_dispute image-path logic is a
-- different function entirely and is not touched here.
--
-- Why this is the correct, durable fix (not merely "prevent restriction
-- lift")
-- -----------------------------------------------------------------------
-- profiles.deleted_at is permanent -- no RPC in this schema (including
-- anonymize_user_account, 0081) ever clears it. Placing the guard
-- directly in each mutating RPC means the invariant holds regardless of
-- user_restrictions state entirely -- whether account_suspended was ever
-- applied, is currently active, or is later lifted (by design or by
-- mistake) has zero bearing on whether an anonymized caller can mutate
-- anything. This directly satisfies this task's own instruction: "Do not
-- rely only on preventing restriction lift. The durable invariant must
-- live in the mutating RPC itself."
--
-- Part 2 (category B listing RPCs): existing account_suspended checks
-- are left completely untouched, as explicit defense-in-depth
-- -----------------------------------------------------------------------
-- create_listing/update_listing/replace_listing_images/publish_listing/
-- update_listing_status already each check `restriction_type in
-- ('seller_suspended', 'account_suspended')` -- none of those lines are
-- modified, reordered, or removed. The new deleted_at guard is added as
-- an independent, earlier check (immediately after authentication, before
-- the existing shop-ownership/restriction checks) so an anonymized caller
-- is rejected before either of those two pre-existing checks even runs.
--
-- Part 3: lift_user_restriction -- narrow, targeted defense-in-depth
-- -----------------------------------------------------------------------
-- Only account_suspended is affected, and only when the specific
-- restriction row's own user_id has profiles.deleted_at set. seller_
-- suspended and buyer_restricted are never blocked by this new check --
-- this function's own existing semantics never conditioned lifting either
-- of those on anonymization, and nothing about anonymization requires
-- blocking them: a lifted seller_suspended/buyer_restricted row on an
-- already-anonymized account has no practical effect anyway, since
-- deleted_at itself (via the 17 guards above) already blocks every
-- marketplace mutation regardless of restriction state. The check is
-- placed after the existing already-lifted idempotency branch (a
-- no-op return needs no new gate) and before the note-length validation
-- (no reason to validate a note for an action about to be rejected).
-- TARGET_ACCOUNT_ANONYMIZED is a new, dedicated error code -- distinct
-- from INTERACTION_BLOCKED, since this is an admin-facing rejection of a
-- moderation action against a target, not a caller-eligibility gate.

-- ============================================================
-- create_shop
-- ============================================================
create or replace function public.create_shop(
  p_name text,
  p_description text default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_messenger_link text default null,
  p_logo_storage_path text default null,
  p_slug text default null
)
returns table (
  shop_id uuid,
  slug text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_name text;
  v_description text;
  v_messenger_link text;
  v_logo_storage_path text;
  v_requested_slug text;
  v_slug text;
  v_shop_id uuid;
  v_created_at timestamptz;
  v_constraint_name text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (select 1 from public.shops s where s.owner_id = v_caller) then
    raise exception 'You already have a shop.' using detail = 'SHOP_ALREADY_EXISTS';
  end if;

  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'Shop name is required.' using detail = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Shop name is too long.' using detail = 'NAME_TOO_LONG';
  end if;

  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Shop description is too long.' using detail = 'DESCRIPTION_TOO_LONG';
  end if;

  if p_province_id is null then
    raise exception 'Province is required.' using detail = 'PROVINCE_REQUIRED';
  end if;

  if p_city_id is null then
    raise exception 'City/municipality is required.' using detail = 'CITY_REQUIRED';
  end if;

  if not exists (
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

  v_messenger_link := nullif(btrim(p_messenger_link), '');
  if v_messenger_link is not null then
    if char_length(v_messenger_link) > 2048 then
      raise exception 'Messenger link is too long.' using detail = 'MESSENGER_LINK_TOO_LONG';
    end if;
    if v_messenger_link !~* '^https?://\S+$' then
      raise exception 'Messenger link must be a valid web address.' using detail = 'INVALID_MESSENGER_LINK';
    end if;
  end if;

  v_logo_storage_path := nullif(btrim(p_logo_storage_path), '');
  if v_logo_storage_path is not null and v_logo_storage_path !~ ('^shop-images/' || v_caller::text || '/') then
    raise exception 'Invalid logo image.' using detail = 'INVALID_LOGO_PATH';
  end if;

  v_requested_slug := nullif(btrim(p_slug), '');

  if v_requested_slug is not null then
    if v_requested_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'Shop URL must be lowercase letters, numbers, and hyphens only.' using detail = 'SLUG_INVALID';
    end if;

    if exists (select 1 from public.shop_slugs ss where ss.slug = v_requested_slug) then
      raise exception 'That shop URL is already taken.' using detail = 'SLUG_UNAVAILABLE';
    end if;

    v_slug := v_requested_slug;
  else
    v_slug := public.generate_unique_shop_slug(v_name);
  end if;

  v_created_at := now();

  begin
    insert into public.shops as s (
      owner_id, name, slug, description, logo_storage_path,
      province_id, city_id, barangay_id, messenger_link,
      created_at, updated_at
    )
    values (
      v_caller, v_name, v_slug, v_description, v_logo_storage_path,
      p_province_id, p_city_id, p_barangay_id, v_messenger_link,
      v_created_at, v_created_at
    )
    returning s.id into v_shop_id;

    insert into public.shop_slugs (slug, shop_id, is_current, created_at)
      values (v_slug, v_shop_id, true, v_created_at);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'shops_owner_id_key' then
        raise exception 'You already have a shop.' using detail = 'SHOP_ALREADY_EXISTS';
      else
        raise exception 'That shop URL is already taken.' using detail = 'SLUG_UNAVAILABLE';
      end if;
  end;

  return query
    select v_shop_id, v_slug, v_created_at;
end;
$$;

revoke all on function public.create_shop(text, text, integer, integer, integer, text, text, text) from public;
revoke all on function public.create_shop(text, text, integer, integer, integer, text, text, text) from anon;
grant execute on function public.create_shop(text, text, integer, integer, integer, text, text, text) to authenticated;

-- ============================================================
-- update_shop
-- ============================================================
create or replace function public.update_shop(
  p_name text,
  p_description text default null,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_messenger_link text default null,
  p_logo_storage_path text default null,
  p_status public.shop_status_enum default 'active'
)
returns table (
  shop_id uuid,
  slug text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_current_slug text;
  v_name text;
  v_description text;
  v_messenger_link text;
  v_logo_storage_path text;
  v_new_base text;
  v_current_base text;
  v_slug text;
  v_now timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  select s.id, s.slug into v_shop_id, v_current_slug
    from public.shops s
    where s.owner_id = v_caller
    for update;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'Shop name is required.' using detail = 'NAME_REQUIRED';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Shop name is too long.' using detail = 'NAME_TOO_LONG';
  end if;

  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'Shop description is too long.' using detail = 'DESCRIPTION_TOO_LONG';
  end if;

  if p_province_id is null then
    raise exception 'Province is required.' using detail = 'PROVINCE_REQUIRED';
  end if;

  if p_city_id is null then
    raise exception 'City/municipality is required.' using detail = 'CITY_REQUIRED';
  end if;

  if not exists (
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

  v_messenger_link := nullif(btrim(p_messenger_link), '');
  if v_messenger_link is not null then
    if char_length(v_messenger_link) > 2048 then
      raise exception 'Messenger link is too long.' using detail = 'MESSENGER_LINK_TOO_LONG';
    end if;
    if v_messenger_link !~* '^https?://\S+$' then
      raise exception 'Messenger link must be a valid web address.' using detail = 'INVALID_MESSENGER_LINK';
    end if;
  end if;

  v_logo_storage_path := nullif(btrim(p_logo_storage_path), '');
  if v_logo_storage_path is not null and v_logo_storage_path !~ ('^shop-images/' || v_caller::text || '/') then
    raise exception 'Invalid logo image.' using detail = 'INVALID_LOGO_PATH';
  end if;

  v_new_base := lower(regexp_replace(btrim(v_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_new_base := btrim(v_new_base, '-');
  v_current_base := regexp_replace(v_current_slug, '-[0-9]+$', '');

  if v_new_base <> '' and v_new_base is not null and v_new_base <> v_current_base then
    v_slug := public.generate_unique_shop_slug(v_name);
  else
    v_slug := v_current_slug;
  end if;

  v_now := now();

  if v_slug <> v_current_slug then
    update public.shop_slugs as ss set is_current = false where ss.shop_id = v_shop_id and ss.is_current;
    insert into public.shop_slugs (slug, shop_id, is_current, created_at)
      values (v_slug, v_shop_id, true, v_now);
  end if;

  update public.shops as s
    set name = v_name,
        slug = v_slug,
        description = v_description,
        logo_storage_path = v_logo_storage_path,
        province_id = p_province_id,
        city_id = p_city_id,
        barangay_id = p_barangay_id,
        messenger_link = v_messenger_link,
        status = p_status
    where s.id = v_shop_id;

  return query
    select v_shop_id, v_slug, v_now;
end;
$$;

revoke all on function public.update_shop(text, text, integer, integer, integer, text, text, public.shop_status_enum) from public;
revoke all on function public.update_shop(text, text, integer, integer, integer, text, text, public.shop_status_enum) from anon;
grant execute on function public.update_shop(text, text, integer, integer, integer, text, text, public.shop_status_enum) to authenticated;

-- ============================================================
-- accept_seller_policies
-- ============================================================
create or replace function public.accept_seller_policies()
returns table (
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_accepted_at timestamptz;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock the caller's own profile row (universal serialization point) =====================
  select p.seller_policies_accepted_at into v_accepted_at
    from public.profiles p
    where p.id = v_caller
    for update;

  if not found then
    raise exception 'Profile not found.' using detail = 'PROFILE_NOT_FOUND';
  end if;

  -- ===================== idempotent: set once, preserve the original timestamp thereafter =====================
  if v_accepted_at is null then
    v_accepted_at := now();

    update public.profiles as p
      set seller_policies_accepted_at = v_accepted_at
      where p.id = v_caller;
  end if;

  return query
    select v_accepted_at;
end;
$$;

revoke all on function public.accept_seller_policies() from public;
revoke all on function public.accept_seller_policies() from anon;
grant execute on function public.accept_seller_policies() to authenticated;

-- ============================================================
-- accept_order_items
-- ============================================================
create or replace function public.accept_order_items(p_order_id uuid, p_accepted_item_ids uuid[], p_declined_item_ids uuid[])
returns table (order_id uuid, order_status public.order_status_enum, was_already_processed boolean, accepted_item_ids uuid[], declined_item_ids uuid[], stock_conflict_item_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;

  v_accepted_ids uuid[];
  v_declined_ids uuid[];
  v_all_decided_ids uuid[];
  v_pending_ids uuid[];
  v_bad_ids uuid[];
  v_missing_ids uuid[];

  v_stock_conflict_ids uuid[] := '{}';
  v_final_accepted_ids uuid[];
  v_final_declined_ids uuid[];
  v_conflict_batch uuid[];

  v_ok_listing_ids uuid[] := '{}';
  v_ok_listing_qty integer[] := '{}';
  v_ok_listing_new_reserved integer[] := '{}';
  v_ok_listing_new_available integer[] := '{}';
  v_ok_listing_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_avail_qty integer;
  v_listing_status public.listing_status_enum;

  v_accepted_count integer;
  v_total_count integer;
  v_outcome_status public.order_status_enum;
  v_note text;

  v_derived_accepted uuid[];
  v_derived_declined uuid[];

  i integer;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.buyer_id
    into v_order_status, v_order_shop_id, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: only a pending order may be processed =====================
  if v_order_status <> 'pending' then
    select coalesce(array_agg(oi.id) filter (where oi.status = 'accepted'), '{}'),
           coalesce(array_agg(oi.id) filter (where oi.status = 'declined'), '{}')
      into v_derived_accepted, v_derived_declined
      from public.order_items oi
      where oi.order_id = p_order_id;

    return query
      select p_order_id, v_order_status, true, v_derived_accepted, v_derived_declined, '{}'::uuid[];
    return;
  end if;

  -- ===================== normalize input =====================
  v_accepted_ids := coalesce(p_accepted_item_ids, '{}');
  v_declined_ids := coalesce(p_declined_item_ids, '{}');

  if exists (select 1 from unnest(v_accepted_ids) u where u is null)
     or exists (select 1 from unnest(v_declined_ids) u where u is null) then
    raise exception 'Item decision arrays may not contain a null item id.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- duplicate ids within either array, or the same id in both arrays
  if (select count(*) from unnest(v_accepted_ids)) <> (select count(distinct u) from unnest(v_accepted_ids) u)
     or (select count(*) from unnest(v_declined_ids)) <> (select count(distinct u) from unnest(v_declined_ids) u)
     or exists (
       select 1 from unnest(v_accepted_ids) a join unnest(v_declined_ids) d on a = d
     ) then
    raise exception 'Duplicate or overlapping item decisions are not allowed.' using detail = 'DUPLICATE_ITEM_DECISION';
  end if;

  v_all_decided_ids := v_accepted_ids || v_declined_ids;

  -- ===================== lock this order's order_items rows =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  select coalesce(array_agg(oi.id order by oi.id), '{}') into v_pending_ids
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'pending';

  v_total_count := coalesce(array_length(v_pending_ids, 1), 0);
  if v_total_count = 0 then
    raise exception 'Order has no pending items to decide.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- every decided id must belong to this order
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    where not exists (
      select 1 from public.order_items oi where oi.id = x and oi.order_id = p_order_id
    );
  if v_bad_ids is not null then
    raise exception 'One or more item IDs do not belong to this order.' using detail = 'ITEM_NOT_IN_ORDER';
  end if;

  -- every decided id must currently be pending
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    join public.order_items oi on oi.id = x and oi.order_id = p_order_id
    where oi.status <> 'pending';
  if v_bad_ids is not null then
    raise exception 'One or more items have already been decided.' using detail = 'ITEM_ALREADY_DECIDED';
  end if;

  -- every pending item must receive an explicit decision (completeness rule)
  select array_agg(x) into v_missing_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_all_decided_ids));
  if v_missing_ids is not null then
    raise exception 'Every pending item must receive an explicit decision.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- ===================== stock-conflict items with a NULL listing_id =====================
  select array_agg(oi.id) into v_conflict_batch
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and oi.listing_id is null;
  if v_conflict_batch is not null then
    v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
  end if;

  -- ===================== lock referenced listings in deterministic order, classify =====================
  for v_listing_id, v_agg_qty in
    select oi.listing_id, sum(oi.quantity)::integer
      from public.order_items oi
      where oi.id = any(v_accepted_ids) and oi.listing_id is not null
      group by oi.listing_id
      order by oi.listing_id
  loop
    select l.stock_quantity, l.reserved_quantity, l.available_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_avail_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_id
      for update;

    if not found
       or v_listing_status in ('draft', 'archived', 'sold')
       or v_avail_qty < v_agg_qty then
      select array_agg(oi.id) into v_conflict_batch
        from public.order_items oi
        where oi.id = any(v_accepted_ids) and oi.listing_id = v_listing_id;
      v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
      continue;
    end if;

    v_ok_listing_ids := v_ok_listing_ids || v_listing_id;
    v_ok_listing_qty := v_ok_listing_qty || v_agg_qty;
    v_ok_listing_new_reserved := v_ok_listing_new_reserved || (v_reserved_qty + v_agg_qty);
    v_ok_listing_new_available := v_ok_listing_new_available || (v_avail_qty - v_agg_qty);
    v_ok_listing_status := v_ok_listing_status || v_listing_status;
  end loop;

  -- ===================== final item classification =====================
  select coalesce(array_agg(oi.id), '{}') into v_final_accepted_ids
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and not (oi.id = any(v_stock_conflict_ids));

  select coalesce(array_agg(x), '{}') into v_final_declined_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_final_accepted_ids));

  v_accepted_count := coalesce(array_length(v_final_accepted_ids, 1), 0);

  if v_accepted_count = v_total_count then
    v_outcome_status := 'accepted';
  elsif v_accepted_count = 0 then
    v_outcome_status := 'declined';
  else
    v_outcome_status := 'changes_pending';
  end if;

  v_note := case
    when coalesce(array_length(v_stock_conflict_ids, 1), 0) > 0
      then format('%s item(s) auto-declined due to insufficient stock or an unavailable listing.', array_length(v_stock_conflict_ids, 1))
    else null
  end;

  -- ===================== item status writes (all outcomes) =====================
  update public.order_items set status = 'accepted' where id = any(v_final_accepted_ids);
  update public.order_items set status = 'declined' where id = any(v_final_declined_ids);

  -- ===================== outcome-specific mutation =====================
  if v_outcome_status = 'accepted' then
    -- reservations first (the ledger is authoritative), then the cached aggregate
    insert into public.inventory_reservations (listing_id, order_id, order_item_id, shop_id, quantity)
      select oi.listing_id, p_order_id, oi.id, v_order_shop_id, oi.quantity
        from public.order_items oi
        where oi.id = any(v_final_accepted_ids);

    for i in 1 .. coalesce(array_length(v_ok_listing_ids, 1), 0) loop
      update public.listings
        set reserved_quantity = v_ok_listing_new_reserved[i],
            status = case
              when v_ok_listing_new_available[i] = 0 and v_ok_listing_status[i] in ('available', 'reserved')
                then 'reserved'::public.listing_status_enum
              else status
            end
        where id = v_ok_listing_ids[i];
    end loop;
  end if;

  -- (no listing/reservation mutation for 'declined' or 'changes_pending' outcomes)

  -- lifecycle timestamps: accepted_at is set only when this call's resolved
  -- outcome is 'accepted', declined_at only when it is 'declined'; the
  -- 'changes_pending' outcome touches neither (both CASE branches
  -- preserve the column's current value, a no-op for a pending-origin
  -- order where both are already NULL).
  update public.orders
    set status = v_outcome_status,
        accepted_at = case when v_outcome_status = 'accepted' then now() else accepted_at end,
        declined_at = case when v_outcome_status = 'declined' then now() else declined_at end
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'pending', v_outcome_status, v_caller, v_note);

  -- ===================== notification: buyer receives outcome-specific event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select
    v_order_buyer_id,
    case v_outcome_status
      when 'accepted' then 'order_accepted'::public.notification_type_enum
      when 'declined' then 'order_declined'::public.notification_type_enum
      else 'order_changes_pending'::public.notification_type_enum
    end,
    v_caller,
    p_order_id,
    p_order_id::text || ':' || v_outcome_status::text
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, v_outcome_status, false, v_final_accepted_ids, v_final_declined_ids, v_stock_conflict_ids;
end;
$$;

revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from public;
revoke all on function public.accept_order_items(uuid, uuid[], uuid[]) from anon;
grant execute on function public.accept_order_items(uuid, uuid[], uuid[]) to authenticated;

-- ============================================================
-- cancel_accepted_order
-- ============================================================
create or replace function public.cancel_accepted_order(p_order_id uuid, p_reason text)
returns table (order_id uuid, order_status public.order_status_enum, was_already_cancelled boolean, cancelled_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_existing_cancelled_at timestamptz;
  v_order_buyer_id uuid;
  v_reason text;
  v_req_id uuid;
  v_from_status public.order_status_enum;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_available integer[] := '{}';
  v_old_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;

  i integer;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.cancelled_at, o.buyer_id
    into v_order_status, v_order_shop_id, v_existing_cancelled_at, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-cancelled is success, zero mutation, origin-agnostic =====================
  if v_order_status = 'cancelled' then
    return query
      select p_order_id, v_order_status, true, v_existing_cancelled_at;
    return;
  end if;

  -- ===================== only accepted/ready orders may be seller-cancelled here =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state that can be directly cancelled.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reason validation (after idempotency/eligibility, before any lock beyond orders) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  v_from_status := v_order_status;

  -- ===================== lock the current pending buyer cancellation request, if any =====================
  select ocr.id into v_req_id
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
    for update;

  -- ===================== lock this order's order_items (their locked status/quantity back the reservation check below) =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  -- ===================== lock this order's active reservations =====================
  perform 1 from public.inventory_reservations ir where ir.order_id = p_order_id and ir.status = 'active' order by ir.id for update;

  -- ===================== reservation/item consistency guard =====================
  -- ownership is already structurally guaranteed by inventory_reservations_order_item_ownership_fkey;
  -- only status and quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = p_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== aggregate release quantity per listing =====================
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = p_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- ===================== lock affected listings in deterministic order, validate, compute resulting values =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing reserved quantity is insufficient to release.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);
    v_new_available := v_new_available || (v_stock_qty - (v_reserved_qty - v_agg_qtys[i]));
    v_old_status := v_old_status || v_listing_status;
  end loop;

  -- ===================== release reservations (the ledger is authoritative, updated before the cached aggregate) =====================
  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = p_order_id and ir.status = 'active';

  -- ===================== update the cached listing aggregates and reopen visibility only where safe =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set reserved_quantity = v_new_reserved[i],
          status = case
            when v_old_status[i] = 'reserved' and v_new_available[i] > 0
              then 'available'::public.listing_status_enum
            else status
          end
      where id = v_listing_ids[i];
  end loop;

  -- ===================== parent order cancellation: status + lifecycle timestamp together, nothing else touched =====================
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  -- ===================== auto-confirm the pending buyer cancellation request, if one existed =====================
  if v_req_id is not null then
    update public.order_cancellation_requests
      set status = 'confirmed',
          reviewed_by = v_caller,
          reviewed_at = now(),
          review_note = v_reason
      where id = v_req_id;
  end if;

  -- ===================== exactly one parent history row, carrying the seller's reason =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_from_status, 'cancelled', v_caller, v_reason);

  -- ===================== notification: buyer receives cancellation event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_cancelled', v_caller, p_order_id, p_order_id::text || ':cancelled'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false, now();
end;
$$;

revoke all on function public.cancel_accepted_order(uuid, text) from public;
revoke all on function public.cancel_accepted_order(uuid, text) from anon;
grant execute on function public.cancel_accepted_order(uuid, text) to authenticated;

-- ============================================================
-- mark_order_ready
-- ============================================================
create or replace function public.mark_order_ready(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_ready boolean, ready_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;
  v_existing_ready_at timestamptz;
  v_new_ready_at timestamptz;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.ready_at, o.buyer_id
    into v_order_status, v_order_shop_id, v_existing_ready_at, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-ready is success, zero mutation =====================
  if v_order_status = 'ready' then
    return query
      select p_order_id, v_order_status, true, v_existing_ready_at;
    return;
  end if;

  -- ===================== only accepted orders may progress to ready =====================
  if v_order_status <> 'accepted' then
    raise exception 'Order is not in a state that can be marked ready.' using detail = 'ORDER_NOT_READYABLE';
  end if;

  -- ===================== cancellation-request freeze (approved progression blocker, not corruption handling) =====================
  if exists (
    select 1
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
  ) then
    raise exception 'A pending cancellation request must be resolved before this order can progress.' using detail = 'CANCELLATION_REQUEST_PENDING';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_ready_at := now();

  update public.orders as o
    set status = 'ready',
        ready_at = v_new_ready_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'accepted', 'ready', v_caller, null);

  -- ===================== notification: buyer receives ready event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_ready', v_caller, p_order_id, p_order_id::text || ':ready'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'ready'::public.order_status_enum, false, v_new_ready_at;
end;
$$;

revoke all on function public.mark_order_ready(uuid) from public;
revoke all on function public.mark_order_ready(uuid) from anon;
grant execute on function public.mark_order_ready(uuid) to authenticated;

-- ============================================================
-- mark_order_handed_over_or_shipped
-- ============================================================
create or replace function public.mark_order_handed_over_or_shipped(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_handed_over_or_shipped boolean, handed_over_or_shipped_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;
  v_existing_handed_over_or_shipped_at timestamptz;
  v_new_handed_over_or_shipped_at timestamptz;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.handed_over_or_shipped_at, o.buyer_id
    into v_order_status, v_order_shop_id, v_existing_handed_over_or_shipped_at, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-handed-over/shipped is success, zero mutation =====================
  if v_order_status = 'handed_over_or_shipped' then
    return query
      select p_order_id, v_order_status, true, v_existing_handed_over_or_shipped_at;
    return;
  end if;

  -- ===================== only ready orders may progress to handed_over_or_shipped =====================
  if v_order_status <> 'ready' then
    raise exception 'Order is not in a state that can be marked handed over or shipped.' using detail = 'ORDER_NOT_HANDOVERABLE';
  end if;

  -- ===================== cancellation-request freeze (approved progression blocker, not corruption handling) =====================
  if exists (
    select 1
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
  ) then
    raise exception 'A pending cancellation request must be resolved before this order can progress.' using detail = 'CANCELLATION_REQUEST_PENDING';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_handed_over_or_shipped_at := now();

  update public.orders as o
    set status = 'handed_over_or_shipped',
        handed_over_or_shipped_at = v_new_handed_over_or_shipped_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'ready', 'handed_over_or_shipped', v_caller, null);

  -- ===================== notification: buyer receives handed-over/shipped event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_handed_over_or_shipped', v_caller, p_order_id, p_order_id::text || ':handed_over_or_shipped'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'handed_over_or_shipped'::public.order_status_enum, false, v_new_handed_over_or_shipped_at;
end;
$$;

revoke all on function public.mark_order_handed_over_or_shipped(uuid) from public;
revoke all on function public.mark_order_handed_over_or_shipped(uuid) from anon;
grant execute on function public.mark_order_handed_over_or_shipped(uuid) to authenticated;

-- ============================================================
-- resolve_order_cancellation
-- ============================================================
create or replace function public.resolve_order_cancellation(p_request_id uuid, p_confirm boolean, p_review_note text)
returns table (request_id uuid, order_id uuid, request_status public.cancellation_request_status_enum, order_status public.order_status_enum, was_already_resolved boolean, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;

  v_routed_order_id uuid;
  v_order_id uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;

  v_request_order_id uuid;
  v_request_status public.cancellation_request_status_enum;
  v_reviewed_by uuid;
  v_reviewed_at timestamptz;

  v_normalized_note text;
  v_from_status public.order_status_enum;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_available integer[] := '{}';
  v_old_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;

  i integer;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== request-id -> order routing (unlocked, informational only) =====================
  select ocr.order_id into v_routed_order_id
    from public.order_cancellation_requests ocr
    where ocr.id = p_request_id;

  if not found then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.buyer_id
    into v_order_status, v_order_shop_id, v_order_buyer_id
    from public.orders o
    where o.id = v_routed_order_id
    for update;

  if not found then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  -- ===================== lock request row and revalidate against the locked order =====================
  select ocr.order_id, ocr.status, ocr.reviewed_by, ocr.reviewed_at
    into v_request_order_id, v_request_status, v_reviewed_by, v_reviewed_at
    from public.order_cancellation_requests ocr
    where ocr.id = p_request_id
    for update;

  if not found or v_request_order_id is distinct from v_routed_order_id then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  v_order_id := v_routed_order_id;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this request.' using detail = 'NOT_ORDER_SELLER';
  end if;

  v_normalized_note := nullif(btrim(p_review_note), '');

  -- ===================== resolved-request idempotency =====================
  if v_request_status = 'confirmed' then
    if p_confirm then
      return query
        select p_request_id, v_order_id, v_request_status, v_order_status, true, v_reviewed_at;
      return;
    else
      raise exception 'This cancellation request has already been resolved.' using detail = 'REQUEST_ALREADY_RESOLVED';
    end if;
  elsif v_request_status = 'rejected' then
    if not p_confirm then
      return query
        select p_request_id, v_order_id, v_request_status, v_order_status, true, v_reviewed_at;
      return;
    else
      raise exception 'This cancellation request has already been resolved.' using detail = 'REQUEST_ALREADY_RESOLVED';
    end if;
  end if;

  -- ===================== request still pending: order must still be eligible =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state this cancellation request can be resolved against.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reject path =====================
  if not p_confirm then
    if v_normalized_note is null then
      raise exception 'A review note is required to reject a cancellation request.' using detail = 'INVALID_REVIEW_NOTE';
    end if;

    update public.order_cancellation_requests
      set status = 'rejected',
          reviewed_by = v_caller,
          reviewed_at = now(),
          review_note = v_normalized_note
      where id = p_request_id;

    -- ===================== notification: buyer receives the rejection =====================
    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select v_order_buyer_id, 'order_cancellation_rejected', v_caller, v_order_id, p_request_id::text || ':rejected'
    where not exists (
      select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

    return query
      select p_request_id, v_order_id, 'rejected'::public.cancellation_request_status_enum, v_order_status, false, now();
    return;
  end if;

  -- ===================== confirm path =====================
  v_from_status := v_order_status;

  -- fix: alias "oi" makes the order_id filter unambiguous against this
  -- function's own "order_id" output column. Their locked, stable
  -- status/quantity values back the reservation check below.
  perform 1 from public.order_items oi where oi.order_id = v_order_id order by oi.id for update;

  -- fix: alias "ir" makes the order_id filter unambiguous, same as above.
  perform 1 from public.inventory_reservations ir where ir.order_id = v_order_id and ir.status = 'active' order by ir.id for update;

  -- reservation/item consistency guard: ownership is already structurally guaranteed by
  -- inventory_reservations_order_item_ownership_fkey; only status and quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = v_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- aggregate release quantity per listing
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = v_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- lock affected listings in deterministic order, validate, compute resulting values
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing reserved quantity is insufficient to release.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);
    v_new_available := v_new_available || (v_stock_qty - (v_reserved_qty - v_agg_qtys[i]));
    v_old_status := v_old_status || v_listing_status;
  end loop;

  -- release reservations (the ledger is authoritative, updated before the cached aggregate)
  -- fix: alias "ir" makes the order_id filter unambiguous; the SET target
  -- list stays bare (Postgres does not accept alias-qualified SET targets,
  -- and a bare SET target is never ambiguous regardless of alias presence).
  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = v_order_id and ir.status = 'active';

  -- update the cached listing aggregates and reopen visibility only where safe
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set reserved_quantity = v_new_reserved[i],
          status = case
            when v_old_status[i] = 'reserved' and v_new_available[i] > 0
              then 'available'::public.listing_status_enum
            else status
          end
      where id = v_listing_ids[i];
  end loop;

  -- parent order cancellation: status + lifecycle timestamp together, nothing else touched
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = v_order_id;

  -- request resolution
  update public.order_cancellation_requests
    set status = 'confirmed',
        reviewed_by = v_caller,
        reviewed_at = now(),
        review_note = v_normalized_note
    where id = p_request_id;

  -- exactly one parent history row
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (v_order_id, v_from_status, 'cancelled', v_caller, null);

  -- ===================== notification: buyer receives confirmed cancellation =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_cancelled', v_caller, v_order_id, v_order_id::text || ':cancelled'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_request_id, v_order_id, 'confirmed'::public.cancellation_request_status_enum, 'cancelled'::public.order_status_enum, false, now();
end;
$$;

revoke all on function public.resolve_order_cancellation(uuid, boolean, text) from public;
revoke all on function public.resolve_order_cancellation(uuid, boolean, text) from anon;
grant execute on function public.resolve_order_cancellation(uuid, boolean, text) to authenticated;

-- ============================================================
-- confirm_order_received
-- ============================================================
create or replace function public.confirm_order_received(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_received_confirmed boolean, received_confirmed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_existing_received_confirmed_at timestamptz;
  v_new_received_confirmed_at timestamptz;
  v_final_status public.order_status_enum;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id, o.received_confirmed_at
    into v_order_status, v_order_buyer_id, v_existing_received_confirmed_at
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must be the order's buyer =====================
  if v_order_buyer_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  -- ===================== idempotency: already-received-confirmed is success, zero mutation =====================
  -- Unchanged from 0027: no completion retry attempted here (no current
  -- caller relies on it -- see header). Byte-identical to the prior
  -- version of this branch.
  if v_order_status = 'received_confirmed' then
    return query
      select p_order_id, v_order_status, true, v_existing_received_confirmed_at;
    return;
  end if;

  -- ===================== only handed_over_or_shipped orders may progress to received_confirmed =====================
  if v_order_status <> 'handed_over_or_shipped' then
    raise exception 'Order is not in a state that can be marked received.' using detail = 'ORDER_NOT_RECEIVABLE';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_received_confirmed_at := now();

  update public.orders as o
    set status = 'received_confirmed',
        received_confirmed_at = v_new_received_confirmed_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'handed_over_or_shipped', 'received_confirmed', v_caller, null);

  -- ===================== immediate completion attempt (the fix) =====================
  -- Implements 0029's own documented-but-unbuilt orchestration: a trusted
  -- process invokes complete_order immediately after a fresh receipt
  -- confirmation. Run as the shared `postgres` owner via SECURITY DEFINER,
  -- so complete_order's own REVOKE FROM authenticated is untouched and
  -- irrelevant here -- no client can reach complete_order directly. Wrapped
  -- in an exception-handling block (an implicit savepoint) so that if
  -- completion fails for any reason, only its own work rolls back -- the
  -- received_confirmed update and history row above, already executed in
  -- this same outer transaction, are unaffected and still commit.
  begin
    perform public.complete_order(p_order_id);
  exception
    when others then
      raise warning 'complete_order failed immediately after confirm_order_received for order %: %', p_order_id, sqlerrm;
  end;

  -- ===================== return the row's true final status =====================
  -- 'completed' if the attempt above succeeded, 'received_confirmed'
  -- unchanged if it did not -- never stale relative to the actual row.
  select o.status into v_final_status from public.orders o where o.id = p_order_id;

  return query
    select p_order_id, v_final_status, false, v_new_received_confirmed_at;
end;
$$;

revoke all on function public.confirm_order_received(uuid) from public;
revoke all on function public.confirm_order_received(uuid) from anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;

-- ============================================================
-- cancel_order_changes
-- ============================================================
create or replace function public.cancel_order_changes(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_cancelled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_active_reservation_exists boolean;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id
    into v_order_status, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must be the order's buyer =====================
  if v_order_buyer_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  -- ===================== idempotency: already-cancelled is success, zero mutation =====================
  if v_order_status = 'cancelled' then
    return query
      select p_order_id, v_order_status, true;
    return;
  end if;

  -- ===================== only changes_pending may be cancelled by this RPC =====================
  if v_order_status <> 'changes_pending' then
    raise exception 'Order is not in a state this cancellation can be applied to.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== corruption guard: an active reservation must never exist here =====================
  select exists (
    select 1 from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
  ) into v_active_reservation_exists;

  if v_active_reservation_exists then
    raise exception 'An active inventory reservation exists for this order.' using detail = 'RESERVATION_ALREADY_EXISTS';
  end if;

  -- ===================== parent mutation: status + lifecycle timestamp together =====================
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'changes_pending', 'cancelled', v_caller, null);

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false;
end;
$$;

revoke all on function public.cancel_order_changes(uuid) from public;
revoke all on function public.cancel_order_changes(uuid) from anon;
grant execute on function public.cancel_order_changes(uuid) to authenticated;

-- ============================================================
-- cancel_pending_order
-- ============================================================
create or replace function public.cancel_pending_order(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_cancelled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_active_reservation_exists boolean;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id
    into v_order_status, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must be the order's buyer =====================
  if v_order_buyer_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  -- ===================== idempotency: already-cancelled is success, zero mutation =====================
  if v_order_status = 'cancelled' then
    return query
      select p_order_id, v_order_status, true;
    return;
  end if;

  -- ===================== only pending may be cancelled by this RPC =====================
  if v_order_status <> 'pending' then
    raise exception 'Order is not in a state this cancellation can be applied to.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== corruption guard: an active reservation must never exist here =====================
  select exists (
    select 1 from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
  ) into v_active_reservation_exists;

  if v_active_reservation_exists then
    raise exception 'An active inventory reservation exists for this order.' using detail = 'RESERVATION_ALREADY_EXISTS';
  end if;

  -- ===================== parent mutation: status + lifecycle timestamp together =====================
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'pending', 'cancelled', v_caller, null);

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false;
end;
$$;

revoke all on function public.cancel_pending_order(uuid) from public;
revoke all on function public.cancel_pending_order(uuid) from anon;
grant execute on function public.cancel_pending_order(uuid) to authenticated;

-- ============================================================
-- request_order_cancellation
-- ============================================================
create or replace function public.request_order_cancellation(p_order_id uuid, p_reason text)
returns table (request_id uuid, order_id uuid, request_status public.cancellation_request_status_enum, was_already_pending boolean, requested_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_reason text;
  v_existing_id uuid;
  v_existing_status public.cancellation_request_status_enum;
  v_existing_requested_at timestamptz;
  v_new_id uuid;
  v_new_requested_at timestamptz;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id, o.shop_id
    into v_order_status, v_order_buyer_id, v_order_shop_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must be the order's buyer =====================
  if v_order_buyer_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  -- ===================== only accepted/ready orders may open a cancellation request =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state a cancellation request can be created for.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reason validation (before the existing-pending-request check) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  -- ===================== idempotency: an existing pending request wins unchanged =====================
  select ocr.id, ocr.status, ocr.requested_at
    into v_existing_id, v_existing_status, v_existing_requested_at
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending';

  if found then
    return query
      select v_existing_id, p_order_id, v_existing_status, true, v_existing_requested_at;
    return;
  end if;

  -- ===================== fresh request =====================
  -- fix: the target alias "ocr" lets RETURNING unambiguously reference the
  -- inserted row's own columns instead of colliding with this function's
  -- identically-named "requested_at" output column.
  insert into public.order_cancellation_requests as ocr (order_id, requested_by, status, reason)
    values (p_order_id, v_caller, 'pending', v_reason)
    returning ocr.id, ocr.requested_at into v_new_id, v_new_requested_at;

  -- ===================== notification: seller receives the new cancellation request =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_shop_owner_id, 'order_cancellation_requested', v_caller, p_order_id, v_new_id::text
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_new_id, p_order_id, 'pending'::public.cancellation_request_status_enum, false, v_new_requested_at;
end;
$$;

revoke all on function public.request_order_cancellation(uuid, text) from public;
revoke all on function public.request_order_cancellation(uuid, text) from anon;
grant execute on function public.request_order_cancellation(uuid, text) to authenticated;

-- ============================================================
-- create_listing (Part 2: category-B, existing account_suspended check
-- untouched below, new deleted_at guard added earlier, independently)
-- ============================================================
create or replace function public.create_listing(
  p_title text default null,
  p_description text default null,
  p_category_id integer default null,
  p_listing_type public.listing_type_enum default null,
  p_condition public.listing_condition_enum default null,
  p_price_cents bigint default null,
  p_original_price_cents bigint default null,
  p_is_negotiable boolean default false,
  p_brand text default null,
  p_known_flaws text default null,
  p_stock_quantity integer default 1,
  p_province_id integer default null,
  p_city_id integer default null,
  p_barangay_id integer default null,
  p_meetup_note text default null,
  p_fulfillment_methods public.fulfillment_method_enum[] default null,
  p_image_paths text[] default null,
  p_vehicle_details jsonb default null,
  p_rental_details jsonb default null
)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  status public.listing_status_enum,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_title text;
  v_description text;
  v_category_slug text;
  v_is_vehicle_category boolean;
  v_is_rental_category boolean;
  v_brand text;
  v_known_flaws text;
  v_meetup_note text;
  v_image_count integer;
  v_path text;
  v_fulfillment_count integer;
  v_slug text;
  v_public_code text;
  v_now timestamptz;
  v_listing_id uuid;
  v_created_at timestamptz;
  v_cover_image_id uuid;
  v_constraint_name text;
  v_vehicle_brand text;
  v_vehicle_model text;
  v_vehicle_year smallint;
  v_vehicle_mileage_km integer;
  v_vehicle_transmission text;
  v_vehicle_fuel_type text;
  v_vehicle_registration_status public.vehicle_registration_status_enum;
  v_vehicle_documents text[];
  v_rental_price_cents bigint;
  v_rental_period public.rental_period_enum;
  v_rental_security_deposit_cents bigint;
  v_rental_terms text;
  v_rental_minimum_period text;
  v_rental_capacity integer;
  v_rental_whats_included text;
  v_rental_rules_restrictions text;
  v_rental_availability public.rental_availability_enum;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions (existing check, unchanged, defense-in-depth) =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to create listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== title (required -- the one deliberate Draft floor) =====================
  v_title := nullif(btrim(p_title), '');
  if v_title is null then
    raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
  end if;

  -- ===================== description (optional while Draft; blank normalizes to NULL; required at publish) =====================
  v_description := nullif(btrim(p_description), '');

  -- ===================== category (optional; validated + resolved only when supplied) =====================
  if p_category_id is not null then
    select c.slug into v_category_slug
      from public.categories c
      where c.id = p_category_id;

    if not found then
      raise exception 'Selected category does not exist.' using detail = 'CATEGORY_NOT_FOUND';
    end if;

    v_is_vehicle_category := v_category_slug in ('cars', 'motorcycles');
    v_is_rental_category := v_category_slug = 'for-rent';
  else
    v_is_vehicle_category := false;
    v_is_rental_category := false;
  end if;

  -- ===================== listing type / condition (optional; cross-validated only when both known) =====================
  if p_listing_type is not null and p_condition is not null then
    if p_listing_type = 'brand_new' and p_condition <> 'brand_new' then
      raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;

    if p_listing_type = 'preloved' and p_condition = 'brand_new' then
      raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;
  end if;

  -- ===================== known flaws (required only when condition is actually Fair) =====================
  v_known_flaws := nullif(btrim(p_known_flaws), '');
  if p_condition = 'fair' and v_known_flaws is null then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price (optional; validated only when supplied) =====================
  if p_price_cents is not null and p_price_cents < 0 then
    raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
  end if;

  -- ===================== original price: independently non-negative whenever supplied, regardless of whether price is known =====================
  if p_original_price_cents is not null and p_original_price_cents < 0 then
    raise exception 'Original price is invalid.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  if p_original_price_cents is not null and p_price_cents is not null and p_original_price_cents < p_price_cents then
    raise exception 'Original price must not be lower than the current price.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  -- ===================== stock quantity (defaults to 1; validated only when explicitly supplied) =====================
  if p_stock_quantity is not null and p_stock_quantity < 1 then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location (fully optional; partial states validated top-down) =====================
  if p_city_id is not null and p_province_id is null then
    raise exception 'City requires province to also be specified.' using detail = 'CITY_REQUIRES_PROVINCE';
  end if;

  if p_barangay_id is not null and p_city_id is null then
    raise exception 'Barangay requires city to also be specified.' using detail = 'BARANGAY_REQUIRES_CITY';
  end if;

  if p_province_id is not null and p_city_id is not null and not exists (
    select 1 from public.cities_municipalities c
    where c.id = p_city_id and c.province_id = p_province_id
  ) then
    raise exception 'Selected city does not belong to the selected province.' using detail = 'INVALID_CITY_FOR_PROVINCE';
  end if;

  if p_barangay_id is not null and p_city_id is not null and not exists (
    select 1 from public.barangays b
    where b.id = p_barangay_id and b.city_id = p_city_id
  ) then
    raise exception 'Selected barangay does not belong to the selected city.' using detail = 'INVALID_BARANGAY_FOR_CITY';
  end if;

  -- ===================== optional plain fields =====================
  v_brand := nullif(btrim(p_brand), '');
  v_meetup_note := nullif(btrim(p_meetup_note), '');

  -- ===================== fulfillment methods (optional; deduplicated only when supplied) =====================
  v_fulfillment_count := coalesce(array_length(p_fulfillment_methods, 1), 0);

  if v_fulfillment_count > 0
     and v_fulfillment_count <> (select count(distinct m) from unnest(p_fulfillment_methods) m) then
    raise exception 'Duplicate fulfillment method selected.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== images (optional, 0-8; ownership-validated for whichever are supplied) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 8 then
    raise exception 'A listing may have at most 8 photos.' using detail = 'TOO_MANY_LISTING_IMAGES';
  end if;

  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null
         or v_path !~ '[^[:space:]]'
         or v_path !~ ('^listing-images/' || v_caller::text || '/') then
        raise exception 'One or more listing photos are invalid.' using detail = 'LISTING_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== vehicle details (optional; only for Cars/Motorcycles, only when category known) =====================
  if p_vehicle_details is not null then
    if not v_is_vehicle_category then
      raise exception 'Vehicle details are only allowed for Cars/Motorcycles listings.' using detail = 'VEHICLE_DETAILS_NOT_ALLOWED';
    end if;

    if jsonb_typeof(p_vehicle_details) <> 'object' then
      raise exception 'Vehicle details must be a JSON object.' using detail = 'VEHICLE_DETAILS_INVALID';
    end if;

    if p_vehicle_details ? 'brand' then
      if jsonb_typeof(p_vehicle_details -> 'brand') <> 'string' then
        raise exception 'Vehicle brand must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_brand := nullif(btrim(p_vehicle_details ->> 'brand'), '');
    end if;

    if p_vehicle_details ? 'model' then
      if jsonb_typeof(p_vehicle_details -> 'model') <> 'string' then
        raise exception 'Vehicle model must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_model := nullif(btrim(p_vehicle_details ->> 'model'), '');
    end if;

    if p_vehicle_details ? 'year' then
      if jsonb_typeof(p_vehicle_details -> 'year') <> 'number' then
        raise exception 'Vehicle year must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_year := (p_vehicle_details ->> 'year')::smallint;
      if v_vehicle_year < 1900 then
        raise exception 'Vehicle year is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
    end if;

    if p_vehicle_details ? 'mileage_km' then
      if jsonb_typeof(p_vehicle_details -> 'mileage_km') <> 'number' then
        raise exception 'Vehicle mileage must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_mileage_km := (p_vehicle_details ->> 'mileage_km')::integer;
      if v_vehicle_mileage_km < 0 then
        raise exception 'Vehicle mileage is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
    end if;

    if p_vehicle_details ? 'transmission' then
      if jsonb_typeof(p_vehicle_details -> 'transmission') <> 'string' then
        raise exception 'Vehicle transmission must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_transmission := nullif(btrim(p_vehicle_details ->> 'transmission'), '');
    end if;

    if p_vehicle_details ? 'fuel_type' then
      if jsonb_typeof(p_vehicle_details -> 'fuel_type') <> 'string' then
        raise exception 'Vehicle fuel type must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_fuel_type := nullif(btrim(p_vehicle_details ->> 'fuel_type'), '');
    end if;

    if p_vehicle_details ? 'registration_status' then
      if jsonb_typeof(p_vehicle_details -> 'registration_status') <> 'string'
         or (p_vehicle_details ->> 'registration_status') not in ('registered', 'expired_registration', 'for_renewal') then
        raise exception 'Vehicle registration status is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      v_vehicle_registration_status := (p_vehicle_details ->> 'registration_status')::public.vehicle_registration_status_enum;
    end if;

    if p_vehicle_details ? 'documents_available' then
      if jsonb_typeof(p_vehicle_details -> 'documents_available') <> 'array'
         or exists (
           select 1 from jsonb_array_elements(p_vehicle_details -> 'documents_available') e
           where jsonb_typeof(e) <> 'string'
         ) then
        raise exception 'Vehicle documents must be a list of text values.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;
      select array_agg(doc) into v_vehicle_documents
        from jsonb_array_elements_text(p_vehicle_details -> 'documents_available') as doc;
    end if;
  end if;

  -- ===================== rental details (optional; only for For Rent, only when category known) =====================
  if p_rental_details is not null then
    if not v_is_rental_category then
      raise exception 'Rental details are only allowed for For Rent listings.' using detail = 'RENTAL_DETAILS_NOT_ALLOWED';
    end if;

    if jsonb_typeof(p_rental_details) <> 'object' then
      raise exception 'Rental details must be a JSON object.' using detail = 'RENTAL_DETAILS_INVALID';
    end if;

    if p_rental_details ? 'rental_price_cents' then
      if jsonb_typeof(p_rental_details -> 'rental_price_cents') <> 'number' then
        raise exception 'Rental price must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_price_cents := (p_rental_details ->> 'rental_price_cents')::bigint;
      if v_rental_price_cents < 0 then
        raise exception 'Rental price is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
    end if;

    if p_rental_details ? 'rental_period' then
      if jsonb_typeof(p_rental_details -> 'rental_period') <> 'string'
         or (p_rental_details ->> 'rental_period') not in ('daily', 'weekly', 'monthly', 'other') then
        raise exception 'Rental period is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_period := (p_rental_details ->> 'rental_period')::public.rental_period_enum;
    end if;

    if p_rental_details ? 'security_deposit_cents' then
      if jsonb_typeof(p_rental_details -> 'security_deposit_cents') <> 'number' then
        raise exception 'Security deposit must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_security_deposit_cents := (p_rental_details ->> 'security_deposit_cents')::bigint;
      if v_rental_security_deposit_cents < 0 then
        raise exception 'Security deposit is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
    end if;

    if p_rental_details ? 'rental_terms' then
      if jsonb_typeof(p_rental_details -> 'rental_terms') <> 'string' then
        raise exception 'Rental terms must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_terms := nullif(btrim(p_rental_details ->> 'rental_terms'), '');
    end if;

    if p_rental_details ? 'minimum_rental_period' then
      if jsonb_typeof(p_rental_details -> 'minimum_rental_period') <> 'string' then
        raise exception 'Minimum rental period must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_minimum_period := nullif(btrim(p_rental_details ->> 'minimum_rental_period'), '');
    end if;

    if p_rental_details ? 'capacity' then
      if jsonb_typeof(p_rental_details -> 'capacity') <> 'number' then
        raise exception 'Capacity must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_capacity := (p_rental_details ->> 'capacity')::integer;
      if v_rental_capacity <= 0 then
        raise exception 'Capacity is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
    end if;

    if p_rental_details ? 'whats_included' then
      if jsonb_typeof(p_rental_details -> 'whats_included') <> 'string' then
        raise exception 'What''s included must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_whats_included := nullif(btrim(p_rental_details ->> 'whats_included'), '');
    end if;

    if p_rental_details ? 'rules_restrictions' then
      if jsonb_typeof(p_rental_details -> 'rules_restrictions') <> 'string' then
        raise exception 'Rules/restrictions must be text.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_rules_restrictions := nullif(btrim(p_rental_details ->> 'rules_restrictions'), '');
    end if;

    if p_rental_details ? 'availability' then
      if jsonb_typeof(p_rental_details -> 'availability') <> 'string'
         or (p_rental_details ->> 'availability') not in ('available', 'unavailable', 'paused') then
        raise exception 'Rental availability is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;
      v_rental_availability := (p_rental_details ->> 'availability')::public.rental_availability_enum;
    else
      v_rental_availability := 'available';
    end if;
  end if;

  -- ===================== slug: derived from title, same normalization as generate_unique_shop_slug =====================
  v_slug := lower(regexp_replace(btrim(v_title), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');
  if v_slug = '' or v_slug is null then
    v_slug := 'listing';
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  -- ===================== insert the listing (draft only, may be incomplete; public_code generated + retried on collision) =====================
  loop
    v_public_code := 'PSL-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));

    begin
      insert into public.listings as l (
        shop_id, category_id, title, slug, public_code, listing_type, condition,
        known_flaws, description, brand, price_cents, is_negotiable, original_price_cents,
        stock_quantity, province_id, city_id, barangay_id, meetup_note, status,
        created_at, updated_at
      )
      values (
        v_shop_id, p_category_id, v_title, v_slug, v_public_code, p_listing_type, p_condition,
        v_known_flaws, v_description, v_brand, p_price_cents, coalesce(p_is_negotiable, false), p_original_price_cents,
        coalesce(p_stock_quantity, 1), p_province_id, p_city_id, p_barangay_id, v_meetup_note, 'draft',
        v_now, v_now
      )
      returning l.id, l.created_at into v_listing_id, v_created_at;

      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name <> 'listings_public_code_key' then
          raise;
        end if;
        -- otherwise: a same-instant public_code collision -- loop and retry
        -- with a freshly generated code.
    end;
  end loop;

  -- ===================== fulfillment methods (only if any were supplied) =====================
  if v_fulfillment_count > 0 then
    insert into public.listing_fulfillment_methods (listing_id, method)
      select v_listing_id, m from unnest(p_fulfillment_methods) as m;
  end if;

  -- ===================== images, preserving submitted order as position 0..N-1 (only if any were supplied) =====================
  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.listing_images (listing_id, storage_path, position, is_reference_image)
        values (v_listing_id, p_image_paths[i], i - 1, false);
    end loop;

    -- ===================== deterministic cover image: the first submitted photo. Zero images => cover_image_id stays NULL. =====================
    select li.id into v_cover_image_id
      from public.listing_images li
      where li.listing_id = v_listing_id and li.position = 0;

    update public.listings as l
      set cover_image_id = v_cover_image_id
      where l.id = v_listing_id;
  end if;

  -- ===================== vehicle details =====================
  if p_vehicle_details is not null then
    insert into public.listing_vehicle_details (
      listing_id, brand, model, year, mileage_km, transmission, fuel_type,
      registration_status, documents_available, created_at, updated_at
    )
    values (
      v_listing_id, v_vehicle_brand, v_vehicle_model, v_vehicle_year, v_vehicle_mileage_km,
      v_vehicle_transmission, v_vehicle_fuel_type, v_vehicle_registration_status,
      v_vehicle_documents, v_now, v_now
    );
  end if;

  -- ===================== rental details =====================
  if p_rental_details is not null then
    insert into public.listing_rental_details (
      listing_id, rental_price_cents, rental_period, security_deposit_cents, rental_terms,
      minimum_rental_period, capacity, whats_included, rules_restrictions, availability,
      created_at, updated_at
    )
    values (
      v_listing_id, v_rental_price_cents, v_rental_period, v_rental_security_deposit_cents, v_rental_terms,
      v_rental_minimum_period, v_rental_capacity, v_rental_whats_included, v_rental_rules_restrictions,
      v_rental_availability, v_now, v_now
    );
  end if;

  return query
    select v_listing_id, v_public_code, v_slug, 'draft'::public.listing_status_enum, v_created_at;
end;
$$;

revoke all on function public.create_listing(
  text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean, text, text,
  integer, integer, integer, integer, text, public.fulfillment_method_enum[], text[], jsonb, jsonb
) from public;

revoke all on function public.create_listing(
  text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean, text, text,
  integer, integer, integer, integer, text, public.fulfillment_method_enum[], text[], jsonb, jsonb
) from anon;

grant execute on function public.create_listing(
  text, text, integer, public.listing_type_enum, public.listing_condition_enum, bigint, bigint, boolean, text, text,
  integer, integer, integer, integer, text, public.fulfillment_method_enum[], text[], jsonb, jsonb
) to authenticated;

-- ============================================================
-- update_listing (Part 2: category-B, existing account_suspended check
-- untouched below, new deleted_at guard added earlier, independently)
-- ============================================================
create or replace function public.update_listing(p_listing_id uuid, p_patch jsonb default '{}'::jsonb)
returns table (listing_id uuid, public_code text, slug text, status public.listing_status_enum, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_listing_status public.listing_status_enum;
  v_patch jsonb;
  v_title text;
  v_description text;
  v_category_id integer;
  v_listing_type public.listing_type_enum;
  v_condition public.listing_condition_enum;
  v_known_flaws text;
  v_brand text;
  v_price_cents bigint;
  v_original_price_cents bigint;
  v_is_negotiable boolean;
  v_stock_quantity integer;
  v_province_id integer;
  v_city_id integer;
  v_barangay_id integer;
  v_meetup_note text;
  v_public_code text;
  v_slug text;
  v_final_title text;
  v_final_description text;
  v_final_category_id integer;
  v_final_category_slug text;
  v_final_is_vehicle_category boolean;
  v_final_is_rental_category boolean;
  v_final_listing_type public.listing_type_enum;
  v_final_condition public.listing_condition_enum;
  v_final_known_flaws text;
  v_final_brand text;
  v_final_price_cents bigint;
  v_final_original_price_cents bigint;
  v_final_is_negotiable boolean;
  v_final_stock_quantity integer;
  v_final_province_id integer;
  v_final_city_id integer;
  v_final_barangay_id integer;
  v_final_meetup_note text;
  v_final_slug text;
  v_fulfillment_touched boolean;
  v_final_fulfillment_methods public.fulfillment_method_enum[];
  v_fulfillment_count integer;
  v_vehicle_patch jsonb;
  v_rental_patch jsonb;
  v_vehicle_brand text;
  v_vehicle_model text;
  v_vehicle_year smallint;
  v_vehicle_mileage_km integer;
  v_vehicle_transmission text;
  v_vehicle_fuel_type text;
  v_vehicle_registration_status public.vehicle_registration_status_enum;
  v_vehicle_documents text[];
  v_rental_price_cents bigint;
  v_rental_period public.rental_period_enum;
  v_rental_security_deposit_cents bigint;
  v_rental_terms text;
  v_rental_minimum_period text;
  v_rental_capacity integer;
  v_rental_whats_included text;
  v_rental_rules_restrictions text;
  v_rental_availability public.rental_availability_enum;
  v_updated_at timestamptz;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions (existing check, unchanged, defense-in-depth) =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to edit listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.shop_id, l.status, l.title, l.description, l.category_id, l.listing_type, l.condition,
         l.known_flaws, l.brand, l.price_cents, l.original_price_cents, l.is_negotiable,
         l.stock_quantity, l.province_id, l.city_id, l.barangay_id, l.meetup_note,
         l.public_code, l.slug
    into v_listing_shop_id, v_listing_status, v_title, v_description, v_category_id, v_listing_type, v_condition,
         v_known_flaws, v_brand, v_price_cents, v_original_price_cents, v_is_negotiable,
         v_stock_quantity, v_province_id, v_city_id, v_barangay_id, v_meetup_note,
         v_public_code, v_slug
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to edit this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  -- ===================== draft-only editing (see 0059's own header: post-publish editing is a canon-permitted, deliberately deferred follow-up) =====================
  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be edited with this operation.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  -- ===================== patch must be a JSON object =====================
  v_patch := coalesce(p_patch, '{}'::jsonb);
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Patch must be a JSON object.' using detail = 'PATCH_INVALID';
  end if;

  -- ===================== title: never clearable, must remain non-blank =====================
  if v_patch ? 'title' then
    if jsonb_typeof(v_patch -> 'title') <> 'string' then
      raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
    end if;
    v_final_title := nullif(btrim(v_patch ->> 'title'), '');
    if v_final_title is null then
      raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
    end if;
  else
    v_final_title := v_title;
  end if;

  -- ===================== description: nullable while draft, explicit JSON null clears it =====================
  if v_patch ? 'description' then
    if jsonb_typeof(v_patch -> 'description') = 'null' then
      v_final_description := null;
    else
      if jsonb_typeof(v_patch -> 'description') <> 'string' then
        raise exception 'Description must be text.' using detail = 'DESCRIPTION_INVALID';
      end if;
      v_final_description := nullif(btrim(v_patch ->> 'description'), '');
    end if;
  else
    v_final_description := v_description;
  end if;

  -- ===================== category: nullable, explicit JSON null clears it =====================
  if v_patch ? 'category_id' then
    if jsonb_typeof(v_patch -> 'category_id') = 'null' then
      v_final_category_id := null;
    else
      if jsonb_typeof(v_patch -> 'category_id') <> 'number' then
        raise exception 'Category is invalid.' using detail = 'CATEGORY_INVALID';
      end if;
      v_final_category_id := (v_patch ->> 'category_id')::integer;
    end if;
  else
    v_final_category_id := v_category_id;
  end if;

  if v_final_category_id is not null then
    select c.slug into v_final_category_slug
      from public.categories c
      where c.id = v_final_category_id;

    if not found then
      raise exception 'Selected category does not exist.' using detail = 'CATEGORY_NOT_FOUND';
    end if;

    v_final_is_vehicle_category := v_final_category_slug in ('cars', 'motorcycles');
    v_final_is_rental_category := v_final_category_slug = 'for-rent';
  else
    v_final_is_vehicle_category := false;
    v_final_is_rental_category := false;
  end if;

  -- ===================== listing type: nullable, explicit JSON null clears it =====================
  if v_patch ? 'listing_type' then
    if jsonb_typeof(v_patch -> 'listing_type') = 'null' then
      v_final_listing_type := null;
    else
      if jsonb_typeof(v_patch -> 'listing_type') <> 'string'
         or (v_patch ->> 'listing_type') not in ('preloved', 'brand_new') then
        raise exception 'Listing type is invalid.' using detail = 'LISTING_TYPE_INVALID';
      end if;
      v_final_listing_type := (v_patch ->> 'listing_type')::public.listing_type_enum;
    end if;
  else
    v_final_listing_type := v_listing_type;
  end if;

  -- ===================== condition: nullable, explicit JSON null clears it =====================
  if v_patch ? 'condition' then
    if jsonb_typeof(v_patch -> 'condition') = 'null' then
      v_final_condition := null;
    else
      if jsonb_typeof(v_patch -> 'condition') <> 'string'
         or (v_patch ->> 'condition') not in ('brand_new', 'like_new', 'very_good', 'good', 'fair') then
        raise exception 'Condition is invalid.' using detail = 'CONDITION_INVALID';
      end if;
      v_final_condition := (v_patch ->> 'condition')::public.listing_condition_enum;
    end if;
  else
    v_final_condition := v_condition;
  end if;

  -- ===================== listing type / condition, cross-validated on final merged state =====================
  if v_final_listing_type is not null and v_final_condition is not null then
    if v_final_listing_type = 'brand_new' and v_final_condition <> 'brand_new' then
      raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;

    if v_final_listing_type = 'preloved' and v_final_condition = 'brand_new' then
      raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
    end if;
  end if;

  -- ===================== known flaws: nullable, explicit JSON null clears it; evaluated against final condition =====================
  if v_patch ? 'known_flaws' then
    if jsonb_typeof(v_patch -> 'known_flaws') = 'null' then
      v_final_known_flaws := null;
    else
      if jsonb_typeof(v_patch -> 'known_flaws') <> 'string' then
        raise exception 'Known flaws must be text.' using detail = 'KNOWN_FLAWS_INVALID';
      end if;
      v_final_known_flaws := nullif(btrim(v_patch ->> 'known_flaws'), '');
    end if;
  else
    v_final_known_flaws := v_known_flaws;
  end if;

  if v_final_condition = 'fair' and v_final_known_flaws is null then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price: nullable, explicit JSON null clears it =====================
  if v_patch ? 'price_cents' then
    if jsonb_typeof(v_patch -> 'price_cents') = 'null' then
      v_final_price_cents := null;
    else
      if jsonb_typeof(v_patch -> 'price_cents') <> 'number' then
        raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
      end if;
      v_final_price_cents := (v_patch ->> 'price_cents')::bigint;
      if v_final_price_cents < 0 then
        raise exception 'Price is invalid.' using detail = 'PRICE_INVALID';
      end if;
    end if;
  else
    v_final_price_cents := v_price_cents;
  end if;

  -- ===================== original price: nullable, explicit JSON null clears it; independently non-negative whenever the FINAL value is non-null =====================
  if v_patch ? 'original_price_cents' then
    if jsonb_typeof(v_patch -> 'original_price_cents') = 'null' then
      v_final_original_price_cents := null;
    else
      if jsonb_typeof(v_patch -> 'original_price_cents') <> 'number' then
        raise exception 'Original price is invalid.' using detail = 'ORIGINAL_PRICE_INVALID';
      end if;
      v_final_original_price_cents := (v_patch ->> 'original_price_cents')::bigint;
    end if;
  else
    v_final_original_price_cents := v_original_price_cents;
  end if;

  if v_final_original_price_cents is not null and v_final_original_price_cents < 0 then
    raise exception 'Original price is invalid.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  if v_final_original_price_cents is not null and v_final_price_cents is not null
     and v_final_original_price_cents < v_final_price_cents then
    raise exception 'Original price must not be lower than the current price.' using detail = 'ORIGINAL_PRICE_INVALID';
  end if;

  -- ===================== is_negotiable: NOT NULL column, cannot be cleared =====================
  if v_patch ? 'is_negotiable' then
    if jsonb_typeof(v_patch -> 'is_negotiable') <> 'boolean' then
      raise exception 'Negotiable flag is invalid.' using detail = 'IS_NEGOTIABLE_INVALID';
    end if;
    v_final_is_negotiable := (v_patch ->> 'is_negotiable')::boolean;
  else
    v_final_is_negotiable := v_is_negotiable;
  end if;

  -- ===================== stock quantity: cannot be cleared, must remain >= 1 =====================
  if v_patch ? 'stock_quantity' then
    if jsonb_typeof(v_patch -> 'stock_quantity') <> 'number' then
      raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
    end if;
    v_final_stock_quantity := (v_patch ->> 'stock_quantity')::integer;
  else
    v_final_stock_quantity := v_stock_quantity;
  end if;

  if v_final_stock_quantity is null or v_final_stock_quantity < 1 then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location: each level nullable, explicit JSON null clears it =====================
  if v_patch ? 'province_id' then
    if jsonb_typeof(v_patch -> 'province_id') = 'null' then
      v_final_province_id := null;
    else
      if jsonb_typeof(v_patch -> 'province_id') <> 'number' then
        raise exception 'Province is invalid.' using detail = 'PROVINCE_INVALID';
      end if;
      v_final_province_id := (v_patch ->> 'province_id')::integer;
    end if;
  else
    v_final_province_id := v_province_id;
  end if;

  if v_patch ? 'city_id' then
    if jsonb_typeof(v_patch -> 'city_id') = 'null' then
      v_final_city_id := null;
    else
      if jsonb_typeof(v_patch -> 'city_id') <> 'number' then
        raise exception 'City/municipality is invalid.' using detail = 'CITY_INVALID';
      end if;
      v_final_city_id := (v_patch ->> 'city_id')::integer;
    end if;
  else
    v_final_city_id := v_city_id;
    -- cascade: province was cleared and the caller did not itself touch city_id
    if v_final_province_id is null then
      v_final_city_id := null;
    end if;
  end if;

  if v_patch ? 'barangay_id' then
    if jsonb_typeof(v_patch -> 'barangay_id') = 'null' then
      v_final_barangay_id := null;
    else
      if jsonb_typeof(v_patch -> 'barangay_id') <> 'number' then
        raise exception 'Barangay is invalid.' using detail = 'BARANGAY_INVALID';
      end if;
      v_final_barangay_id := (v_patch ->> 'barangay_id')::integer;
    end if;
  else
    v_final_barangay_id := v_barangay_id;
    -- cascade: city ended up null (explicitly or via the province cascade above) and the caller did not itself touch barangay_id
    if v_final_city_id is null then
      v_final_barangay_id := null;
    end if;
  end if;

  if v_final_city_id is not null and v_final_province_id is null then
    raise exception 'City requires province to also be specified.' using detail = 'CITY_REQUIRES_PROVINCE';
  end if;

  if v_final_barangay_id is not null and v_final_city_id is null then
    raise exception 'Barangay requires city to also be specified.' using detail = 'BARANGAY_REQUIRES_CITY';
  end if;

  if v_final_province_id is not null and v_final_city_id is not null and not exists (
    select 1 from public.cities_municipalities c
    where c.id = v_final_city_id and c.province_id = v_final_province_id
  ) then
    raise exception 'Selected city does not belong to the selected province.' using detail = 'INVALID_CITY_FOR_PROVINCE';
  end if;

  if v_final_barangay_id is not null and v_final_city_id is not null and not exists (
    select 1 from public.barangays b
    where b.id = v_final_barangay_id and b.city_id = v_final_city_id
  ) then
    raise exception 'Selected barangay does not belong to the selected city.' using detail = 'INVALID_BARANGAY_FOR_CITY';
  end if;

  -- ===================== brand: nullable, explicit JSON null clears it =====================
  if v_patch ? 'brand' then
    if jsonb_typeof(v_patch -> 'brand') = 'null' then
      v_final_brand := null;
    else
      if jsonb_typeof(v_patch -> 'brand') <> 'string' then
        raise exception 'Brand must be text.' using detail = 'BRAND_INVALID';
      end if;
      v_final_brand := nullif(btrim(v_patch ->> 'brand'), '');
    end if;
  else
    v_final_brand := v_brand;
  end if;

  -- ===================== meetup note: nullable, explicit JSON null clears it =====================
  if v_patch ? 'meetup_note' then
    if jsonb_typeof(v_patch -> 'meetup_note') = 'null' then
      v_final_meetup_note := null;
    else
      if jsonb_typeof(v_patch -> 'meetup_note') <> 'string' then
        raise exception 'Meetup note must be text.' using detail = 'MEETUP_NOTE_INVALID';
      end if;
      v_final_meetup_note := nullif(btrim(v_patch ->> 'meetup_note'), '');
    end if;
  else
    v_final_meetup_note := v_meetup_note;
  end if;

  -- ===================== fulfillment methods: whole-set replace, only when the key is present (including an explicit empty array) =====================
  if v_patch ? 'fulfillment_methods' then
    if jsonb_typeof(v_patch -> 'fulfillment_methods') <> 'array' then
      raise exception 'Fulfillment methods must be a list.' using detail = 'FULFILLMENT_INVALID';
    end if;

    if exists (
      select 1 from jsonb_array_elements_text(v_patch -> 'fulfillment_methods') as m
      where m not in ('meetup', 'pickup', 'local_delivery', 'shipping')
    ) then
      raise exception 'Fulfillment methods contain an invalid value.' using detail = 'FULFILLMENT_INVALID';
    end if;

    select array_agg(m::public.fulfillment_method_enum) into v_final_fulfillment_methods
      from jsonb_array_elements_text(v_patch -> 'fulfillment_methods') as m;

    v_fulfillment_touched := true;
  else
    v_fulfillment_touched := false;
  end if;

  if v_fulfillment_touched then
    v_fulfillment_count := coalesce(array_length(v_final_fulfillment_methods, 1), 0);

    if v_fulfillment_count > 0
       and v_fulfillment_count <> (select count(distinct m) from unnest(v_final_fulfillment_methods) m) then
      raise exception 'Duplicate fulfillment method selected.' using detail = 'FULFILLMENT_INVALID';
    end if;

    delete from public.listing_fulfillment_methods where listing_id = p_listing_id;

    if v_fulfillment_count > 0 then
      insert into public.listing_fulfillment_methods (listing_id, method)
        select p_listing_id, m from unnest(v_final_fulfillment_methods) as m;
    end if;
  end if;

  -- ===================== slug: regenerated only if title actually changed =====================
  if v_final_title <> v_title then
    v_final_slug := lower(regexp_replace(btrim(v_final_title), '[^a-zA-Z0-9]+', '-', 'g'));
    v_final_slug := btrim(v_final_slug, '-');
    if v_final_slug = '' or v_final_slug is null then
      v_final_slug := 'listing';
    end if;
  else
    v_final_slug := v_slug;
  end if;

  -- ===================== apply the merged update (public_code and status are never written here) =====================
  update public.listings as l
    set title = v_final_title,
        description = v_final_description,
        category_id = v_final_category_id,
        listing_type = v_final_listing_type,
        condition = v_final_condition,
        known_flaws = v_final_known_flaws,
        brand = v_final_brand,
        price_cents = v_final_price_cents,
        original_price_cents = v_final_original_price_cents,
        is_negotiable = v_final_is_negotiable,
        stock_quantity = v_final_stock_quantity,
        province_id = v_final_province_id,
        city_id = v_final_city_id,
        barangay_id = v_final_barangay_id,
        meetup_note = v_final_meetup_note,
        slug = v_final_slug
    where l.id = p_listing_id
    returning l.updated_at into v_updated_at;

  -- ===================== vehicle/rental: drop extension rows the final category no longer supports (unconditional, regardless of whether the patch touched them) =====================
  if not v_final_is_vehicle_category then
    delete from public.listing_vehicle_details where listing_id = p_listing_id;
  end if;

  if not v_final_is_rental_category then
    delete from public.listing_rental_details where listing_id = p_listing_id;
  end if;

  -- ===================== vehicle details: omitted -> preserve; explicit null -> delete; object -> validate against FINAL category + upsert =====================
  if v_patch ? 'vehicle_details' then
    v_vehicle_patch := v_patch -> 'vehicle_details';

    if jsonb_typeof(v_vehicle_patch) = 'null' then
      delete from public.listing_vehicle_details where listing_id = p_listing_id;
    else
      if jsonb_typeof(v_vehicle_patch) <> 'object' then
        raise exception 'Vehicle details must be a JSON object.' using detail = 'VEHICLE_DETAILS_INVALID';
      end if;

      if not v_final_is_vehicle_category then
        raise exception 'Vehicle details are only allowed for Cars/Motorcycles listings.' using detail = 'VEHICLE_DETAILS_NOT_ALLOWED';
      end if;

      v_vehicle_brand := null;
      v_vehicle_model := null;
      v_vehicle_year := null;
      v_vehicle_mileage_km := null;
      v_vehicle_transmission := null;
      v_vehicle_fuel_type := null;
      v_vehicle_registration_status := null;
      v_vehicle_documents := null;

      if v_vehicle_patch ? 'brand' then
        if jsonb_typeof(v_vehicle_patch -> 'brand') <> 'string' then
          raise exception 'Vehicle brand must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_brand := nullif(btrim(v_vehicle_patch ->> 'brand'), '');
      end if;

      if v_vehicle_patch ? 'model' then
        if jsonb_typeof(v_vehicle_patch -> 'model') <> 'string' then
          raise exception 'Vehicle model must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_model := nullif(btrim(v_vehicle_patch ->> 'model'), '');
      end if;

      if v_vehicle_patch ? 'year' then
        if jsonb_typeof(v_vehicle_patch -> 'year') <> 'number' then
          raise exception 'Vehicle year must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_year := (v_vehicle_patch ->> 'year')::smallint;
        if v_vehicle_year < 1900 then
          raise exception 'Vehicle year is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
      end if;

      if v_vehicle_patch ? 'mileage_km' then
        if jsonb_typeof(v_vehicle_patch -> 'mileage_km') <> 'number' then
          raise exception 'Vehicle mileage must be a number.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_mileage_km := (v_vehicle_patch ->> 'mileage_km')::integer;
        if v_vehicle_mileage_km < 0 then
          raise exception 'Vehicle mileage is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
      end if;

      if v_vehicle_patch ? 'transmission' then
        if jsonb_typeof(v_vehicle_patch -> 'transmission') <> 'string' then
          raise exception 'Vehicle transmission must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_transmission := nullif(btrim(v_vehicle_patch ->> 'transmission'), '');
      end if;

      if v_vehicle_patch ? 'fuel_type' then
        if jsonb_typeof(v_vehicle_patch -> 'fuel_type') <> 'string' then
          raise exception 'Vehicle fuel type must be text.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_fuel_type := nullif(btrim(v_vehicle_patch ->> 'fuel_type'), '');
      end if;

      if v_vehicle_patch ? 'registration_status' then
        if jsonb_typeof(v_vehicle_patch -> 'registration_status') <> 'string'
           or (v_vehicle_patch ->> 'registration_status') not in ('registered', 'expired_registration', 'for_renewal') then
          raise exception 'Vehicle registration status is invalid.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        v_vehicle_registration_status := (v_vehicle_patch ->> 'registration_status')::public.vehicle_registration_status_enum;
      end if;

      if v_vehicle_patch ? 'documents_available' then
        if jsonb_typeof(v_vehicle_patch -> 'documents_available') <> 'array'
           or exists (
             select 1 from jsonb_array_elements(v_vehicle_patch -> 'documents_available') e
             where jsonb_typeof(e) <> 'string'
           ) then
          raise exception 'Vehicle documents must be a list of text values.' using detail = 'VEHICLE_DETAILS_INVALID';
        end if;
        select array_agg(doc) into v_vehicle_documents
          from jsonb_array_elements_text(v_vehicle_patch -> 'documents_available') as doc;
      end if;

      insert into public.listing_vehicle_details (
        listing_id, brand, model, year, mileage_km, transmission, fuel_type,
        registration_status, documents_available
      )
      values (
        p_listing_id, v_vehicle_brand, v_vehicle_model, v_vehicle_year, v_vehicle_mileage_km,
        v_vehicle_transmission, v_vehicle_fuel_type, v_vehicle_registration_status, v_vehicle_documents
      )
      on conflict (listing_id) do update set
        brand = excluded.brand,
        model = excluded.model,
        year = excluded.year,
        mileage_km = excluded.mileage_km,
        transmission = excluded.transmission,
        fuel_type = excluded.fuel_type,
        registration_status = excluded.registration_status,
        documents_available = excluded.documents_available;
    end if;
  end if;

  -- ===================== rental details: omitted -> preserve; explicit null -> delete; object -> validate against FINAL category + upsert =====================
  if v_patch ? 'rental_details' then
    v_rental_patch := v_patch -> 'rental_details';

    if jsonb_typeof(v_rental_patch) = 'null' then
      delete from public.listing_rental_details where listing_id = p_listing_id;
    else
      if jsonb_typeof(v_rental_patch) <> 'object' then
        raise exception 'Rental details must be a JSON object.' using detail = 'RENTAL_DETAILS_INVALID';
      end if;

      if not v_final_is_rental_category then
        raise exception 'Rental details are only allowed for For Rent listings.' using detail = 'RENTAL_DETAILS_NOT_ALLOWED';
      end if;

      v_rental_price_cents := null;
      v_rental_period := null;
      v_rental_security_deposit_cents := null;
      v_rental_terms := null;
      v_rental_minimum_period := null;
      v_rental_capacity := null;
      v_rental_whats_included := null;
      v_rental_rules_restrictions := null;
      v_rental_availability := 'available';

      if v_rental_patch ? 'rental_price_cents' then
        if jsonb_typeof(v_rental_patch -> 'rental_price_cents') <> 'number' then
          raise exception 'Rental price must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_price_cents := (v_rental_patch ->> 'rental_price_cents')::bigint;
        if v_rental_price_cents < 0 then
          raise exception 'Rental price is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
      end if;

      if v_rental_patch ? 'rental_period' then
        if jsonb_typeof(v_rental_patch -> 'rental_period') <> 'string'
           or (v_rental_patch ->> 'rental_period') not in ('daily', 'weekly', 'monthly', 'other') then
          raise exception 'Rental period is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_period := (v_rental_patch ->> 'rental_period')::public.rental_period_enum;
      end if;

      if v_rental_patch ? 'security_deposit_cents' then
        if jsonb_typeof(v_rental_patch -> 'security_deposit_cents') <> 'number' then
          raise exception 'Security deposit must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_security_deposit_cents := (v_rental_patch ->> 'security_deposit_cents')::bigint;
        if v_rental_security_deposit_cents < 0 then
          raise exception 'Security deposit is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
      end if;

      if v_rental_patch ? 'rental_terms' then
        if jsonb_typeof(v_rental_patch -> 'rental_terms') <> 'string' then
          raise exception 'Rental terms must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_terms := nullif(btrim(v_rental_patch ->> 'rental_terms'), '');
      end if;

      if v_rental_patch ? 'minimum_rental_period' then
        if jsonb_typeof(v_rental_patch -> 'minimum_rental_period') <> 'string' then
          raise exception 'Minimum rental period must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_minimum_period := nullif(btrim(v_rental_patch ->> 'minimum_rental_period'), '');
      end if;

      if v_rental_patch ? 'capacity' then
        if jsonb_typeof(v_rental_patch -> 'capacity') <> 'number' then
          raise exception 'Capacity must be a number.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_capacity := (v_rental_patch ->> 'capacity')::integer;
        if v_rental_capacity <= 0 then
          raise exception 'Capacity is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
      end if;

      if v_rental_patch ? 'whats_included' then
        if jsonb_typeof(v_rental_patch -> 'whats_included') <> 'string' then
          raise exception 'What''s included must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_whats_included := nullif(btrim(v_rental_patch ->> 'whats_included'), '');
      end if;

      if v_rental_patch ? 'rules_restrictions' then
        if jsonb_typeof(v_rental_patch -> 'rules_restrictions') <> 'string' then
          raise exception 'Rules/restrictions must be text.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_rules_restrictions := nullif(btrim(v_rental_patch ->> 'rules_restrictions'), '');
      end if;

      if v_rental_patch ? 'availability' then
        if jsonb_typeof(v_rental_patch -> 'availability') <> 'string'
           or (v_rental_patch ->> 'availability') not in ('available', 'unavailable', 'paused') then
          raise exception 'Rental availability is invalid.' using detail = 'RENTAL_DETAILS_INVALID';
        end if;
        v_rental_availability := (v_rental_patch ->> 'availability')::public.rental_availability_enum;
      end if;

      insert into public.listing_rental_details (
        listing_id, rental_price_cents, rental_period, security_deposit_cents, rental_terms,
        minimum_rental_period, capacity, whats_included, rules_restrictions, availability
      )
      values (
        p_listing_id, v_rental_price_cents, v_rental_period, v_rental_security_deposit_cents, v_rental_terms,
        v_rental_minimum_period, v_rental_capacity, v_rental_whats_included, v_rental_rules_restrictions,
        v_rental_availability
      )
      on conflict (listing_id) do update set
        rental_price_cents = excluded.rental_price_cents,
        rental_period = excluded.rental_period,
        security_deposit_cents = excluded.security_deposit_cents,
        rental_terms = excluded.rental_terms,
        minimum_rental_period = excluded.minimum_rental_period,
        capacity = excluded.capacity,
        whats_included = excluded.whats_included,
        rules_restrictions = excluded.rules_restrictions,
        availability = excluded.availability;
    end if;
  end if;

  return query
    select p_listing_id, v_public_code, v_final_slug, v_listing_status, v_updated_at;
end;
$$;

revoke all on function public.update_listing(uuid, jsonb) from public;
revoke all on function public.update_listing(uuid, jsonb) from anon;
grant execute on function public.update_listing(uuid, jsonb) to authenticated;

-- ============================================================
-- replace_listing_images (Part 2: category-B, existing account_suspended
-- check untouched below, new deleted_at guard added earlier, independently)
-- ============================================================
create or replace function public.replace_listing_images(p_listing_id uuid, p_image_paths text[] default '{}'::text[], p_reference_flags boolean[] default null::boolean[])
returns table(listing_id uuid, image_count integer, cover_image_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_listing_status public.listing_status_enum;
  v_image_count integer;
  v_flag_count integer;
  v_path text;
  v_reference_flags boolean[];
  v_cover_image_id uuid;
  i integer;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions (existing check, unchanged, defense-in-depth) =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to edit listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.shop_id, l.status
    into v_listing_shop_id, v_listing_status
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to edit this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  -- ===================== draft-only editing (same convention/finding as update_listing, see its own header) =====================
  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be edited with this operation.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  -- ===================== count: 0-8 =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 8 then
    raise exception 'A listing may have at most 8 photos.' using detail = 'TOO_MANY_LISTING_IMAGES';
  end if;

  -- ===================== reference flags: same length as paths when supplied, all-false otherwise =====================
  if p_reference_flags is not null then
    v_flag_count := coalesce(array_length(p_reference_flags, 1), 0);
    if v_flag_count <> v_image_count then
      raise exception 'Reference-image flags must match the number of photos.' using detail = 'IMAGE_ARRAYS_LENGTH_MISMATCH';
    end if;
    v_reference_flags := p_reference_flags;
  else
    v_reference_flags := array_fill(false, array[v_image_count]);
  end if;

  -- ===================== path ownership + structural validity =====================
  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null
         or v_path !~ '[^[:space:]]'
         or v_path !~ ('^listing-images/' || v_caller::text || '/') then
        raise exception 'One or more listing photos are invalid.' using detail = 'LISTING_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== no duplicate path within this listing's own new set =====================
  if v_image_count > 0
     and v_image_count <> (select count(distinct p) from unnest(p_image_paths) p) then
    raise exception 'The same photo was submitted more than once.' using detail = 'DUPLICATE_LISTING_IMAGE_PATH';
  end if;

  -- ===================== atomic whole-set replace: positions are the array indices, so they are contiguous 0..N-1 by construction =====================
  delete from public.listing_images where listing_id = p_listing_id;

  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.listing_images (listing_id, storage_path, position, is_reference_image)
        values (p_listing_id, p_image_paths[i], i - 1, coalesce(v_reference_flags[i], false));
    end loop;

    select li.id into v_cover_image_id
      from public.listing_images li
      where li.listing_id = p_listing_id and li.position = 0;
  else
    v_cover_image_id := null;
  end if;

  update public.listings as l
    set cover_image_id = v_cover_image_id
    where l.id = p_listing_id;

  return query
    select p_listing_id, v_image_count, v_cover_image_id;
end;
$$;

revoke all on function public.replace_listing_images(uuid, text[], boolean[]) from public;
revoke all on function public.replace_listing_images(uuid, text[], boolean[]) from anon;
grant execute on function public.replace_listing_images(uuid, text[], boolean[]) to authenticated;

-- ============================================================
-- publish_listing (Part 2: category-B, existing account_suspended check
-- untouched below, new deleted_at guard added earlier, independently)
-- ============================================================
create or replace function public.publish_listing(p_listing_id uuid)
returns table(listing_id uuid, public_code text, slug text, status listing_status_enum, published_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_listing_status public.listing_status_enum;
  v_seller_policies_accepted_at timestamptz;
  v_title text;
  v_description text;
  v_category_id integer;
  v_category_is_inquiry_only boolean;
  v_listing_type public.listing_type_enum;
  v_condition public.listing_condition_enum;
  v_known_flaws text;
  v_price_cents bigint;
  v_stock_quantity integer;
  v_province_id integer;
  v_city_id integer;
  v_public_code text;
  v_slug text;
  v_fulfillment_count integer;
  v_actual_image_count integer;
  v_reference_image_count integer;
  v_total_image_count integer;
  v_now timestamptz;
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

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions (existing check, unchanged, defense-in-depth) =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to publish listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.shop_id, l.status, l.title, l.description, l.category_id, l.listing_type, l.condition,
         l.known_flaws, l.price_cents, l.stock_quantity, l.province_id, l.city_id,
         l.public_code, l.slug
    into v_listing_shop_id, v_listing_status, v_title, v_description, v_category_id, v_listing_type, v_condition,
         v_known_flaws, v_price_cents, v_stock_quantity, v_province_id, v_city_id,
         v_public_code, v_slug
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to publish this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be published.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  -- ===================== seller policy acceptance (PRD 5.5) -- checked on every publish call =====================
  select p.seller_policies_accepted_at into v_seller_policies_accepted_at
    from public.profiles p
    where p.id = v_caller;

  if v_seller_policies_accepted_at is null then
    raise exception 'You must accept the Marketplace Rules and Prohibited Items Policy before publishing.' using detail = 'SELLER_POLICIES_NOT_ACCEPTED';
  end if;

  -- ===================== title (defensive -- structurally already guaranteed non-blank) =====================
  if v_title is null or v_title !~ '[^[:space:]]' then
    raise exception 'Listing title is required.' using detail = 'TITLE_REQUIRED';
  end if;

  -- ===================== description =====================
  if v_description is null then
    raise exception 'Listing description is required to publish.' using detail = 'DESCRIPTION_REQUIRED';
  end if;

  -- ===================== category =====================
  if v_category_id is null then
    raise exception 'Category is required to publish.' using detail = 'CATEGORY_REQUIRED';
  end if;

  select c.is_inquiry_only into v_category_is_inquiry_only
    from public.categories c
    where c.id = v_category_id;

  -- ===================== listing type / condition =====================
  if v_listing_type is null then
    raise exception 'Listing type is required to publish.' using detail = 'LISTING_TYPE_REQUIRED';
  end if;

  if v_condition is null then
    raise exception 'Condition is required to publish.' using detail = 'CONDITION_REQUIRED';
  end if;

  if v_listing_type = 'brand_new' and v_condition <> 'brand_new' then
    raise exception 'Brand New listings must use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
  end if;

  if v_listing_type = 'preloved' and v_condition = 'brand_new' then
    raise exception 'Pre-loved listings cannot use Brand New condition.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';
  end if;

  -- ===================== known flaws (required for Fair) =====================
  if v_condition = 'fair' and (v_known_flaws is null or v_known_flaws !~ '[^[:space:]]') then
    raise exception 'Known flaws are required for Fair condition.' using detail = 'KNOWN_FLAWS_REQUIRED';
  end if;

  -- ===================== price (>= 0 already guaranteed by listings_price_cents_check; only null-checked here) =====================
  if v_price_cents is null then
    raise exception 'Price is required to publish.' using detail = 'PRICE_REQUIRED';
  end if;

  -- ===================== stock quantity (defensive -- structurally already guaranteed >= 1) =====================
  if v_stock_quantity is null or v_stock_quantity < 1 then
    raise exception 'Stock quantity must be at least 1.' using detail = 'STOCK_QUANTITY_INVALID';
  end if;

  -- ===================== location =====================
  if v_province_id is null then
    raise exception 'Province is required to publish.' using detail = 'PROVINCE_REQUIRED';
  end if;

  if v_city_id is null then
    raise exception 'City/municipality is required to publish.' using detail = 'CITY_REQUIRED';
  end if;

  -- ===================== fulfillment methods (required unless the category is inquiry-only) =====================
  select count(*) into v_fulfillment_count
    from public.listing_fulfillment_methods lfm
    where lfm.listing_id = p_listing_id;

  if not coalesce(v_category_is_inquiry_only, false) and v_fulfillment_count = 0 then
    raise exception 'At least one fulfillment method is required to publish.' using detail = 'FULFILLMENT_REQUIRED';
  end if;

  -- ===================== images: 1-8 total, plus Pre-loved/Brand-New actual-vs-reference rules =====================
  select
    count(*) filter (where not li.is_reference_image),
    count(*) filter (where li.is_reference_image),
    count(*)
    into v_actual_image_count, v_reference_image_count, v_total_image_count
    from public.listing_images li
    where li.listing_id = p_listing_id;

  if v_total_image_count = 0 then
    raise exception 'At least one photo is required to publish.' using detail = 'IMAGE_REQUIRED';
  end if;

  if v_total_image_count > 8 then
    raise exception 'A listing may have at most 8 photos.' using detail = 'TOO_MANY_LISTING_IMAGES';
  end if;

  if v_listing_type = 'preloved' and v_reference_image_count > 0 then
    raise exception 'Pre-loved listings may only include actual-item photos.' using detail = 'REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED';
  end if;

  if v_listing_type = 'brand_new' and v_actual_image_count = 0 then
    raise exception 'Brand New listings require at least one actual-item photo.' using detail = 'BRAND_NEW_REQUIRES_ACTUAL_IMAGE';
  end if;

  -- ===================== transition: draft -> available =====================
  v_now := now();

  update public.listings as l
    set status = 'available',
        published_at = v_now
    where l.id = p_listing_id;

  return query
    select p_listing_id, v_public_code, v_slug, 'available'::public.listing_status_enum, v_now;
end;
$$;

revoke all on function public.publish_listing(uuid) from public;
revoke all on function public.publish_listing(uuid) from anon;
grant execute on function public.publish_listing(uuid) to authenticated;

-- ============================================================
-- update_listing_status (Part 2: category-B, existing account_suspended
-- check untouched below, new deleted_at guard added earlier, independently)
-- ============================================================
create or replace function public.update_listing_status(p_listing_id uuid, p_status listing_status_enum)
returns table(listing_id uuid, status listing_status_enum, was_already_in_status boolean, updated_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_current_status public.listing_status_enum;
  v_reserved_quantity integer;
  v_updated_at timestamptz;
  v_allowed boolean;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to manage listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if p_status is null or p_status not in ('available', 'paused', 'sold', 'archived') then
    raise exception 'That status cannot be set directly.' using detail = 'TARGET_STATUS_NOT_ALLOWED';
  end if;

  select l.shop_id, l.status, l.reserved_quantity, l.updated_at
    into v_listing_shop_id, v_current_status, v_reserved_quantity, v_updated_at
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to manage this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  if v_current_status = p_status then
    return query
      select p_listing_id, v_current_status, true, v_updated_at;
    return;
  end if;

  if v_reserved_quantity > 0 then
    raise exception 'This listing has an active order reservation and cannot be changed right now.' using detail = 'LISTING_HAS_ACTIVE_RESERVATION';
  end if;

  v_allowed := (
    (v_current_status = 'draft' and p_status = 'archived')
    or (v_current_status = 'available' and p_status in ('paused', 'sold', 'archived'))
    or (v_current_status = 'paused' and p_status in ('available', 'sold', 'archived'))
    or (v_current_status = 'sold' and p_status = 'archived')
  );

  if not v_allowed then
    raise exception 'That status change is not allowed.' using detail = 'INVALID_STATUS_TRANSITION';
  end if;

  update public.listings as l
    set status = p_status,
        archived_at = case when p_status = 'archived' then now() else l.archived_at end
    where l.id = p_listing_id
    returning l.updated_at into v_updated_at;

  return query
    select p_listing_id, p_status, false, v_updated_at;
end;
$$;

revoke all on function public.update_listing_status(uuid, public.listing_status_enum) from public;
revoke all on function public.update_listing_status(uuid, public.listing_status_enum) from anon;
grant execute on function public.update_listing_status(uuid, public.listing_status_enum) to authenticated;

-- ============================================================
-- lift_user_restriction (Part 3: restriction-lift defense-in-depth)
--
-- Scoped ONLY to restriction_type = 'account_suspended': if the TARGET
-- user's profile is anonymized (profiles.deleted_at is not null), lifting
-- their account_suspended restriction is rejected with TARGET_ACCOUNT_ANONYMIZED.
-- seller_suspended / buyer_restricted are deliberately NOT blocked here --
-- the deleted_at guards added in Parts 1-2 are the durable, primary
-- invariant; this check is pure defense-in-depth against ever re-opening
-- the account_suspended path for an anonymized identity. Placed after the
-- existing idempotency short-circuit (already-lifted restrictions return
-- early, unaffected) and before note validation.
-- ============================================================
create or replace function public.lift_user_restriction(p_restriction_id uuid, p_note text default null::text)
returns table(restriction_id uuid, user_id uuid, restriction_type restriction_type_enum, was_already_lifted boolean, lifted_at timestamp with time zone)
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
  v_target_deleted_at timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  select ur.user_id, ur.restriction_type, ur.lifted_at
    into v_user_id, v_restriction_type, v_existing_lifted_at
    from public.user_restrictions ur
    where ur.id = p_restriction_id
    for update;

  if not found then
    raise exception 'Restriction not found.' using detail = 'RESTRICTION_NOT_FOUND';
  end if;

  if v_existing_lifted_at is not null then
    return query
      select p_restriction_id, v_user_id, v_restriction_type, true, v_existing_lifted_at;
    return;
  end if;

  -- ===================== restriction-lift defense-in-depth: anonymized target, account_suspended only =====================
  if v_restriction_type = 'account_suspended' then
    select p.deleted_at into v_target_deleted_at
      from public.profiles p
      where p.id = v_user_id;

    if v_target_deleted_at is not null then
      raise exception 'This account has been anonymized and its account suspension cannot be lifted.' using detail = 'TARGET_ACCOUNT_ANONYMIZED';
    end if;
  end if;

  v_note := nullif(btrim(p_note), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Note is too long.' using detail = 'RESOLUTION_NOTE_TOO_LONG';
  end if;

  v_lifted_at := now();

  update public.user_restrictions as ur
    set lifted_at = v_lifted_at,
        lifted_by = v_caller
    where ur.id = p_restriction_id;

  insert into public.moderation_actions (admin_id, action_type, target_user_id, restriction_type, restriction_id, reason)
    values (v_caller, 'restriction_lifted', v_user_id, v_restriction_type, p_restriction_id, v_note);

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
