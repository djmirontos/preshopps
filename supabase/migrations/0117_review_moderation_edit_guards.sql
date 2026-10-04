-- Review moderation (Phase 1): block buyer review edits and seller reply edits while removed; buyer/seller order-review flags reflect removal.
--
-- Source definition: supabase/migrations/0105_harden_review_image_path_validation.sql, 0040_notifications.sql, 0047_review_order_context_rpc.sql (latest defining migration
-- for this function at baseline 1227a44). Copied verbatim except for the
-- removal guards. Signature, return shape, SECURITY DEFINER, search_path, and
-- existing grants are unchanged (CREATE OR REPLACE preserves privileges).

create or replace function public.update_review(
  p_review_id uuid,
  p_rating integer,
  p_body text default null,
  p_image_paths text[] default '{}'::text[]
)
returns table (
  review_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_review_buyer_id uuid;
  v_review_created_at timestamptz;
  v_review_shop_id uuid;
  v_review_order_id uuid;
  v_review_removed_at timestamptz;
  v_body text;
  v_image_count integer;
  v_path text;
  v_path_prefix text;
  v_now timestamptz;
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

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot edit reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock review row (universal serialization point) =====================
  -- order_id is now also read here (previously unused by this function) so
  -- the hardened image-path check below can validate against the review's
  -- own real order -- never trusted from the client, never p_review_id.
  select r.buyer_id, r.created_at, r.shop_id, r.order_id, r.removed_at
    into v_review_buyer_id, v_review_created_at, v_review_shop_id, v_review_order_id, v_review_removed_at
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  if v_review_buyer_id <> v_caller then
    raise exception 'You are not the author of this review.' using detail = 'NOT_REVIEW_AUTHOR';
  end if;

  -- ===================== removed by moderation: no buyer edits (read under the review row lock above) =====================
  if v_review_removed_at is not null then
    raise exception 'This review was removed by moderation.' using detail = 'REVIEW_REMOVED';
  end if;

  -- ===================== 7-day buyer edit window, anchored to reviews.created_at =====================
  if now() >= v_review_created_at + interval '7 days' then
    raise exception 'The review edit window has closed.' using detail = 'REVIEW_EDIT_WINDOW_CLOSED';
  end if;

  -- ===================== admin restrictions -- account_suspended blocks editing; buyer_restricted alone does not =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type = 'account_suspended'
  ) then
    raise exception 'You are not able to edit reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== rating validation (identical to create_review) =====================
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using detail = 'RATING_INVALID';
  end if;

  -- ===================== body normalization (identical to create_review) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long.' using detail = 'REVIEW_BODY_TOO_LONG';
  end if;

  -- ===================== image path validation (identical rule to create_review; applies equally to a retained existing image, since the full set is re-validated and re-inserted below) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    v_path_prefix := 'review-images/' || v_caller::text || '/' || v_review_order_id::text || '/';

    foreach v_path in array p_image_paths loop
      if v_path is null
         or left(v_path, length(v_path_prefix)) <> v_path_prefix
         or length(v_path) = length(v_path_prefix)
         or not exists (
           select 1 from storage.objects so
           where so.bucket_id = 'review-images'
             and so.name = substring(v_path from length('review-images/') + 1)
         )
      then
        raise exception 'One or more review image paths are invalid.' using detail = 'REVIEW_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  -- ===================== update rating/body only; order_id/buyer_id/shop_id/created_at/reply_* untouched =====================
  update public.reviews as r
    set rating = p_rating,
        body = v_body,
        updated_at = v_now
    where r.id = p_review_id
    returning r.updated_at into v_updated_at;

  -- ===================== atomic image-set replacement =====================
  delete from public.review_images as ri where ri.review_id = p_review_id;

  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.review_images (review_id, storage_path, sort_order)
        values (p_review_id, p_image_paths[i], i - 1);
    end loop;
  end if;

  -- ===================== recalculate Trusted Seller eligibility now that this shop's average rating may have changed =====================
  perform public.recalculate_trusted_seller(v_review_shop_id);

  return query
    select p_review_id, v_updated_at;
end;
$$;

