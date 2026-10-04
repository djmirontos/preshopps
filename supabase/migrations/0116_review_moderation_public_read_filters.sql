-- Review moderation (Phase 1): exclude removed reviews from public readers, rating aggregates, and trusted-seller calculation.
--
-- Source definition: supabase/migrations/0053_shop_reviews_rating_filter_and_sort.sql, 0034_reviews_security_and_rpcs.sql, 0036_public_marketplace_read_rpcs.sql, 0106_admin_listing_hide.sql, 0065_trusted_seller_recalculation.sql (latest defining migration
-- for this function at baseline 1227a44). Copied verbatim except for the
-- removed_at predicate. Signature, return shape, SECURITY DEFINER, search_path, and
-- existing grants are unchanged (CREATE OR REPLACE preserves privileges).

create or replace function public.get_shop_reviews(
  p_shop_id uuid,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_rating_filter integer default null,
  p_sort_mode text default 'newest',
  p_before_rating smallint default null
)
returns table (
  review_id uuid,
  rating smallint,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  buyer_display_name text,
  buyer_avatar_storage_path text,
  reply_body text,
  reply_created_at timestamptz,
  reply_updated_at timestamptz,
  image_paths text[],
  purchased_item_titles text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  if p_sort_mode is null or p_sort_mode not in ('newest', 'highest_rating') then
    raise exception 'Sort mode must be "newest" or "highest_rating".' using detail = 'SORT_MODE_INVALID';
  end if;

  if p_rating_filter is not null and (p_rating_filter < 1 or p_rating_filter > 5) then
    raise exception 'Rating filter must be between 1 and 5.' using detail = 'RATING_FILTER_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  if p_sort_mode = 'highest_rating' and (p_before_created_at is not null) <> (p_before_rating is not null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    select
      r.id as review_id,
      r.rating,
      r.body,
      r.created_at,
      r.updated_at,
      case when p.deleted_at is null then p.display_name else 'Deleted user' end as buyer_display_name,
      case when p.deleted_at is null then p.avatar_storage_path else null end as buyer_avatar_storage_path,
      r.reply_body,
      r.reply_created_at,
      r.reply_updated_at,
      coalesce(img.image_paths, '{}'::text[]) as image_paths,
      coalesce(items.purchased_item_titles, '{}'::text[]) as purchased_item_titles
    from public.reviews r
    join public.profiles p on p.id = r.buyer_id
    left join lateral (
      select array_agg(ri.storage_path order by ri.sort_order) as image_paths
      from public.review_images ri
      where ri.review_id = r.id
    ) img on true
    left join lateral (
      select array_agg(oi.listing_title_snapshot order by oi.id) as purchased_item_titles
      from public.order_items oi
      where oi.order_id = r.order_id and oi.status = 'accepted'
    ) items on true
    where r.shop_id = p_shop_id
      and r.removed_at is null
      and (p_rating_filter is null or r.rating = p_rating_filter)
      and (
        (
          p_sort_mode = 'newest'
          and (
            p_before_created_at is null
            or (r.created_at, r.id) < (p_before_created_at, p_before_id)
          )
        )
        or (
          p_sort_mode = 'highest_rating'
          and (
            p_before_rating is null
            or (r.rating, r.created_at, r.id) < (p_before_rating, p_before_created_at, p_before_id)
          )
        )
      )
    order by
      case when p_sort_mode = 'highest_rating' then r.rating end desc,
      r.created_at desc,
      r.id desc
    limit p_limit;
end;
$$;

create or replace function public.get_shop_review_summary(
  p_shop_id uuid
)
returns table (
  review_count bigint,
  average_rating numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  return query
    select
      count(*) as review_count,
      avg(r.rating)::numeric as average_rating
    from public.reviews r
    where r.shop_id = p_shop_id
      and r.removed_at is null;
end;
$$;

create or replace function public.get_shop_detail(
  p_slug text
)
returns table (
  shop_id uuid,
  requested_slug text,
  current_slug text,
  is_current_slug boolean,
  name text,
  description text,
  logo_storage_path text,
  messenger_link text,
  shop_status public.shop_status_enum,
  is_trusted_seller boolean,
  member_since timestamptz,
  province_name text,
  city_name text,
  barangay_name text,
  review_count bigint,
  average_rating numeric,
  completed_order_count bigint,
  active_listing_count bigint,
  featured_listing_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_slug text;
  v_shop_id uuid;
begin
  v_requested_slug := nullif(btrim(p_slug), '');

  if v_requested_slug is null then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== visibility gate: historical-slug resolution + shop-suspension =====================
  select ss.shop_id into v_shop_id
    from public.shop_slugs ss
    join public.shops s on s.id = ss.shop_id
    where ss.slug = v_requested_slug
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      );

  if v_shop_id is null then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  return query
    select
      s.id as shop_id,
      v_requested_slug as requested_slug,
      s.slug as current_slug,
      (v_requested_slug = s.slug) as is_current_slug,
      s.name,
      s.description,
      s.logo_storage_path,
      s.messenger_link,
      s.status as shop_status,
      s.is_trusted_seller,
      s.created_at as member_since,
      prov.name as province_name,
      city.name as city_name,
      bgy.name as barangay_name,
      coalesce(rv.review_count, 0) as review_count,
      rv.average_rating,
      coalesce(ord.completed_order_count, 0) as completed_order_count,
      coalesce(lst.active_listing_count, 0) as active_listing_count,
      s.featured_listing_id
    from public.shops s
    join public.provinces prov on prov.id = s.province_id
    join public.cities_municipalities city on city.id = s.city_id
    left join public.barangays bgy on bgy.id = s.barangay_id
    left join lateral (
      select count(*) as review_count, avg(r.rating)::numeric as average_rating
      from public.reviews r
      where r.shop_id = s.id
        and r.removed_at is null
    ) rv on true
    left join lateral (
      select count(*) as completed_order_count
      from public.orders o
      where o.shop_id = s.id and o.status = 'completed'
    ) ord on true
    left join lateral (
      select count(*) as active_listing_count
      from public.listings l
      where l.shop_id = s.id and l.status = 'available'
    ) lst on true
    where s.id = v_shop_id;
end;
$$;

create or replace function public.get_listing_detail(p_public_code text)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  title text,
  description text,
  listing_type public.listing_type_enum,
  condition public.listing_condition_enum,
  known_flaws text,
  brand text,
  price_cents bigint,
  original_price_cents bigint,
  is_negotiable boolean,
  status public.listing_status_enum,
  available_quantity integer,
  meetup_note text,
  published_at timestamptz,
  created_at timestamptz,
  category_id integer,
  category_name text,
  is_inquiry_only boolean,
  province_name text,
  city_name text,
  barangay_name text,
  image_paths text[],
  fulfillment_methods public.fulfillment_method_enum[],
  shop_id uuid,
  shop_slug text,
  shop_name text,
  shop_description text,
  shop_logo_storage_path text,
  shop_messenger_link text,
  shop_status public.shop_status_enum,
  shop_is_trusted_seller boolean,
  shop_member_since timestamptz,
  review_count bigint,
  average_rating numeric,
  vehicle_brand text,
  vehicle_model text,
  vehicle_year smallint,
  vehicle_mileage_km integer,
  vehicle_transmission text,
  vehicle_fuel_type text,
  vehicle_registration_status public.vehicle_registration_status_enum,
  vehicle_documents_available text[],
  rental_price_cents bigint,
  rental_period public.rental_period_enum,
  rental_security_deposit_cents bigint,
  rental_terms text,
  rental_minimum_rental_period text,
  rental_capacity integer,
  rental_whats_included text,
  rental_rules_restrictions text,
  rental_availability public.rental_availability_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_code text;
  v_listing_id uuid;
begin
  v_public_code := nullif(btrim(p_public_code), '');

  if v_public_code is null then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  -- ===================== visibility gate: status + admin-hidden + shop-suspension, single lookup =====================
  select l.id into v_listing_id
    from public.listings l
    join public.shops s on s.id = l.shop_id
    where l.public_code = v_public_code
      and l.status in ('available', 'reserved', 'sold', 'archived')
      and l.hidden_by_admin_at is null
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      );

  if v_listing_id is null then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  return query
    select
      l.id as listing_id,
      l.public_code,
      l.slug,
      l.title,
      l.description,
      l.listing_type,
      l.condition,
      l.known_flaws,
      l.brand,
      l.price_cents,
      l.original_price_cents,
      l.is_negotiable,
      l.status,
      l.available_quantity,
      l.meetup_note,
      l.published_at,
      l.created_at,
      l.category_id,
      cat.name as category_name,
      cat.is_inquiry_only,
      prov.name as province_name,
      city.name as city_name,
      bgy.name as barangay_name,
      coalesce(imgs.image_paths, '{}'::text[]) as image_paths,
      coalesce(fm.methods, '{}'::public.fulfillment_method_enum[]) as fulfillment_methods,
      s.id as shop_id,
      s.slug as shop_slug,
      s.name as shop_name,
      s.description as shop_description,
      s.logo_storage_path as shop_logo_storage_path,
      s.messenger_link as shop_messenger_link,
      s.status as shop_status,
      s.is_trusted_seller as shop_is_trusted_seller,
      s.created_at as shop_member_since,
      coalesce(rv.review_count, 0) as review_count,
      rv.average_rating,
      veh.brand as vehicle_brand,
      veh.model as vehicle_model,
      veh.year as vehicle_year,
      veh.mileage_km as vehicle_mileage_km,
      veh.transmission as vehicle_transmission,
      veh.fuel_type as vehicle_fuel_type,
      veh.registration_status as vehicle_registration_status,
      veh.documents_available as vehicle_documents_available,
      rent.rental_price_cents,
      rent.rental_period,
      rent.security_deposit_cents as rental_security_deposit_cents,
      rent.rental_terms,
      rent.minimum_rental_period as rental_minimum_rental_period,
      rent.capacity as rental_capacity,
      rent.whats_included as rental_whats_included,
      rent.rules_restrictions as rental_rules_restrictions,
      rent.availability as rental_availability
    from public.listings l
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    join public.provinces prov on prov.id = l.province_id
    join public.cities_municipalities city on city.id = l.city_id
    left join public.barangays bgy on bgy.id = l.barangay_id
    left join public.listing_vehicle_details veh on veh.listing_id = l.id
    left join public.listing_rental_details rent on rent.listing_id = l.id
    left join lateral (
      select array_agg(li.storage_path order by li.position asc) as image_paths
      from public.listing_images li
      where li.listing_id = l.id
    ) imgs on true
    left join lateral (
      select array_agg(lfm.method order by lfm.method) as methods
      from public.listing_fulfillment_methods lfm
      where lfm.listing_id = l.id
    ) fm on true
    left join lateral (
      select count(*) as review_count, avg(r.rating)::numeric as average_rating
      from public.reviews r
      where r.shop_id = l.shop_id
        and r.removed_at is null
    ) rv on true
    where l.id = v_listing_id;
end;
$$;

create or replace function public.recalculate_trusted_seller(
  p_shop_id uuid
)
returns table (
  shop_id uuid,
  is_trusted_seller boolean,
  trusted_seller_calculated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_email_confirmed_at timestamptz;
  v_completed_order_count integer;
  v_review_count integer;
  v_average_rating numeric;
  v_has_active_restriction boolean;
  v_eligible boolean;
  v_now timestamptz;
begin
  -- ===================== lock the shop row (universal serialization point) =====================
  select s.owner_id into v_owner_id
    from public.shops s
    where s.id = p_shop_id
    for update;

  if not found then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== verified email (auth.users is the sole source of truth for email/verification) =====================
  select u.email_confirmed_at into v_email_confirmed_at
    from auth.users u
    where u.id = v_owner_id;

  -- ===================== at least 5 completed orders (seller-side) =====================
  select count(*) into v_completed_order_count
    from public.orders o
    where o.shop_id = p_shop_id
      and o.status = 'completed';

  -- ===================== at least 3 reviews (already "verified" by construction) with average >= 4.0 =====================
  select count(*), avg(r.rating)
    into v_review_count, v_average_rating
    from public.reviews r
    where r.shop_id = p_shop_id
      and r.removed_at is null;

  -- ===================== no active serious moderation issue (user_restrictions is the only implemented proxy today) =====================
  select exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_owner_id
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) into v_has_active_restriction;

  -- ===================== PRD 27.2: all five criteria required =====================
  v_eligible :=
    v_email_confirmed_at is not null
    and v_completed_order_count >= 5
    and v_review_count >= 3
    and coalesce(v_average_rating, 0) >= 4.0
    and not v_has_active_restriction;

  v_now := now();

  update public.shops as s
    set is_trusted_seller = v_eligible,
        trusted_seller_calculated_at = v_now
    where s.id = p_shop_id;

  return query
    select p_shop_id, v_eligible, v_now;
end;
$$;

-- ============================================================
-- get_my_notifications: adds public_message (user-facing review moderation text).
-- Return type changes, so the function is dropped and recreated. The body is
-- the latest definition in 0091, unchanged except for the two anchored additions
-- (return column and projection). Access is re-established below exactly as in
-- 0091 (revoke from public and anon, grant to authenticated) and the 0040 comment
-- is re-applied. Recipient-scoped: the caller only ever sees their own rows.
-- ============================================================
drop function if exists public.get_my_notifications(integer, timestamptz, uuid);

create or replace function public.get_my_notifications(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  notification_id uuid,
  type notification_type_enum,
  created_at timestamptz,
  read_at timestamptz,
  actor_display_name text,
  actor_avatar_path text,
  order_id uuid,
  order_public_code text,
  conversation_id uuid,
  conversation_listing_title text,
  review_id uuid,
  public_message text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== limit bounds =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  -- ===================== cursor: both-or-neither =====================
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor must include both created_at and id, or neither.' using detail = 'CURSOR_INVALID';
  end if;

  -- ===================== missing/deleted caller profile: zero rows, not an error =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return;
  end if;

  return query
    select
      n.id as notification_id,
      n.type,
      n.created_at,
      n.read_at,
      case when ap.deleted_at is null then ap.display_name else null end as actor_display_name,
      case when ap.deleted_at is null then ap.avatar_storage_path else null end as actor_avatar_path,
      n.order_id,
      o.public_code as order_public_code,
      n.conversation_id,
      case
        when l.status in ('available', 'reserved', 'sold', 'archived')
          and not exists (
            select 1 from public.user_restrictions ur
            where ur.user_id = ls.owner_id
              and ur.lifted_at is null
              and ur.restriction_type in ('seller_suspended', 'account_suspended')
          )
        then l.title
        else null
      end as conversation_listing_title,
      n.review_id,
      n.public_message
    from public.notifications n
    left join public.profiles ap on ap.id = n.actor_id
    left join public.orders o on o.id = n.order_id
    left join public.conversations c on c.id = n.conversation_id
    left join public.listings l on l.id = c.listing_id
    left join public.shops ls on ls.id = l.shop_id
    where n.recipient_id = v_caller
      and n.dismissed_at is null
      and (
        p_before_created_at is null
        or n.created_at < p_before_created_at
        or (n.created_at = p_before_created_at and n.id < p_before_id)
      )
    order by n.created_at desc, n.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_notifications(integer, timestamptz, uuid) from public;
revoke all on function public.get_my_notifications(integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_notifications(integer, timestamptz, uuid) to authenticated;

comment on function public.get_my_notifications(integer, timestamptz, uuid) is
  'Keyset-paginated (created_at DESC, id DESC), owner-scoped notification feed with UI-safe actor/order/conversation-listing projection. Actor identity masked to NULL for a soft-deleted actor. conversation_listing_title is NULL whenever the linked listing is not in (available, reserved, sold, archived), or its shop owner has an active seller_suspended/account_suspended restriction -- a suspended seller''s listings are canonically hidden from public marketplace surfaces, and this projection must not become an alternate disclosure path. Suppressing the title never suppresses the notification row itself.';