create or replace function public.upsert_review_reply(p_review_id uuid, p_body text)
returns table (review_id uuid, reply_created_at timestamptz, reply_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_review_buyer_id uuid;
  v_review_shop_id uuid;
  v_existing_reply_created_at timestamptz;
  v_review_removed_at timestamptz;
  v_shop_owner_id uuid;
  v_body text;
  v_now timestamptz;
  v_reply_created_at timestamptz;
  v_reply_updated_at timestamptz;
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
    raise exception 'Your account cannot reply to reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock review row (universal serialization point) =====================
  select r.buyer_id, r.shop_id, r.reply_created_at, r.removed_at
    into v_review_buyer_id, v_review_shop_id, v_existing_reply_created_at, v_review_removed_at
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  -- ===================== caller must be the shop's current owner =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_review_shop_id;

  if v_shop_owner_id is null or v_shop_owner_id <> v_caller then
    raise exception 'You are not the seller for this review.' using detail = 'NOT_REVIEW_SELLER';
  end if;

  -- ===================== removed by moderation: no reply writes or edits (read under the review row lock above) =====================
  if v_review_removed_at is not null then
    raise exception 'This review was removed by moderation.' using detail = 'REVIEW_REMOVED';
  end if;

  -- ===================== peer blocking, both directions -- applies to first reply AND every edit =====================
  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_review_buyer_id)
       or (ub.blocker_id = v_review_buyer_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot reply to this review.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== seller admin restrictions -- applies to first reply AND every edit =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to reply to reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== body normalization (required, non-blank) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is null then
    raise exception 'Reply cannot be empty.' using detail = 'REPLY_EMPTY';
  end if;

  if char_length(v_body) > 1000 then
    raise exception 'Reply is too long.' using detail = 'REPLY_TOO_LONG';
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  if v_existing_reply_created_at is null then
    -- ===================== first reply: reply_created_at fixed now, reply_updated_at stays NULL =====================
    update public.reviews as r
      set reply_body = v_body,
          reply_created_at = v_now,
          reply_updated_at = null
      where r.id = p_review_id
      returning r.reply_created_at, r.reply_updated_at into v_reply_created_at, v_reply_updated_at;

    -- ===================== notification: buyer receives the first reply only, never an edit =====================
    insert into public.notifications (recipient_id, type, actor_id, review_id, dedupe_key)
    select v_review_buyer_id, 'review_reply', v_caller, p_review_id, p_review_id::text || ':reply'
    where not exists (
      select 1 from public.profiles p where p.id = v_review_buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;
  else
    -- ===================== edit: 7-day window anchored to the existing reply_created_at =====================
    if v_now >= v_existing_reply_created_at + interval '7 days' then
      raise exception 'The reply edit window has closed.' using detail = 'REPLY_EDIT_WINDOW_CLOSED';
    end if;

    update public.reviews as r
      set reply_body = v_body,
          reply_updated_at = v_now
      where r.id = p_review_id
      returning r.reply_created_at, r.reply_updated_at into v_reply_created_at, v_reply_updated_at;
  end if;

  return query
    select p_review_id, v_reply_created_at, v_reply_updated_at;
end;
$$;

create or replace function public.get_order_review(
  p_order_id uuid
)
returns table (
  order_id uuid,
  viewer_role text,
  review_id uuid,
  rating smallint,
  body text,
  image_paths text[],
  review_created_at timestamptz,
  review_updated_at timestamptz,
  can_create_review boolean,
  can_edit_review boolean,
  reply_body text,
  reply_created_at timestamptz,
  reply_updated_at timestamptz,
  can_write_reply boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_order_status public.order_status_enum;
  v_order_completed_at timestamptz;
  v_shop_owner_id uuid;
  v_viewer_role text;
  v_review_id uuid;
  v_review_removed_at timestamptz;
  v_rating smallint;
  v_body text;
  v_review_created_at timestamptz;
  v_review_updated_at timestamptz;
  v_reply_body text;
  v_reply_created_at timestamptz;
  v_reply_updated_at timestamptz;
  v_image_paths text[];
  v_now timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select o.buyer_id, o.shop_id, o.status, o.completed_at
    into v_order_buyer_id, v_order_shop_id, v_order_status, v_order_completed_at
    from public.orders o
    where o.id = p_order_id;

  if not found then
    return;
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_caller = v_order_buyer_id then
    v_viewer_role := 'buyer';
  elsif v_caller = v_shop_owner_id then
    v_viewer_role := 'seller';
  else
    return;
  end if;

  select r.id, r.rating, r.body, r.created_at, r.updated_at, r.reply_body, r.reply_created_at, r.reply_updated_at, r.removed_at
    into v_review_id, v_rating, v_body, v_review_created_at, v_review_updated_at, v_reply_body, v_reply_created_at, v_reply_updated_at, v_review_removed_at
    from public.reviews r
    where r.order_id = p_order_id;

  if v_review_id is not null then
    select array_agg(ri.storage_path order by ri.sort_order) into v_image_paths
      from public.review_images ri
      where ri.review_id = v_review_id;
  end if;

  v_now := now();

  return query
    select
      p_order_id as order_id,
      v_viewer_role as viewer_role,
      v_review_id as review_id,
      v_rating as rating,
      v_body as body,
      coalesce(v_image_paths, '{}'::text[]) as image_paths,
      v_review_created_at as review_created_at,
      v_review_updated_at as review_updated_at,
      (
        v_viewer_role = 'buyer'
        and v_review_id is null
        and v_order_status = 'completed'
        and v_order_completed_at is not null
      ) as can_create_review,
      (
        v_viewer_role = 'buyer'
        and v_review_id is not null
        and v_review_removed_at is null
        and v_now < v_review_created_at + interval '7 days'
      ) as can_edit_review,
      v_reply_body as reply_body,
      v_reply_created_at as reply_created_at,
      v_reply_updated_at as reply_updated_at,
      (
        v_viewer_role = 'seller'
        and v_review_id is not null
        and v_review_removed_at is null
        and (v_reply_created_at is null or v_now < v_reply_created_at + interval '7 days')
      ) as can_write_reply;
end;
$$;

-- ============================================================
-- FINAL GRANTS: the only place remove_review and restore_review become callable
-- by authenticated users. This file is last in the Phase 1 sequence, so these
-- grants are issued only after the public-read filters (0116) and the buyer and
-- seller edit guards above are installed. 0115 deliberately grants nothing here.
-- Prerequisite: 0113 (enum values), 0114 (removed_at, audit table, notification
-- public_message), 0115 (function definitions), 0116 (filters and the
-- get_my_notifications contract). See the deployment notes for the required
-- per-migration transaction boundary (not verified in this repository).
-- ============================================================
grant execute on function public.remove_review(uuid, text, text) to authenticated;
grant execute on function public.restore_review(uuid, text, text) to authenticated;
